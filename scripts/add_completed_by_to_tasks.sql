-- Aggiunge la colonna completed_by alla tabella tasks
-- Traccia quale operatore ha completato la task

alter table public.tasks
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

create index if not exists tasks_completed_by_idx on public.tasks(completed_by);
