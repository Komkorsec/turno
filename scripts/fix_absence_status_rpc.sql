-- ════════════════════════════════════════════════════════════════════
--  RPC per aggiornare lo status delle assenze (bypassa RLS)
--  Chiamabile solo da manager / admin_secondary della stessa org.
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_absence_status(
  p_ids    bigint[],
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_org  bigint;
BEGIN
  -- Solo manager / coordinatore
  SELECT role, organization_id
    INTO v_role, v_org
    FROM profiles
   WHERE id = auth.uid();

  IF v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  IF p_status NOT IN ('approved', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'Status non valido.';
  END IF;

  -- Aggiorna solo le assenze che appartengono alla stessa organizzazione
  UPDATE absences ab
     SET status = p_status
   WHERE ab.id = ANY(p_ids)
     AND EXISTS (
       SELECT 1 FROM profiles op
        WHERE op.id = ab.user_id
          AND (
            op.organization_id = v_org
            OR EXISTS (
              SELECT 1 FROM user_structures us
              JOIN structures s ON s.id = us.structure_id
              WHERE us.user_id = op.id AND s.organization_id = v_org
            )
            OR EXISTS (
              SELECT 1 FROM structures s2
              WHERE s2.id = op.structure_id AND s2.organization_id = v_org
            )
          )
     );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_absence_status(bigint[], text) TO authenticated;
