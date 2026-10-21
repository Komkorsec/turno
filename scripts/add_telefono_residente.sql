-- ════════════════════════════════════════════════════════════════════
--  Aggiunge il campo telefono diretto del residente alla tabella residents.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS telefono_residente text;
