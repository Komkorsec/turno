-- =============================================================================
-- Turno – update_user_structures: gestione strutture assegnate da manager
-- Data: 2026-10-15
-- =============================================================================
--
-- Aggiunge due funzioni SECURITY DEFINER:
--
--   1. check_structure_removal_impact(p_user_id, p_remove_ids)
--      → restituisce i turni futuri per le strutture che si vogliono rimuovere
--
--   2. update_user_structures(p_user_id, p_structure_ids, p_remove_future_schedules)
--      → aggiorna user_structures e profiles.structure_id
--        Guard: solo manager della stessa org
--        Guard: p_structure_ids non può essere vuoto
--        Guard: tutte le strutture devono essere dell'org del manager
--        Guard: non si possono modificare le strutture di un altro manager
-- =============================================================================


-- =============================================================================
-- FUNZIONE 1 — check_structure_removal_impact
--   Ritorna le strutture (tra quelle che si vogliono rimuovere) che hanno
--   turni futuri assegnati all'utente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_structure_removal_impact(
  p_user_id    uuid,
  p_remove_ids bigint[]
)
RETURNS TABLE(
  structure_id    bigint,
  structure_name  text,
  schedule_count  int,
  has_published   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    s.structure_id,
    st.name          AS structure_name,
    COUNT(*)::int    AS schedule_count,
    bool_or(s.published) AS has_published
  FROM public.schedules s
  JOIN public.structures st ON st.id = s.structure_id
  WHERE s.user_id       = p_user_id
    AND s.structure_id  = ANY(p_remove_ids)
    AND s.date         >= CURRENT_DATE
    -- Solo manager della stessa org
    AND auth.uid() IS NOT NULL
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND st.organization_id = public.my_organization_id()
  GROUP BY s.structure_id, st.name;
$function$;


-- =============================================================================
-- FUNZIONE 2 — update_user_structures
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_user_structures(
  p_user_id                 uuid,
  p_structure_ids           bigint[],
  p_remove_future_schedules boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role  text;
  v_caller_org   bigint;
  v_target_role  text;
  v_removed_ids  bigint[];
  v_primary_id   bigint;
BEGIN
  -- ── 1. Auth ───────────────────────────────────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT role, organization_id
    INTO v_caller_role, v_caller_org
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'manager' THEN
    RAISE EXCEPTION 'Non autorizzato: solo i manager possono modificare le strutture assegnate.';
  END IF;

  -- ── 2. Almeno una struttura ────────────────────────────────────────────────
  IF p_structure_ids IS NULL OR array_length(p_structure_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Un utente deve appartenere ad almeno una struttura.';
  END IF;

  -- ── 3. Tutte le strutture nella lista devono appartenere all'org ──────────
  IF EXISTS (
    SELECT 1 FROM unnest(p_structure_ids) sid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.structures s
       WHERE s.id = sid AND s.organization_id = v_caller_org
    )
  ) THEN
    RAISE EXCEPTION 'Non autorizzato: alcune strutture non appartengono alla tua organizzazione.';
  END IF;

  -- ── 4. Utente target deve essere nella stessa org ─────────────────────────
  SELECT role INTO v_target_role
    FROM public.profiles
   WHERE id = p_user_id AND organization_id = v_caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Non autorizzato: utente non appartiene alla tua organizzazione.';
  END IF;

  -- ── 5. Non si modificano le strutture di un altro manager ─────────────────
  IF v_target_role = 'manager' THEN
    RAISE EXCEPTION 'Non puoi modificare le strutture di un responsabile.';
  END IF;

  -- ── 6. Calcola strutture da rimuovere (solo is_active=true) ───────────────
  SELECT array_agg(us.structure_id)
    INTO v_removed_ids
    FROM public.user_structures us
   WHERE us.user_id   = p_user_id
     AND us.is_active = true
     AND NOT (us.structure_id = ANY(p_structure_ids::smallint[]));

  -- ── 7. Rimuovi turni futuri se richiesto ──────────────────────────────────
  IF p_remove_future_schedules AND v_removed_ids IS NOT NULL THEN
    DELETE FROM public.schedules
    WHERE user_id      = p_user_id
      AND date        >= CURRENT_DATE
      AND structure_id = ANY(v_removed_ids);
  END IF;

  -- ── 8. Rimuovi assegnazioni non più nella lista (is_active=true) ──────────
  --      Le righe terminate (is_active=false) restano per lo storico.
  IF v_removed_ids IS NOT NULL THEN
    DELETE FROM public.user_structures
    WHERE user_id      = p_user_id
      AND is_active    = true
      AND structure_id = ANY(v_removed_ids);
  END IF;

  -- ── 9. Aggiungi/riattiva strutture ────────────────────────────────────────
  INSERT INTO public.user_structures (user_id, structure_id)
  SELECT p_user_id, sid::smallint
    FROM unnest(p_structure_ids) sid
  ON CONFLICT (user_id, structure_id) DO UPDATE
    SET is_active  = true,
        ended_at   = NULL,
        end_reason = NULL;

  -- ── 10. Sincronizza profiles.structure_id (struttura primaria) ────────────
  SELECT structure_id INTO v_primary_id
    FROM public.profiles
   WHERE id = p_user_id;

  IF v_primary_id IS NULL OR NOT (v_primary_id = ANY(p_structure_ids::smallint[])) THEN
    UPDATE public.profiles
       SET structure_id = (p_structure_ids[1])::smallint
     WHERE id = p_user_id;
  END IF;
END;
$function$;


-- =============================================================================
-- REVOKE / GRANT
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.check_structure_removal_impact(uuid, bigint[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_user_structures(uuid, bigint[], boolean)  FROM PUBLIC, anon;

GRANT  EXECUTE ON FUNCTION public.check_structure_removal_impact(uuid, bigint[]) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.update_user_structures(uuid, bigint[], boolean)  TO authenticated, service_role;
