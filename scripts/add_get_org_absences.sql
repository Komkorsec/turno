-- ════════════════════════════════════════════════════════════════════
--  Aggiunge / aggiorna RPC get_org_absences
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_org_absences();

CREATE OR REPLACE FUNCTION public.get_org_absences()
RETURNS TABLE (
  absence_id           bigint,
  absence_user_id      uuid,
  start_date           date,
  end_date             date,
  is_full_day          boolean,
  slot_type            text,
  start_time           text,
  end_time             text,
  reason               text,
  status               text,
  request_group_id     uuid,
  created_at           timestamptz,
  full_name            text,
  primary_structure_id bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id      bigint;
  v_caller_role text;
BEGIN
  SELECT p.organization_id, p.role
    INTO v_org_id, v_caller_role
    FROM profiles p
   WHERE p.id = auth.uid();

  IF v_caller_role NOT IN ('manager', 'admin_secondary') THEN
    RETURN;
  END IF;
  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH org_member_ids AS (
    SELECT prof.id AS uid
      FROM profiles prof
     WHERE prof.organization_id = v_org_id
       AND prof.role IN ('operator', 'admin_secondary')

    UNION

    SELECT prof2.id AS uid
      FROM profiles prof2
      JOIN structures str2 ON str2.id = prof2.structure_id
     WHERE str2.organization_id = v_org_id
       AND prof2.role IN ('operator', 'admin_secondary')

    UNION

    SELECT us.user_id AS uid
      FROM user_structures us
      JOIN structures str3 ON str3.id = us.structure_id
      JOIN profiles prof3 ON prof3.id = us.user_id
     WHERE str3.organization_id = v_org_id
       AND prof3.role IN ('operator', 'admin_secondary')
  ),
  member_info AS (
    SELECT
      prof4.id       AS uid,
      prof4.full_name AS fname,
      COALESCE(
        prof4.structure_id,
        (SELECT us2.structure_id
           FROM user_structures us2
          WHERE us2.user_id = prof4.id
          ORDER BY us2.structure_id
          LIMIT 1)
      )              AS struct_id
    FROM profiles prof4
    WHERE prof4.id IN (SELECT uid FROM org_member_ids)
  )
  SELECT
    ab.id                AS absence_id,
    ab.user_id,
    ab.start_date,
    ab.end_date,
    ab.is_full_day,
    ab.slot_type,
    ab.start_time,
    ab.end_time,
    ab.reason,
    ab.status,
    ab.request_group_id,
    ab.created_at,
    mi.fname             AS full_name,
    mi.struct_id::bigint AS primary_structure_id
  FROM absences ab
  JOIN member_info mi ON mi.uid = ab.user_id
  ORDER BY ab.start_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_absences() TO authenticated;
