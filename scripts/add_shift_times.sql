-- Aggiunge i campi orario inizio/fine turno alla tabella diaries
alter table public.diaries
  add column if not exists shift_start time,
  add column if not exists shift_end   time;
