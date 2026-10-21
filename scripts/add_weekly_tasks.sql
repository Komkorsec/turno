-- ─── Mansioni settimanali ricorrenti ──────────────────────────────────────────

create table if not exists public.weekly_tasks (
  id           uuid primary key default gen_random_uuid(),
  structure_id smallint not null references public.structures(id) on delete cascade,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  description  text,
  day_of_week  smallint not null check (day_of_week between 1 and 7), -- 1=Lun … 7=Dom
  shift        text not null check (shift in ('mattina', 'pomeriggio', 'notte')),
  created_at   timestamptz not null default now()
);

-- ─── Log completamenti (una spunta per task per settimana) ─────────────────────

create table if not exists public.weekly_task_logs (
  id             uuid primary key default gen_random_uuid(),
  weekly_task_id uuid not null references public.weekly_tasks(id) on delete cascade,
  completed_by   uuid not null references public.profiles(id) on delete cascade,
  week_start     date not null,        -- sempre il lunedì della settimana corrente
  completed_at   timestamptz not null default now(),
  unique (weekly_task_id, week_start)  -- una sola firma per task per settimana
);

-- ─── Indici ────────────────────────────────────────────────────────────────────

create index if not exists weekly_tasks_structure_idx     on public.weekly_tasks(structure_id);
create index if not exists weekly_task_logs_task_idx      on public.weekly_task_logs(weekly_task_id);
create index if not exists weekly_task_logs_week_idx      on public.weekly_task_logs(week_start);

-- ─── RLS weekly_tasks ──────────────────────────────────────────────────────────

alter table public.weekly_tasks enable row level security;

drop policy if exists "weekly_tasks_manager_all"     on public.weekly_tasks;
drop policy if exists "weekly_tasks_operator_select" on public.weekly_tasks;

-- Manager/coordinatore: accesso completo alle mansioni della propria org
create policy "weekly_tasks_manager_all"
on public.weekly_tasks for all to authenticated
using (
  exists (
    select 1 from public.structures s
    where s.id = weekly_tasks.structure_id
      and s.organization_id = my_organization_id()
  )
)
with check (
  exists (
    select 1 from public.structures s
    where s.id = weekly_tasks.structure_id
      and s.organization_id = my_organization_id()
  )
);

-- Operatori: lettura mansioni della propria struttura
create policy "weekly_tasks_operator_select"
on public.weekly_tasks for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.structure_id = weekly_tasks.structure_id
  )
);

-- ─── RLS weekly_task_logs ──────────────────────────────────────────────────────

alter table public.weekly_task_logs enable row level security;

drop policy if exists "weekly_task_logs_manager_all"     on public.weekly_task_logs;
drop policy if exists "weekly_task_logs_operator_select" on public.weekly_task_logs;
drop policy if exists "weekly_task_logs_operator_insert" on public.weekly_task_logs;

-- Manager/coordinatore: accesso completo ai log della propria org
create policy "weekly_task_logs_manager_all"
on public.weekly_task_logs for all to authenticated
using (
  exists (
    select 1 from public.weekly_tasks wt
    join public.structures s on s.id = wt.structure_id
    where wt.id = weekly_task_logs.weekly_task_id
      and s.organization_id = my_organization_id()
  )
)
with check (
  exists (
    select 1 from public.weekly_tasks wt
    join public.structures s on s.id = wt.structure_id
    where wt.id = weekly_task_logs.weekly_task_id
      and s.organization_id = my_organization_id()
  )
);

-- Operatori: leggono i log della propria struttura
create policy "weekly_task_logs_operator_select"
on public.weekly_task_logs for select to authenticated
using (
  exists (
    select 1 from public.weekly_tasks wt
    join public.profiles p on p.id = auth.uid()
    where wt.id = weekly_task_logs.weekly_task_id
      and p.structure_id = wt.structure_id
  )
);

-- Operatori: possono inserire solo log a proprio nome per la propria struttura
create policy "weekly_task_logs_operator_insert"
on public.weekly_task_logs for insert to authenticated
with check (
  completed_by = auth.uid()
  and exists (
    select 1 from public.weekly_tasks wt
    join public.profiles p on p.id = auth.uid()
    where wt.id = weekly_task_logs.weekly_task_id
      and p.structure_id = wt.structure_id
  )
);
