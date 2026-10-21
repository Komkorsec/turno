-- ════════════════════════════════════════════════════════════════════
--  Strutture dettagliate + onboarding manager separato da struttura
--  Prerequisito: organizations_v2.sql, invitation_codes_max_structures.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Nuove colonne su structures ──────────────────────────────────────────

alter table public.structures
  add column if not exists type     text,
  add column if not exists capacity int;

-- ─── 2. handle_new_user: manager crea solo l'org, NON la struttura ────────────
--   La prima struttura verrà aggiunta dalla dashboard con il form dettagliato.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_code     text;
  v_code_row public.invitation_codes%rowtype;
  v_sid      smallint;
  v_role     text;
  v_name     text;
  v_orgname  text;
  v_org_id   bigint;
  v_max      int;
begin
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_orgname := coalesce(
    nullif(trim(new.raw_user_meta_data->>'organization_name'), ''),
    'Org di ' || v_name
  );

  if v_code is not null then
    select * into v_code_row
      from public.invitation_codes
     where code = v_code and is_used = false;

    if not found then
      raise exception 'Codice invito non valido o già utilizzato.';
    end if;

    v_role := v_code_row.role;
    v_max  := coalesce(v_code_row.max_structures, 1);

    if v_role = 'manager' then
      if v_code_row.organization_id is not null then
        -- Aggiunge manager a org esistente (multi-manager, uso futuro)
        v_org_id := v_code_row.organization_id;
      else
        -- Crea nuova organizzazione con il nome scelto dal manager
        insert into public.organizations (name, max_structures)
          values (v_orgname, v_max)
          returning id into v_org_id;
      end if;

      -- Nessuna struttura creata qui: il manager la aggiunge dalla dashboard
      v_sid := null;

    else
      -- Operatore / admin_secondary: usa struttura dal codice
      v_sid    := v_code_row.structure_id;
      v_org_id := (select organization_id from public.structures where id = v_sid);
    end if;

    update public.invitation_codes set is_used = true where code = v_code;

  else
    -- Flusso admin (seed / dashboard Supabase)
    v_role   := coalesce(new.raw_user_meta_data->>'role', 'operator');
    v_sid    := (new.raw_user_meta_data->>'structure_id')::smallint;
    v_org_id := (new.raw_user_meta_data->>'organization_id')::bigint;

    if v_org_id is null and v_sid is not null then
      v_org_id := (select organization_id from public.structures where id = v_sid);
    end if;
  end if;

  insert into public.profiles (id, full_name, role, structure_id, organization_id)
    values (new.id, v_name, v_role, v_sid, v_org_id);

  return new;
end;
$$;

-- ─── 3. create_structure RPC con campi dettagliati ───────────────────────────

create or replace function public.create_structure(
  p_name     text,
  p_address  text default null,
  p_type     text default null,
  p_capacity int  default null
)
returns bigint language plpgsql
set search_path = public
as $$
declare
  v_org_id bigint;
  v_max    int;
  v_count  int;
  v_new_id bigint;
begin
  if (select role from public.profiles where id = auth.uid()) != 'manager' then
    raise exception 'Accesso negato: solo i manager possono creare strutture.';
  end if;

  select organization_id into v_org_id
    from public.profiles where id = auth.uid();

  if v_org_id is null then
    raise exception 'Nessuna organizzazione associata a questo account.';
  end if;

  select max_structures into v_max
    from public.organizations where id = v_org_id;

  select count(*) into v_count
    from public.structures where organization_id = v_org_id;

  if v_count >= v_max then
    raise exception 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
  end if;

  insert into public.structures (name, address, type, capacity, organization_id)
    values (trim(p_name), nullif(trim(coalesce(p_address,'')),  ''),
                          nullif(trim(coalesce(p_type,'')),     ''),
                          p_capacity, v_org_id)
    returning id into v_new_id;

  return v_new_id;
end;
$$;
