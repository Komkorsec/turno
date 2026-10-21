-- ════════════════════════════════════════════════════════════════════
--  Fix definitivo: my_org_owns_structure con overload multipli
--
--  DROP CASCADE elimina le policy dipendenti, poi le ricrea tutte
--  puntando all'unica versione bigint corretta.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Drop CASCADE di tutti gli overload ───────────────────────────────────
--  Le policy dipendenti vengono eliminate automaticamente.

drop function if exists public.my_org_owns_structure(smallint) cascade;
drop function if exists public.my_org_owns_structure(integer)  cascade;
drop function if exists public.my_org_owns_structure(bigint)   cascade;

-- ─── 2. Ricrea la funzione — solo bigint ─────────────────────────────────────

create function public.my_org_owns_structure(p_structure_id bigint)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.structures
     where id              = p_structure_id
       and organization_id = public.my_organization_id()
  )
$$;

-- ─── 3. Ricrea le policy eliminate dal CASCADE ───────────────────────────────

-- diaries
drop policy if exists "diaries_read" on public.diaries;
create policy "diaries_read" on public.diaries
  for select to authenticated
  using (
    structure_id = public.my_structure_id()
    or public.my_org_owns_structure(structure_id)
  );

-- invitation_codes
drop policy if exists "invitation_codes_manager_insert" on public.invitation_codes;
create policy "invitation_codes_manager_insert" on public.invitation_codes
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
    and created_by = auth.uid()
    and role in ('operator', 'admin_secondary')
  );

-- report_views (select)
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

-- report_views (insert — manager/admin_secondary)
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

-- report_history
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

-- schedules (ricrea anche queste, dipendevano dalla funzione)
drop policy if exists "schedules_manager_all"     on public.schedules;
drop policy if exists "schedules_operator_select" on public.schedules;

create policy "schedules_manager_all" on public.schedules
  for all to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
  )
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
  );

create policy "schedules_operator_select" on public.schedules
  for select to authenticated
  using (
    structure_id = public.my_structure_id()
  );

-- Nota: le policy di diary_comments vanno create eseguendo
-- diary_comments.sql DOPO questo script (la tabella non esiste ancora).
