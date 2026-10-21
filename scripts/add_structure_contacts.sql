-- Aggiunge email e telefono alla tabella structures (contatti visibili a tutti gli operatori)

ALTER TABLE public.structures
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.structures.email IS 'Email di contatto della comunità (visibile agli operatori nei settings)';
COMMENT ON COLUMN public.structures.phone IS 'Numero di telefono di riferimento (visibile agli operatori nei settings)';
