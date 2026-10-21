-- RLS per la tabella tasks
alter table public.tasks enable row level security;

drop policy if exists "tasks_manager_all" on public.tasks;
drop policy if exists "tasks_operator_select" on public.tasks;
drop policy if exists "tasks_operator_update" on public.tasks;

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

-- Operatori: possono leggere le task assegnate a loro + tutte le task completate della struttura (storico)
create policy "tasks_operator_select"
on public.tasks
for select
to authenticated
using (
  assigned_to = auth.uid()
  or status = 'done'
);

-- Operatori: possono aggiornare solo lo status delle task assegnate a loro
create policy "tasks_operator_update"
on public.tasks
for update
to authenticated
using (assigned_to = auth.uid())
with check (assigned_to = auth.uid());
