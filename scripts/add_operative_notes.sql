-- Aggiunge campo note operative ai residenti
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS operative_notes text;
