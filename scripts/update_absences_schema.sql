-- ════════════════════════════════════════════════════════════════════
--  Ferie & Permessi v2 — Schema evolution
--  Aggiunge colonne per fasce orarie parziali e raggruppamento richieste
-- ════════════════════════════════════════════════════════════════════

alter table public.absences
  add column if not exists is_full_day       boolean  not null default true,
  add column if not exists slot_type         text     not null default 'giorno_intero',
  add column if not exists start_time        text,   -- es. '06:00'
  add column if not exists end_time          text,   -- es. '14:00'
  add column if not exists request_group_id  uuid;

create index if not exists absences_group_id on public.absences(request_group_id);
