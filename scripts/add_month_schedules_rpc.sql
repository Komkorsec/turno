-- ════════════════════════════════════════════════════════════════════
--  RPC: turni di un intero mese per una struttura
--  Stessa struttura di get_week_schedules ma con range mensile.
--  Necessario per la vista mensile del pianificatore turni.
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_month_schedules(bigint, date, date);

CREATE OR REPLACE FUNCTION public.get_month_schedules(
  p_structure_id bigint,
  p_month_start  date,
  p_month_end    date
)
RETURNS TABLE (
  id           bigint,
  structure_id bigint,
  user_id      uuid,
  date         date,
  shift_type   public.shift_type,
  label        text,
  created_at   timestamptz,
  updated_at   timestamptz,
  full_name    text,
  is_locked    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.structure_id,
    s.user_id,
    s.date,
    s.shift_type,
    s.label,
    s.created_at,
    s.updated_at,
    p.full_name,
    s.is_locked
  FROM public.schedules s
  JOIN public.profiles  p ON p.id = s.user_id
  WHERE s.structure_id = p_structure_id
    AND s.date >= p_month_start
    AND s.date <= p_month_end
  ORDER BY s.date, s.shift_type, p.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_month_schedules(bigint, date, date) TO authenticated;
