-- ════════════════════════════════════════════════════════════════════
--  Aggiungi max_structures a invitation_codes
--  + aggiorna handle_new_user per leggere il valore dal codice
--  Prerequisito: organizations_v2.sql già eseguito
-- ════════════════════════════════════════════════════════════════════

-- 1. Nuova colonna (default 1 = compatibile con codici già esistenti)
alter table public.invitation_codes
  add column if not exists max_structures int not null default 1
    check (max_structures >= 1);

-- 2. handle_new_user aggiornato: legge max_structures dal codice
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_code     text;
  v_code_row public.invitation_codes%rowtype;
  v_sid      smallint;
  v_role     text;
  v_name     text;
  v_strname  text;
  v_org_id   bigint;
  v_max      int;
begin
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

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
        -- Aggiunge a un'org esistente
        v_org_id := v_code_row.organization_id;

        if (select count(*) from public.structures where organization_id = v_org_id)
           >= (select max_structures from public.organizations where id = v_org_id) then
          raise exception 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
        end if;

        insert into public.structures (name, organization_id)
          values (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          returning id into v_sid;
      else
        -- Nuova organizzazione: usa max_structures dal codice
        insert into public.organizations (name, max_structures)
          values (coalesce(nullif(trim(v_strname), ''), 'Org di ' || v_name), v_max)
          returning id into v_org_id;

        insert into public.structures (name, organization_id)
          values (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          returning id into v_sid;
      end if;
    else
      v_sid    := v_code_row.structure_id;
      v_org_id := (select organization_id from public.structures where id = v_sid);
    end if;

    update public.invitation_codes set is_used = true where code = v_code;

  else
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
