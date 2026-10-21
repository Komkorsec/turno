-- Aggiunge end_date a resident_medications per la gestione della durata terapia.
-- is_active esiste già con default true — nessuna modifica necessaria.

ALTER TABLE public.resident_medications
  ADD COLUMN IF NOT EXISTS end_date date;

-- Indice per velocizzare il filtro nella vista giornaliera
CREATE INDEX IF NOT EXISTS idx_resident_medications_end_date
  ON public.resident_medications (end_date)
  WHERE end_date IS NOT NULL;

-- Commento esplicativo
COMMENT ON COLUMN public.resident_medications.end_date IS
  'NULL = terapia cronica (nessuna scadenza). Data = ultimo giorno di somministrazione incluso.';
