-- ════════════════════════════════════════════════════════════════════
--  Fix manager_add_absence v2 — usa CTE per evitare ambiguità su "id"
--  Eseguire nel SQL Editor di Supabase
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.manager_add_absence(uuid, date, date, text);

CREATE OR REPLACE FUNCTION public.manager_add_absence(
  p_user_id    uuid,
  p_start_date date,
  p_end_date   date,
  p_reason     text DEFAULT NULL
)
RETURNS TABLE (
  id                bigint,
  user_id           uuid,
  start_date        text,
  end_date          text,
  is_full_day       boolean,
  slot_type         text,
  start_time        text,
  end_time          text,
  reason            text,
  status            text,
  request_group_id  uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_role  text;
BEGIN
  SELECT profiles.role INTO v_role FROM profiles WHERE profiles.id = auth.uid();

  IF v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO absences (
      user_id, start_date, end_date,
      is_full_day, slot_type,
      start_time, end_time,
      reason, status, request_group_id
    )
    VALUES (
      p_user_id, p_start_date, p_end_date,
      true, 'giorno_intero',
      NULL, NULL,
      p_reason, 'approved', v_group
    )
    RETURNING *
  )
  SELECT
    ins.id,
    ins.user_id,
    ins.start_date::text,
    ins.end_date::text,
    ins.is_full_day,
    ins.slot_type,
    ins.start_time::text,
    ins.end_time::text,
    ins.reason,
    ins.status,
    ins.request_group_id
  FROM ins;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_add_absence(uuid, date, date, text) TO authenticated;
