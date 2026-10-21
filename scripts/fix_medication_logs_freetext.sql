-- Rende medication_id opzionale per somministrazioni extra free-text
alter table public.medication_logs
  alter column medication_id drop not null;

-- Campo testo libero per farmaci non in terapia attiva
alter table public.medication_logs
  add column if not exists medication_name text;
