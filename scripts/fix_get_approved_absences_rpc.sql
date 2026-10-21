-- ════════════════════════════════════════════════════════════════════
--  RPC per leggere assenze approvate (bypassa RLS)
--  Usata dal solver e dall'OperatorPicker per bloccare gli operatori
--  in ferie in modo affidabile, indipendentemente dalle policy RLS.
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_approved_absences(p_user_ids uuid[])
RETURNS TABLE (
  user_id     uuid,
  start_date  date,
  end_date    date,
  is_full_day boolean,
  slot_type   text,
  start_time  text,
  end_time    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    a.user_id,
    a.start_date,
    a.end_date,
    a.is_full_day,
    a.slot_type,
    a.start_time,
    a.end_time
  FROM absences a
  WHERE
    a.user_id = ANY(p_user_ids)
    AND a.status = 'approved'
    AND EXISTS (
      SELECT 1 FROM profiles caller
      WHERE caller.id = auth.uid()
        AND (
          -- Operatore: vede solo le proprie assenze
          a.user_id = auth.uid()
          OR
          -- Manager / admin_secondary: stessa organizzazione
          (
            caller.role IN ('manager', 'admin_secondary')
            AND EXISTS (
              SELECT 1 FROM profiles op
              WHERE op.id = a.user_id
                AND (
                  op.organization_id = caller.organization_id
                  OR EXISTS (
                    SELECT 1 FROM user_structures us
                    JOIN structures s ON s.id = us.structure_id
                    WHERE us.user_id = op.id
                      AND s.organization_id = caller.organization_id
                  )
                  OR EXISTS (
                    SELECT 1 FROM structures s2
                    WHERE s2.id = op.structure_id
                      AND s2.organization_id = caller.organization_id
                  )
                )
            )
          )
        )
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_approved_absences(uuid[]) TO authenticated;
