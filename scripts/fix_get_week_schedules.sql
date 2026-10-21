-- ════════════════════════════════════════════════════════════════════
--  Corregge get_week_schedules: SECURITY INVOKER → SECURITY DEFINER
--  così il JOIN con profiles non viene bloccato da RLS.
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_week_schedules(bigint, date);

CREATE OR REPLACE FUNCTION public.get_week_schedules(
  p_structure_id bigint,
  p_week_start   date
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
    AND s.date >= p_week_start
    AND s.date <  p_week_start + interval '7 days'
  ORDER BY s.date, s.shift_type, p.full_name;
$$;
