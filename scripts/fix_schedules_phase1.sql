-- ════════════════════════════════════════════════════════════════════
--  Fix schedules_phase1:
--  my_org_owns_structure era definita con `int` ma structures.id è
--  bigserial (bigint) → PostgreSQL non risolve la chiamata.
--  Ricrea la funzione con bigint e ri-applica tutto lo schema schedules.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Ricrea my_org_owns_structure con bigint ───────────────────────────────

create or replace function public.my_org_owns_structure(p_structure_id bigint)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.structures
     where id = p_structure_id
       and organization_id = public.my_organization_id()
  )
$$;

-- ─── 2. Enum shift_type (idempotente) ────────────────────────────────────────

do $$ begin
  create type public.shift_type as enum ('mattina', 'pomeriggio', 'notte', 'speciale');
exception
  when duplicate_object then null;
end $$;

-- ─── 3. Tabella schedules ────────────────────────────────────────────────────

create table if not exists public.schedules (
  id           bigserial         primary key,
  structure_id bigint            not null references public.structures(id) on delete cascade,
  user_id      uuid              not null references public.profiles(id)   on delete cascade,
  date         date              not null,
  shift_type   public.shift_type not null,
  label        text,
  created_at   timestamptz       not null default now(),
  updated_at   timestamptz       not null default now(),

  unique (structure_id, user_id, date, shift_type)
);

create index if not exists schedules_structure_date_idx
  on public.schedules (structure_id, date);

-- ─── 4. Trigger updated_at ───────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists schedules_updated_at on public.schedules;
create trigger schedules_updated_at
  before update on public.schedules
  for each row execute function public.touch_updated_at();

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────

alter table public.schedules enable row level security;

drop policy if exists "schedules_manager_all"     on public.schedules;
drop policy if exists "schedules_operator_select" on public.schedules;

-- Manager: CRUD completo sulle strutture della propria organizzazione
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

-- Operatori / admin_secondary: solo lettura sulla propria struttura
create policy "schedules_operator_select" on public.schedules
  for select to authenticated
  using (
    structure_id = public.my_structure_id()
  );

-- ─── 6. Funzione RPC get_week_schedules ──────────────────────────────────────

create or replace function public.get_week_schedules(
  p_structure_id bigint,
  p_week_start   date
)
returns table (
  id           bigint,
  structure_id bigint,
  user_id      uuid,
  date         date,
  shift_type   public.shift_type,
  label        text,
  created_at   timestamptz,
  updated_at   timestamptz,
  full_name    text
)
language sql stable security invoker
set search_path = public
as $$
  select
    s.id,
    s.structure_id,
    s.user_id,
    s.date,
    s.shift_type,
    s.label,
    s.created_at,
    s.updated_at,
    p.full_name
  from public.schedules s
  join public.profiles  p on p.id = s.user_id
  where s.structure_id = p_structure_id
    and s.date >= p_week_start
    and s.date <  p_week_start + interval '7 days'
  order by s.date, s.shift_type, p.full_name;
$$;
