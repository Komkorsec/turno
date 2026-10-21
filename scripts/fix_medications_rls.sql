-- ════════════════════════════════════════════════════════════════════
--  Patch: RLS farmaci — usa funzioni SECURITY DEFINER
--  per evitare che le subquery nelle policy colpiscano RLS
--  di altre tabelle (residents, profiles).
--
--  Esegui questo script se ottieni errori "permission denied" o
--  "new row violates row-level security policy" quando aggiungi
--  o modifichi un farmaco.
-- ════════════════════════════════════════════════════════════════════

-- ─── Helper: membro della struttura (SELECT/logs) ─────────────────────────────

create or replace function public.is_same_structure_as_resident(p_resident_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from   public.residents r
    join   public.profiles  p on p.structure_id = r.structure_id
    where  r.id = p_resident_id
      and  p.id = auth.uid()
  )
$$;

-- ─── Helper: manager/admin della struttura (INSERT/UPDATE farmaci) ────────────

create or replace function public.can_manage_resident_data(p_resident_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from   public.residents r
    join   public.profiles  p on p.structure_id = r.structure_id
    where  r.id = p_resident_id
      and  p.id = auth.uid()
      and  p.role in ('manager', 'admin_secondary')
  )
$$;

-- ─── Ricrea policy INSERT / UPDATE farmaci ────────────────────────────────────

drop policy if exists "managers_insert_medications" on public.resident_medications;
drop policy if exists "managers_update_medications" on public.resident_medications;
drop policy if exists "members_select_medications"  on public.resident_medications;
drop policy if exists "members_select_logs"         on public.medication_logs;
drop policy if exists "members_insert_logs"         on public.medication_logs;

create policy "members_select_medications"
  on public.resident_medications for select
  using ( is_same_structure_as_resident(resident_id) );

create policy "managers_insert_medications"
  on public.resident_medications for insert
  with check ( can_manage_resident_data(resident_id) );

create policy "managers_update_medications"
  on public.resident_medications for update
  using ( can_manage_resident_data(resident_id) );

create policy "members_select_logs"
  on public.medication_logs for select
  using ( is_same_structure_as_resident(resident_id) );

create policy "members_insert_logs"
  on public.medication_logs for insert
  with check ( is_same_structure_as_resident(resident_id) );
