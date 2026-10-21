-- ════════════════════════════════════════════════════════════════════
--  Scheduling Constraints
--  Aggiunge campi vincolo a profiles e crea la tabella absences
--  Eseguire DOPO: saas_schema.sql, team_management.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── Colonne vincolo su profiles ─────────────────────────────────────────────

alter table public.profiles
  add column if not exists max_hours_per_week integer,
  add column if not exists weekly_rest_day    text,
  add column if not exists shift_preference   text;

-- ─── Tabella assenze ─────────────────────────────────────────────────────────

create table if not exists public.absences (
  id         bigserial    primary key,
  user_id    uuid         not null references public.profiles(id) on delete cascade,
  start_date date         not null,
  end_date   date         not null,
  reason     text,
  status     text         not null default 'pending'
             check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz  not null default now(),
  updated_at timestamptz  not null default now(),
  constraint end_after_start check (end_date >= start_date)
);

create index if not exists absences_user_id   on public.absences(user_id);
create index if not exists absences_dates     on public.absences(start_date, end_date);
create index if not exists absences_status    on public.absences(status);

create trigger absences_updated_at
  before update on public.absences
  for each row execute function public.touch_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.absences enable row level security;

-- Lettura: operatore vede le proprie | manager vede quelle della propria org
create policy "absences_select" on public.absences
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = absences.user_id
        and public.my_org_owns_structure(p.structure_id)
    )
  );

-- Inserimento: operatore per sé | manager per operatori della propria org
create policy "absences_insert" on public.absences
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or (
      (select role from public.profiles where id = auth.uid()) = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = absences.user_id
          and public.my_org_owns_structure(p.structure_id)
      )
    )
  );

-- Modifica: solo manager (es. approve / reject)
create policy "absences_update" on public.absences
  for update to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.profiles p
      where p.id = absences.user_id
        and public.my_org_owns_structure(p.structure_id)
    )
  )
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.profiles p
      where p.id = absences.user_id
        and public.my_org_owns_structure(p.structure_id)
    )
  );

-- Eliminazione: manager (qualsiasi stato) oppure operatore (solo le proprie pending)
create policy "absences_delete" on public.absences
  for delete to authenticated
  using (
    (
      (select role from public.profiles where id = auth.uid()) = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = absences.user_id
          and public.my_org_owns_structure(p.structure_id)
      )
    )
    or (
      user_id = auth.uid()
      and status = 'pending'
    )
  );
