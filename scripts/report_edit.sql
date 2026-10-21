-- ════════════════════════════════════════════════════════
--  Report Edit: modifica con audit trail
-- ════════════════════════════════════════════════════════

-- 1. Colonna edited_at su diaries
alter table public.diaries
  add column if not exists edited_at timestamptz;

-- 2. Tabella storico versioni precedenti
create table if not exists public.report_history (
  id             bigserial primary key,
  diary_id       bigint      not null references public.diaries(id)   on delete cascade,
  edited_by      uuid        not null references public.profiles(id)  on delete cascade,
  edited_at      timestamptz not null default now(),
  -- snapshot della versione precedente
  mood           smallint,
  has_incident   boolean,
  incident_type  text,
  incident_notes text,
  handover_notes text,
  manager_notes  text,
  shift_start    time,
  shift_end      time
);

alter table public.report_history enable row level security;

-- Operatore vede la cronologia dei propri diari
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
           and structure_id = public.my_structure_id()
      )
    )
  );

-- Solo il proprietario del diario può inserire nella history
drop policy if exists "report_history_insert" on public.report_history;
create policy "report_history_insert" on public.report_history
  for insert to authenticated
  with check (edited_by = auth.uid());

-- 3. Policy UPDATE su diaries: solo il proprio
drop policy if exists "diaries_update_own" on public.diaries;
create policy "diaries_update_own" on public.diaries
  for update to authenticated
  using  (operator_id = auth.uid())
  with check (operator_id = auth.uid());

-- 4. Funzione atomica: salva history + aggiorna diario + verifica vincoli
create or replace function public.edit_diary(
  p_diary_id       bigint,
  p_mood           smallint,
  p_has_incident   boolean,
  p_incident_type  text,
  p_incident_notes text,
  p_handover_notes text,
  p_manager_notes  text,
  p_shift_start    time,
  p_shift_end      time
)
returns void language plpgsql
set search_path = public
as $$
declare
  v_old public.diaries%rowtype;
begin
  -- Legge il diario e verifica ownership
  select * into v_old
    from public.diaries
   where id = p_diary_id
     and operator_id = auth.uid();

  if not found then
    raise exception 'Diario non trovato o accesso negato.';
  end if;

  -- Verifica che non esista un diario più recente per la stessa struttura
  if exists (
    select 1 from public.diaries
     where structure_id = v_old.structure_id
       and created_at > v_old.created_at
  ) then
    raise exception 'Modifica non consentita: esiste un report più recente per questa struttura.';
  end if;

  -- Salva la versione precedente
  insert into public.report_history
    (diary_id, edited_by, mood, has_incident, incident_type, incident_notes,
     handover_notes, manager_notes, shift_start, shift_end)
  values
    (p_diary_id, auth.uid(), v_old.mood, v_old.has_incident, v_old.incident_type,
     v_old.incident_notes, v_old.handover_notes, v_old.manager_notes,
     v_old.shift_start, v_old.shift_end);

  -- Aggiorna il diario
  update public.diaries set
    mood           = p_mood,
    has_incident   = p_has_incident,
    incident_type  = p_incident_type,
    incident_notes = p_incident_notes,
    handover_notes = p_handover_notes,
    manager_notes  = p_manager_notes,
    shift_start    = p_shift_start,
    shift_end      = p_shift_end,
    edited_at      = now()
  where id = p_diary_id;
end;
$$;
