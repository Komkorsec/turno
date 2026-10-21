-- ════════════════════════════════════════════════════════════════════
--  RPC per gestione assenze singolo operatore (da MemberProfileSheet)
--  Eseguire nel SQL Editor di Supabase — una funzione alla volta
--  se il timeout persiste.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Leggi tutte le assenze di un operatore ─────────────────────
DROP FUNCTION IF EXISTS public.get_member_absences(uuid);

CREATE OR REPLACE FUNCTION public.get_member_absences(p_user_id uuid)
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
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Solo manager / coordinatori possono leggere assenze altrui
  IF (SELECT role FROM profiles WHERE id = auth.uid())
       NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.user_id,
    a.start_date::text,
    a.end_date::text,
    a.is_full_day,
    a.slot_type,
    a.start_time::text,
    a.end_time::text,
    a.reason,
    a.status,
    a.request_group_id
  FROM absences a
  WHERE a.user_id = p_user_id
  ORDER BY a.start_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_member_absences(uuid) TO authenticated;

-- ── 2. Aggiungi un'assenza approvata ──────────────────────────────
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
  v_new_id bigint;
  v_group  uuid := gen_random_uuid();
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid())
       NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  INSERT INTO absences (user_id, start_date, end_date, is_full_day, slot_type,
                        start_time, end_time, reason, status, request_group_id)
  VALUES (p_user_id, p_start_date, p_end_date, true, 'giorno_intero',
          NULL, NULL, p_reason, 'approved', v_group)
  RETURNING absences.id INTO v_new_id;

  RETURN QUERY
  SELECT
    a.id, a.user_id,
    a.start_date::text, a.end_date::text,
    a.is_full_day, a.slot_type,
    a.start_time::text, a.end_time::text,
    a.reason, a.status, a.request_group_id
  FROM absences a
  WHERE a.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_add_absence(uuid, date, date, text) TO authenticated;

-- ── 3. Elimina assenze per ID ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.manager_delete_absences(bigint[]);

CREATE OR REPLACE FUNCTION public.manager_delete_absences(p_ids bigint[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid())
       NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  DELETE FROM absences WHERE id = ANY(p_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_delete_absences(bigint[]) TO authenticated;
