-- Aggiunge colonna notes alla tabella residents
alter table public.residents
  add column if not exists notes text;
