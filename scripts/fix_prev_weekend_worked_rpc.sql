-- ════════════════════════════════════════════════════════════════════
--  RPC cross-struttura: turni del weekend precedente per un set di operatori.
--  SECURITY DEFINER → bypassa RLS, restituisce turni da TUTTE le strutture.
--  Necessario per il vincolo V12 (rotazione weekend globale).
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_prev_weekend_worked(uuid[], date, date);

CREATE OR REPLACE FUNCTION public.get_prev_weekend_worked(
  p_user_ids uuid[],
  p_sat      date,
  p_sun      date
)
RETURNS TABLE (user_id uuid, date date, shift_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT s.user_id, s.date, s.shift_type
  FROM schedules s
  WHERE s.user_id = ANY(p_user_ids)
    AND s.date IN (p_sat, p_sun)
    AND s.shift_type != 'speciale';
$$;

GRANT EXECUTE ON FUNCTION public.get_prev_weekend_worked(uuid[], date, date) TO authenticated;
