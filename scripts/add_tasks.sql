-- Creazione tabella tasks
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  structure_id  uuid not null references public.structures(id) on delete cascade,
  created_by    uuid not null references public.profiles(id) on delete cascade,
  assigned_to   uuid references public.profiles(id) on delete set null,
  title         text not null,
  description   text,
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'done')),
  completed_at  timestamptz,
  completed_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Indici
create index if not exists tasks_structure_id_idx on public.tasks(structure_id);
create index if not exists tasks_assigned_to_idx  on public.tasks(assigned_to);
create index if not exists tasks_status_idx       on public.tasks(status);
create index if not exists tasks_completed_by_idx on public.tasks(completed_by);

-- RLS
alter table public.tasks enable row level security;

drop policy if exists "tasks_manager_all"      on public.tasks;
drop policy if exists "tasks_operator_select"  on public.tasks;
drop policy if exists "tasks_operator_update"  on public.tasks;

-- Manager e coordinatori: accesso completo alle task delle proprie strutture
create policy "tasks_manager_all"
on public.tasks
for all
to authenticated
using (
  exists (
    select 1 from public.structures s
    where s.id = tasks.structure_id
      and s.organization_id = my_organization_id()
  )
)
with check (
  exists (
    select 1 from public.structures s
    where s.id = tasks.structure_id
      and s.organization_id = my_organization_id()
  )
);

-- Operatori: leggono le task assegnate a loro + tutte le done della struttura
create policy "tasks_operator_select"
on public.tasks
for select
to authenticated
using (
  assigned_to = auth.uid()
  or status = 'done'
);

-- Operatori: aggiornano solo le task assegnate a loro
create policy "tasks_operator_update"
on public.tasks
for update
to authenticated
using (assigned_to = auth.uid())
with check (assigned_to = auth.uid());
