-- ════════════════════════════════════════════════════════════════════
--  Turno — Organizations: multi-struttura per organizzazione
--
--  Esegui in ordine nel SQL Editor di Supabase.
--  Dipende da: saas_schema.sql, fix_profiles_rls_v2.sql,
--              fix_isolation_rls.sql, manager_invites.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Tabella organizations ─────────────────────────────────────────────────

create table if not exists public.organizations (
  id             bigserial    primary key,
  name           text         not null default 'Organizzazione',
  max_structures int          not null default 1 check (max_structures >= 1),
  created_at     timestamptz  not null default now()
);

alter table public.organizations enable row level security;

-- Solo admin vede/modifica le organizzazioni (il manager le legge via funzione)
create policy "organizations_admin" on public.organizations
  for all to authenticated
  using  ((auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com');

-- Il manager può leggere la propria organizzazione
create policy "organizations_owner_read" on public.organizations
  for select to authenticated
  using (
    id = (select organization_id from public.profiles where id = auth.uid())
  );

-- ─── 2. Aggiungi organization_id alle tabelle esistenti ───────────────────────

-- structures: ogni struttura appartiene a un'organizzazione
alter table public.structures
  add column if not exists organization_id bigint references public.organizations(id);

-- profiles: i manager (e admin_secondary) hanno un'organizzazione
alter table public.profiles
  add column if not exists organization_id bigint references public.organizations(id);

-- invitation_codes: i codici manager possono essere pre-assegnati a un'org
--   (null = crea nuova org al momento della registrazione)
alter table public.invitation_codes
  add column if not exists organization_id bigint references public.organizations(id);

-- ─── 3. Migrazione dati esistenti ────────────────────────────────────────────
--  Per ogni manager esistente: crea un'org, linka struttura e profilo

do $$
declare
  mgr        record;
  new_org_id bigint;
begin
  for mgr in
    select p.id as profile_id, p.structure_id, s.name as structure_name
      from public.profiles p
      join public.structures s on s.id = p.structure_id
     where p.role = 'manager'
       and p.organization_id is null
  loop
    -- Crea l'organizzazione prendendo il nome dalla struttura
    insert into public.organizations (name, max_structures)
    values (mgr.structure_name, 1)
    returning id into new_org_id;

    -- Collega la struttura all'organizzazione
    update public.structures
       set organization_id = new_org_id
     where id = mgr.structure_id;

    -- Collega il profilo manager all'organizzazione
    update public.profiles
       set organization_id = new_org_id
     where id = mgr.profile_id;
  end loop;

  -- Propaga organization_id agli admin_secondary della stessa struttura
  update public.profiles p
     set organization_id = s.organization_id
    from public.structures s
   where p.structure_id = s.id
     and p.role = 'admin_secondary'
     and p.organization_id is null
     and s.organization_id is not null;
end $$;

-- ─── 4. Funzioni helper security definer ─────────────────────────────────────

-- Ritorna l'organization_id dell'utente corrente (bypassa RLS)
create or replace function public.my_organization_id()
returns bigint language sql stable security definer
set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

-- Ritorna true se la struttura indicata appartiene all'organizzazione dell'utente
create or replace function public.my_org_owns_structure(p_structure_id smallint)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.structures
     where id = p_structure_id
       and organization_id = public.my_organization_id()
  )
$$;

-- ─── 5. Aggiorna handle_new_user ─────────────────────────────────────────────
--  Quando un manager si registra: crea org → crea struttura → collega entrambi

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_code         text;
  v_code_row     public.invitation_codes%rowtype;
  v_sid          smallint;
  v_role         text;
  v_name         text;
  v_strname      text;
  v_org_id       bigint;
begin
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  if v_code is not null then
    -- ── Flusso con codice invito ──────────────────────────────────────
    select * into v_code_row
      from public.invitation_codes
     where code = v_code and is_used = false;

    if not found then
      raise exception 'Codice invito non valido o già utilizzato.';
    end if;

    v_role := v_code_row.role;

    if v_role = 'manager' then
      -- Controlla se c'è già un'org pre-assegnata nel codice invito
      if v_code_row.organization_id is not null then
        -- Aggiunge il manager a un'org esistente (multi-manager futuro)
        v_org_id := v_code_row.organization_id;

        -- Verifica limite strutture prima di crearne una nuova
        if (select count(*) from public.structures where organization_id = v_org_id)
           >= (select max_structures from public.organizations where id = v_org_id) then
          raise exception 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
        end if;

        insert into public.structures (name, organization_id)
          values (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          returning id into v_sid;
      else
        -- Crea una nuova organizzazione per questo manager
        insert into public.organizations (name, max_structures)
          values (coalesce(nullif(trim(v_strname), ''), 'Org di ' || v_name), 1)
          returning id into v_org_id;

        insert into public.structures (name, organization_id)
          values (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          returning id into v_sid;
      end if;

    else
      -- Operatore / admin_secondary: usa la struttura del codice
      v_sid    := v_code_row.structure_id;
      v_org_id := (select organization_id from public.structures where id = v_sid);
    end if;

    update public.invitation_codes set is_used = true where code = v_code;

  else
    -- ── Flusso admin (seed script / creazione manuale da dashboard) ───
    v_role   := coalesce(new.raw_user_meta_data->>'role', 'operator');
    v_sid    := (new.raw_user_meta_data->>'structure_id')::smallint;
    v_org_id := (new.raw_user_meta_data->>'organization_id')::bigint;

    -- Fallback: ricava org dalla struttura se non passata esplicitamente
    if v_org_id is null and v_sid is not null then
      v_org_id := (select organization_id from public.structures where id = v_sid);
    end if;
  end if;

  insert into public.profiles (id, full_name, role, structure_id, organization_id)
    values (new.id, v_name, v_role, v_sid, v_org_id);

  return new;
end;
$$;

-- ─── 6. RPC create_structure (con controllo limite) ──────────────────────────

create or replace function public.create_structure(p_name text)
returns bigint language plpgsql
set search_path = public
as $$
declare
  v_org_id    bigint;
  v_max       int;
  v_count     int;
  v_new_id    bigint;
begin
  -- Solo i manager possono creare strutture
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

  insert into public.structures (name, organization_id)
    values (trim(p_name), v_org_id)
    returning id into v_new_id;

  return v_new_id;
end;
$$;

-- ─── 7. Aggiorna RLS policies ─────────────────────────────────────────────────

-- ── structures ────────────────────────────────────────────────────────────────
drop policy if exists "structures_read" on public.structures;

create policy "structures_read" on public.structures
  for select to authenticated
  using (
    -- Admin vede tutto
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    -- Manager / admin_secondary vedono tutte le strutture della propria org
    or organization_id = public.my_organization_id()
    -- Operatore vede solo la propria struttura
    or id = public.my_structure_id()
  );

-- ── diaries ───────────────────────────────────────────────────────────────────
drop policy if exists "diaries_read" on public.diaries;

create policy "diaries_read" on public.diaries
  for select to authenticated
  using (
    -- Stessa struttura dell'utente (operatori)
    structure_id = public.my_structure_id()
    -- O qualsiasi struttura dell'organizzazione (manager / admin_secondary)
    or public.my_org_owns_structure(structure_id)
  );

-- ── profiles ──────────────────────────────────────────────────────────────────
drop policy if exists "profiles_read" on public.profiles;

create policy "profiles_read" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    -- Admin
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    -- Stessa struttura (operatore vede colleghi)
    or structure_id = public.my_structure_id()
    -- Stessa organizzazione (manager vede tutto il suo team)
    or organization_id = public.my_organization_id()
  );

-- ── invitation_codes ──────────────────────────────────────────────────────────
drop policy if exists "invitation_codes_manager_read" on public.invitation_codes;

create policy "invitation_codes_manager_read" on public.invitation_codes
  for select to authenticated
  using (
    -- Admin
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    -- Manager vede i codici di tutte le strutture nella propria org
    or (
      structure_id in (
        select id from public.structures
         where organization_id = public.my_organization_id()
      )
    )
  );

drop policy if exists "invitation_codes_manager_insert" on public.invitation_codes;

create policy "invitation_codes_manager_insert" on public.invitation_codes
  for insert to authenticated
  with check (
    -- Solo manager possono generare codici
    (select role from public.profiles where id = auth.uid()) = 'manager'
    -- Il codice deve puntare a una struttura della propria org
    and public.my_org_owns_structure(structure_id)
    and created_by = auth.uid()
    and role in ('operator', 'admin_secondary')
  );

-- ── report_views ──────────────────────────────────────────────────────────────
drop policy if exists "report_views_select" on public.report_views;

create policy "report_views_select" on public.report_views
  for select to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
    and exists (
      select 1 from public.diaries
       where id = report_views.report_id
         and public.my_org_owns_structure(structure_id)
    )
  );

drop policy if exists "report_views_insert" on public.report_views;

create policy "report_views_insert" on public.report_views
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
    and exists (
      select 1 from public.diaries
       where id = report_views.report_id
         and public.my_org_owns_structure(structure_id)
    )
  );

-- ── report_history ────────────────────────────────────────────────────────────
drop policy if exists "report_history_select" on public.report_history;

create policy "report_history_select" on public.report_history
  for select to authenticated
  using (
    edited_by = auth.uid()
    or (
      (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
      and exists (
        select 1 from public.diaries
         where id = report_history.diary_id
           and public.my_org_owns_structure(structure_id)
      )
    )
  );
