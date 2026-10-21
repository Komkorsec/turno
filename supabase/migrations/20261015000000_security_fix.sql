-- =============================================================================
-- Turno – Security Fix Migration
-- Data: 2026-10-15
-- =============================================================================
--
-- Vulnerabilità risolte:
--
-- CRITICO (eseguibile da anon)
--   1. admin_delete_user            – nessun check admin; anon può cancellare qualsiasi utente
--   2. admin_delete_organization    – check email con <> bypassato da NULL JWT
--   3. admin_delete_structure       – idem
--   4. remove_operator              – NULL bypass → anon elimina qualsiasi utente non-manager
--   5. delete_archived_operator     – idem
--   6. get_structure_diaries        – nessun auth check; fuga dati sensibili ospiti
--
-- ALTO
--   7. manager_add_absence          – NULL NOT IN bypass → anon inserisce assenze
--   8. manager_delete_absences      – idem
--   9. set_weekend_off              – NULL <> bypass → anon scrive su profiles
--  10. save_operator_constraints    – NULL NOT IN bypass → idem
--  11. update_operator_contract     – idem
--  12. publish_week_schedules       – primo check bypassed; secondo salva, ma va fixato
--  13. create_structure             – NULL != bypass; safe per accident (org check)
--  14. get_month_schedules          – nessun auth check
--  15. get_week_schedules           – idem
--  16. get_structure_members        – idem
--  17. get_member_absences          – idem
--  18. get_prev_weekend_worked      – idem
--
-- MEDIO
--  19. get_profiles_by_ids          – nessun auth check + search_path mutable
--  20. get_profiles_names           – nessun auth check
--  21. get_structure_manager_ids    – nessun auth check (espone UUID manager)
--  22. count_structure_operators    – nessun auth check
--  23. notify_absence_group         – nessun auth check
--
-- MINORI
--  24. search_path mutable          – get_profiles_by_ids, touch_updated_at, get_expiring_items
--  25. RLS policies su {public}     – diaries, medication_logs, resident_medications, notifications
--
-- PRIVILEGE
--  26. 59 funzioni SECURITY DEFINER eseguibili da anon via /rest/v1/rpc/
--      → REVOKE da public/anon; GRANT ad authenticated
--      → check_email_exists rimane ad anon (usata in Login + ForgotPassword)
--      → ALTER DEFAULT PRIVILEGES per funzioni future
--
-- NOTE:
--   - Il database di produzione NON deve essere toccato senza OK esplicito
--   - Testare in locale con: supabase start && psql ... < questa_migrazione.sql
--   - Rollback: supabase/migrations/20261015000000_security_fix_rollback.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- SEZIONE 1 – Fix critico: funzioni che cancellano auth.users
-- =============================================================================

-- 1a. admin_delete_user
--     PRIMA: controlla solo "non cancellare sé stessi" → per anon auth.uid() = NULL,
--            NULL = p_user_id è NULL → check non scatta → DELETE eseguita.
--     DOPO:  check email admin con IS DISTINCT FROM (NULL-safe) come prima cosa.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'umberto.vignati05@gmail.com' THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'Non puoi eliminare il tuo stesso account.';
  END IF;

  UPDATE public.diaries         SET operator_id = NULL WHERE operator_id = p_user_id;
  UPDATE public.medication_logs SET operator_id = NULL WHERE operator_id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$function$;


-- 1b. admin_delete_organization
--     PRIMA: IF (auth.jwt() ->> 'email') <> 'email' → NULL <> 'email' = NULL → IF false → eseguita.
--     DOPO:  IS DISTINCT FROM (NULL IS DISTINCT FROM 'x' = TRUE → raise).
CREATE OR REPLACE FUNCTION public.admin_delete_organization(p_org_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_structure_id bigint;
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'umberto.vignati05@gmail.com' THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  FOR v_structure_id IN
    SELECT id FROM public.structures WHERE organization_id = p_org_id
  LOOP
    DELETE FROM public.tasks           WHERE structure_id = v_structure_id;
    DELETE FROM public.weekly_tasks    WHERE structure_id = v_structure_id;
    DELETE FROM public.user_structures WHERE structure_id = v_structure_id;
    DELETE FROM public.resident_documents
      WHERE resident_id IN (SELECT id FROM public.residents WHERE structure_id = v_structure_id);
    DELETE FROM public.residents        WHERE structure_id = v_structure_id;
    DELETE FROM public.diaries          WHERE structure_id = v_structure_id;
    DELETE FROM public.invitation_codes WHERE structure_id = v_structure_id;
    DELETE FROM public.schedules        WHERE structure_id = v_structure_id;
    UPDATE public.profiles SET structure_id = NULL WHERE structure_id = v_structure_id;
    DELETE FROM public.structures WHERE id = v_structure_id;
  END LOOP;

  UPDATE public.profiles SET organization_id = NULL WHERE organization_id = p_org_id;
  DELETE FROM public.organizations WHERE id = p_org_id;
END;
$function$;


-- 1c. admin_delete_structure
CREATE OR REPLACE FUNCTION public.admin_delete_structure(p_structure_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'umberto.vignati05@gmail.com' THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  DELETE FROM public.tasks           WHERE structure_id = p_structure_id;
  DELETE FROM public.weekly_tasks    WHERE structure_id = p_structure_id;
  DELETE FROM public.user_structures WHERE structure_id = p_structure_id;
  DELETE FROM public.resident_documents
    WHERE resident_id IN (SELECT id FROM public.residents WHERE structure_id = p_structure_id);
  DELETE FROM public.residents        WHERE structure_id = p_structure_id;
  DELETE FROM public.diaries          WHERE structure_id = p_structure_id;
  DELETE FROM public.invitation_codes WHERE structure_id = p_structure_id;
  DELETE FROM public.schedules        WHERE structure_id = p_structure_id;
  UPDATE public.profiles SET structure_id = NULL WHERE structure_id = p_structure_id;
  DELETE FROM public.structures WHERE id = p_structure_id;
END;
$function$;


-- 1d. remove_operator
--     PRIMA: v_caller_role <> 'manager' → NULL <> 'manager' = NULL → IF false → procede.
--            v_target_org <> v_caller_org → NULL <> bigint = NULL → IF false → DELETE eseguita.
--     DOPO:  guard esplicita auth.uid() IS NULL + IS DISTINCT FROM per org check.
CREATE OR REPLACE FUNCTION public.remove_operator(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role  text;
  v_caller_org   bigint;
  v_target_role  text;
  v_target_org   bigint;
BEGIN
  -- Guard esplicita: auth richiesta
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT p.role, s.organization_id
    INTO v_caller_role, v_caller_org
    FROM public.profiles p
    LEFT JOIN public.structures s ON s.id = p.structure_id
   WHERE p.id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'manager' THEN
    RAISE EXCEPTION 'Non autorizzato: solo i manager possono rimuovere operatori.';
  END IF;

  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'Non puoi eliminare il tuo stesso account.';
  END IF;

  SELECT p.role, s.organization_id
    INTO v_target_role, v_target_org
    FROM public.profiles p
    LEFT JOIN public.structures s ON s.id = p.structure_id
   WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operatore non trovato.';
  END IF;

  -- IS DISTINCT FROM: NULL IS DISTINCT FROM NULL = false,
  --                   NULL IS DISTINCT FROM bigint = true → raise correttamente
  IF v_caller_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'Non autorizzato: l''operatore non appartiene alla tua organizzazione.';
  END IF;

  IF v_target_role NOT IN ('operator', 'admin_secondary', 'coordinator') THEN
    RAISE EXCEPTION 'Non puoi eliminare un manager.';
  END IF;

  UPDATE public.diaries         SET operator_id = NULL WHERE operator_id = p_user_id;
  UPDATE public.medication_logs SET operator_id = NULL WHERE operator_id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$function$;


-- 1e. delete_archived_operator
CREATE OR REPLACE FUNCTION public.delete_archived_operator(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_org  bigint;
  v_target_org  bigint;
  v_target_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT p.role, s.organization_id
    INTO v_caller_role, v_caller_org
    FROM public.profiles p
    JOIN public.structures s ON s.id = p.structure_id
   WHERE p.id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'manager' THEN
    RAISE EXCEPTION 'Non autorizzato: solo i manager possono eliminare operatori.';
  END IF;

  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'Non puoi eliminare il tuo stesso account.';
  END IF;

  SELECT s.organization_id, p.role
    INTO v_target_org, v_target_role
    FROM public.profiles p
    JOIN public.user_structures us ON us.user_id = p.id
    JOIN public.structures s ON s.id = us.structure_id
   WHERE p.id = p_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operatore non trovato.';
  END IF;

  IF v_caller_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'Non autorizzato: operatore non appartiene alla tua organizzazione.';
  END IF;

  IF v_target_role NOT IN ('operator', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non puoi eliminare un manager.';
  END IF;

  UPDATE public.diaries         SET operator_id = NULL WHERE operator_id = p_user_id;
  UPDATE public.medication_logs SET operator_id = NULL WHERE operator_id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$function$;


-- =============================================================================
-- SEZIONE 2 – Fix alto: write functions con NULL bypass
-- =============================================================================

-- 2a. manager_add_absence
--     PRIMA: IF v_role NOT IN → NULL NOT IN = NULL → IF false → INSERT eseguita da anon.
--     DOPO:  guard esplicita + check organizzazione sul target.
CREATE OR REPLACE FUNCTION public.manager_add_absence(
  p_user_id    uuid,
  p_start_date date,
  p_end_date   date,
  p_reason     text DEFAULT NULL
)
 RETURNS TABLE(
   id               bigint,
   user_id          uuid,
   start_date       text,
   end_date         text,
   is_full_day      boolean,
   slot_type        text,
   start_time       text,
   end_time         text,
   reason           text,
   status           text,
   request_group_id uuid
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group uuid := gen_random_uuid();
  v_role  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT profiles.role INTO v_role FROM profiles WHERE profiles.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  -- Verifica che il target appartenga alla stessa organizzazione
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles op
    WHERE op.id = p_user_id
      AND (
        public.my_org_owns_structure(op.structure_id)
        OR op.organization_id = public.my_organization_id()
        OR op.structure_id = ANY(public.my_extra_structure_ids())
      )
  ) THEN
    RAISE EXCEPTION 'Non autorizzato: utente non appartiene alla tua organizzazione.';
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
$function$;


-- 2b. manager_delete_absences
CREATE OR REPLACE FUNCTION public.manager_delete_absences(p_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_org  bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT role, organization_id INTO v_role, v_org
  FROM profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  -- Elimina solo assenze di utenti della stessa organizzazione
  DELETE FROM absences ab
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
$function$;


-- 2c. set_weekend_off
CREATE OR REPLACE FUNCTION public.set_weekend_off(p_user_ids uuid[], p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role <> 'manager' THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  -- Aggiorna solo utenti della stessa organizzazione del manager
  UPDATE public.profiles
     SET last_weekend_off = p_date
   WHERE id = ANY(p_user_ids)
     AND (
       public.my_org_owns_structure(structure_id)
       OR organization_id = public.my_organization_id()
       OR structure_id = ANY(public.my_extra_structure_ids())
     );
END;
$function$;


-- 2d. save_operator_constraints
CREATE OR REPLACE FUNCTION public.save_operator_constraints(
  p_user_id          uuid,
  p_structure_id     integer,
  p_max_hours        integer,
  p_rest_day         text,
  p_shift_preference text,
  p_shift_avoid      text,
  p_recurring_shifts jsonb DEFAULT '[]'::jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  -- Verifica accesso alla struttura
  IF NOT (
    p_structure_id = public.my_structure_id()
    OR public.my_org_owns_structure(p_structure_id)
    OR p_structure_id = ANY(public.my_extra_structure_ids())
  ) THEN
    RAISE EXCEPTION 'Non autorizzato: struttura non accessibile.';
  END IF;

  UPDATE public.user_structures
     SET max_hours_per_week = p_max_hours
   WHERE user_id      = p_user_id
     AND structure_id = p_structure_id;

  IF NOT FOUND THEN
    UPDATE public.profiles
       SET max_hours_per_week = p_max_hours
     WHERE id = p_user_id;
  END IF;

  UPDATE public.profiles SET
    weekly_rest_day  = p_rest_day,
    shift_preference = p_shift_preference,
    shift_avoid      = p_shift_avoid,
    recurring_shifts = COALESCE(p_recurring_shifts, '[]'::jsonb)
  WHERE id = p_user_id;
END;
$function$;


-- 2e. update_operator_contract
CREATE OR REPLACE FUNCTION public.update_operator_contract(
  p_user_id          uuid,
  p_structure_id     integer,
  p_max_hours        integer,
  p_rest_day         text,
  p_shift_preference text,
  p_shift_avoid      text     DEFAULT NULL,
  p_recurring_shifts jsonb    DEFAULT '[]'::jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  IF v_caller_role = 'manager' AND NOT public.my_org_owns_structure(p_structure_id) THEN
    RAISE EXCEPTION 'Non autorizzato: struttura non appartiene alla tua organizzazione.';
  END IF;

  IF v_caller_role = 'admin_secondary' AND NOT (
    p_structure_id = ANY(public.my_extra_structure_ids())
    OR p_structure_id = public.my_structure_id()
  ) THEN
    RAISE EXCEPTION 'Non autorizzato: struttura non assegnata.';
  END IF;

  UPDATE public.profiles SET
    max_hours_per_week = p_max_hours,
    weekly_rest_day    = p_rest_day,
    shift_preference   = p_shift_preference,
    shift_avoid        = p_shift_avoid,
    recurring_shifts   = COALESCE(p_recurring_shifts, '[]'::jsonb)
  WHERE id = p_user_id;
END;
$function$;


-- 2f. publish_week_schedules
--     Il secondo check (my_org_owns_structure) salva già l'anon,
--     ma il primo check va comunque fixato per correttezza.
CREATE OR REPLACE FUNCTION public.publish_week_schedules(
  p_structure_id bigint,
  p_week_start   date,
  p_week_end     date
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_struct_name text;
  v_week_label  text;
  v_start_label text;
  v_end_label   text;
  v_op_id       uuid;
  v_role        text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  IF NOT public.my_org_owns_structure(p_structure_id)
     AND p_structure_id <> ALL(public.my_extra_structure_ids()) THEN
    RAISE EXCEPTION 'Struttura non autorizzata';
  END IF;

  UPDATE public.schedules
     SET published = true
   WHERE structure_id = p_structure_id
     AND date >= p_week_start
     AND date <= p_week_end;

  SELECT name INTO v_struct_name FROM public.structures WHERE id = p_structure_id;

  v_start_label := to_char(p_week_start, 'DD/MM/YYYY');
  v_end_label   := to_char(p_week_end,   'DD/MM/YYYY');
  v_week_label  := v_start_label || ' – ' || v_end_label;

  FOR v_op_id IN
    SELECT DISTINCT s.user_id
      FROM public.schedules s
      JOIN public.profiles  p ON p.id = s.user_id
     WHERE s.structure_id = p_structure_id
       AND s.date >= p_week_start
       AND s.date <= p_week_end
       AND s.published = true
       AND p.role = 'operator'
  LOOP
    INSERT INTO public.notifications(user_id, title, message, type, link)
    VALUES (
      v_op_id,
      '📅 Turni pubblicati · ' || v_week_label,
      'I tuoi turni per la settimana dal ' || v_week_label ||
        coalesce(' · ' || v_struct_name, '') ||
        ' sono stati pubblicati. Apri la sezione I miei turni per vederli.',
      'schedule',
      'shifts:' || to_char(p_week_start, 'YYYY-MM-DD')
    );
  END LOOP;
END;
$function$;


-- 2g. create_structure (overload 1 argomento) – stesso NULL bypass
CREATE OR REPLACE FUNCTION public.create_structure(p_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id bigint;
  v_max    int;
  v_count  int;
  v_new_id bigint;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid())
       IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'Accesso negato: solo i manager possono creare strutture.';
  END IF;

  SELECT organization_id INTO v_org_id
    FROM public.profiles WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Nessuna organizzazione associata a questo account.';
  END IF;

  SELECT max_structures INTO v_max FROM public.organizations WHERE id = v_org_id;
  SELECT count(*) INTO v_count FROM public.structures WHERE organization_id = v_org_id;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
  END IF;

  INSERT INTO public.structures (name, organization_id)
    VALUES (trim(p_name), v_org_id)
    RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;


-- 2g-bis. create_structure (overload 4 argomenti) – NULL bypass safe per accident, ma fix comunque
CREATE OR REPLACE FUNCTION public.create_structure(
  p_name     text,
  p_address  text    DEFAULT NULL,
  p_type     text    DEFAULT NULL,
  p_capacity integer DEFAULT NULL
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id bigint;
  v_max    int;
  v_count  int;
  v_new_id bigint;
BEGIN
  -- IS DISTINCT FROM 'manager': NULL IS DISTINCT FROM 'manager' = TRUE → raise
  IF (SELECT role FROM public.profiles WHERE id = auth.uid())
       IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'Accesso negato: solo i manager possono creare strutture.';
  END IF;

  SELECT organization_id INTO v_org_id
    FROM public.profiles WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Nessuna organizzazione associata a questo account.';
  END IF;

  SELECT max_structures INTO v_max
    FROM public.organizations WHERE id = v_org_id;

  SELECT count(*) INTO v_count
    FROM public.structures WHERE organization_id = v_org_id;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
  END IF;

  INSERT INTO public.structures (name, address, type, capacity, organization_id)
    VALUES (
      trim(p_name),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_type,    '')), ''),
      p_capacity,
      v_org_id
    )
    RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;


-- =============================================================================
-- SEZIONE 3 – Fix esposizione dati: aggiunta auth check a funzioni read
-- =============================================================================

-- 3a. get_structure_diaries – CRITICO: nessun auth check, espone dati clinici ospiti
CREATE OR REPLACE FUNCTION public.get_structure_diaries(
  p_structure_id bigint,
  p_date_from    timestamptz DEFAULT NULL,
  p_limit        integer     DEFAULT 200
)
 RETURNS TABLE(
   id             bigint,
   operator_id    uuid,
   operator_name  text,
   mood           integer,
   has_incident   boolean,
   incident_type  text,
   incident_notes text,
   handover_notes text,
   manager_notes  text,
   created_at     timestamptz,
   edited_at      timestamptz,
   shift_start    text,
   shift_end      text,
   is_urgent      boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    d.id,
    d.operator_id,
    coalesce(p.full_name, 'Operatore rimosso') AS operator_name,
    d.mood,
    d.has_incident,
    d.incident_type,
    d.incident_notes,
    d.handover_notes,
    d.manager_notes,
    d.created_at,
    d.edited_at,
    d.shift_start,
    d.shift_end,
    coalesce(d.is_urgent, false) AS is_urgent
  FROM public.diaries d
  LEFT JOIN public.profiles p ON p.id = d.operator_id
  WHERE d.structure_id = p_structure_id
    AND (p_date_from IS NULL OR d.created_at >= p_date_from)
    -- Auth check: il chiamante deve essere autenticato e avere accesso alla struttura
    AND auth.uid() IS NOT NULL
    AND (
      p_structure_id = public.my_structure_id()
      OR public.my_org_owns_structure(p_structure_id)
      OR p_structure_id = ANY(public.my_extra_structure_ids())
    )
  ORDER BY d.created_at DESC
  LIMIT p_limit;
$function$;


-- 3b. get_month_schedules
CREATE OR REPLACE FUNCTION public.get_month_schedules(
  p_structure_id bigint,
  p_month_start  date,
  p_month_end    date
)
 RETURNS TABLE(
   id           bigint,
   structure_id bigint,
   user_id      uuid,
   date         date,
   shift_type   shift_type,
   label        text,
   created_at   timestamptz,
   updated_at   timestamptz,
   full_name    text,
   is_locked    boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.id, s.structure_id, s.user_id, s.date,
    s.shift_type, s.label, s.created_at, s.updated_at,
    p.full_name, s.is_locked
  FROM public.schedules s
  JOIN public.profiles  p ON p.id = s.user_id
  WHERE s.structure_id = p_structure_id
    AND s.date >= p_month_start
    AND s.date <= p_month_end
    AND auth.uid() IS NOT NULL
    AND (
      p_structure_id = public.my_structure_id()
      OR public.my_org_owns_structure(p_structure_id)
      OR p_structure_id = ANY(public.my_extra_structure_ids())
    )
  ORDER BY s.date, s.shift_type, p.full_name;
$function$;


-- 3c. get_week_schedules
CREATE OR REPLACE FUNCTION public.get_week_schedules(
  p_structure_id bigint,
  p_week_start   date
)
 RETURNS TABLE(
   id           bigint,
   structure_id bigint,
   user_id      uuid,
   date         date,
   shift_type   shift_type,
   label        text,
   created_at   timestamptz,
   updated_at   timestamptz,
   full_name    text,
   is_locked    boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.id, s.structure_id, s.user_id, s.date,
    s.shift_type, s.label, s.created_at, s.updated_at,
    p.full_name, s.is_locked
  FROM public.schedules s
  JOIN public.profiles  p ON p.id = s.user_id
  WHERE s.structure_id = p_structure_id
    AND s.date >= p_week_start
    AND s.date <  p_week_start + interval '7 days'
    AND auth.uid() IS NOT NULL
    AND (
      p_structure_id = public.my_structure_id()
      OR public.my_org_owns_structure(p_structure_id)
      OR p_structure_id = ANY(public.my_extra_structure_ids())
    )
  ORDER BY s.date, s.shift_type, p.full_name;
$function$;


-- 3d. get_structure_members
CREATE OR REPLACE FUNCTION public.get_structure_members(p_structure_id bigint)
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE p.structure_id = p_structure_id
    AND p.role IN ('operator', 'admin_secondary', 'manager')
    AND auth.uid() IS NOT NULL
    AND (
      p_structure_id = public.my_structure_id()
      OR public.my_org_owns_structure(p_structure_id)
      OR p_structure_id = ANY(public.my_extra_structure_ids())
    )

  UNION

  SELECT p.id, p.full_name
  FROM public.user_structures us
  JOIN public.profiles p ON p.id = us.user_id
  WHERE us.structure_id = p_structure_id
    AND us.is_active    = true
    AND p.role IN ('operator', 'admin_secondary', 'manager')
    AND auth.uid() IS NOT NULL
    AND (
      p_structure_id = public.my_structure_id()
      OR public.my_org_owns_structure(p_structure_id)
      OR p_structure_id = ANY(public.my_extra_structure_ids())
    )

  ORDER BY full_name;
$function$;


-- 3e. get_member_absences – nessun auth check, espone tutte le assenze di qualsiasi utente
CREATE OR REPLACE FUNCTION public.get_member_absences(p_user_id uuid)
 RETURNS SETOF absences
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM absences
  WHERE user_id = p_user_id
    AND auth.uid() IS NOT NULL
    AND (
      -- Il chiamante è l'utente stesso
      p_user_id = auth.uid()
      OR
      -- Il chiamante è manager/admin_secondary della stessa organizzazione
      EXISTS (
        SELECT 1 FROM profiles caller
        JOIN profiles target ON target.id = p_user_id
        WHERE caller.id = auth.uid()
          AND caller.role IN ('manager', 'admin_secondary')
          AND (
            caller.organization_id = target.organization_id
            OR public.my_org_owns_structure(target.structure_id)
            OR EXISTS (
              SELECT 1 FROM user_structures us
              JOIN structures s ON s.id = us.structure_id
              WHERE us.user_id = target.id
                AND s.organization_id = caller.organization_id
            )
          )
      )
    )
  ORDER BY start_date DESC;
$function$;


-- 3f. get_profiles_by_ids – nessun auth check + search_path mutable
CREATE OR REPLACE FUNCTION public.get_profiles_by_ids(p_ids uuid[])
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE p.id = ANY(p_ids)
    AND auth.uid() IS NOT NULL;
$function$;


-- 3g. get_profiles_names
CREATE OR REPLACE FUNCTION public.get_profiles_names(p_ids uuid[])
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, full_name
  FROM public.profiles
  WHERE id = ANY(p_ids)
    AND auth.uid() IS NOT NULL;
$function$;


-- 3h. get_structure_manager_ids
--     Usata internamente da trigger SECURITY DEFINER (notify_new_diary, ecc.) dove
--     auth.uid() è l'utente che ha scatenato il trigger → safe.
--     Aggiungere solo auth.uid() IS NOT NULL rischierebbe di rompere le cron function
--     (check_expiring_document_notifications) che girano con service_role.
--     La fix è solo il REVOKE/GRANT (sezione 5).
--     Nessuna modifica al corpo.


-- 3i. get_prev_weekend_worked
CREATE OR REPLACE FUNCTION public.get_prev_weekend_worked(
  p_user_ids uuid[],
  p_sat      date,
  p_sun      date
)
 RETURNS TABLE(user_id uuid, date date, shift_type text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.user_id, s.date, s.shift_type
  FROM schedules s
  WHERE s.user_id = ANY(p_user_ids)
    AND s.date IN (p_sat, p_sun)
    AND s.shift_type != 'speciale'
    AND auth.uid() IS NOT NULL
    AND (
      -- Il chiamante deve essere manager/admin_secondary con accesso agli utenti
      EXISTS (
        SELECT 1 FROM profiles caller
        WHERE caller.id = auth.uid()
          AND caller.role IN ('manager', 'admin_secondary')
      )
      OR
      -- Oppure è uno degli utenti stessi (operatore che vede i propri turni)
      s.user_id = auth.uid()
    );
$function$;


-- 3j. count_structure_operators
CREATE OR REPLACE FUNCTION public.count_structure_operators(p_structure_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  IF NOT (
    p_structure_id = public.my_structure_id()
    OR public.my_org_owns_structure(p_structure_id)
    OR p_structure_id = ANY(public.my_extra_structure_ids())
  ) THEN RETURN 0; END IF;

  RETURN (
    SELECT COUNT(DISTINCT uid)::integer
    FROM (
      SELECT id AS uid
      FROM   public.profiles
      WHERE  structure_id = p_structure_id
        AND  role IN ('operator', 'admin_secondary')
      UNION
      SELECT us.user_id AS uid
      FROM   public.user_structures us
      JOIN   public.profiles p ON p.id = us.user_id
      WHERE  us.structure_id = p_structure_id
        AND  us.is_active    = true
        AND  p.role IN ('operator', 'admin_secondary')
    ) sub
  );
END;
$function$;


-- 3k. notify_absence_group – nessun check, potrebbe essere chiamata da anon
CREATE OR REPLACE FUNCTION public.notify_absence_group(p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_op_name    text;
  v_struct_id  bigint;
  v_manager_id uuid;
  v_slot_count int;
  v_first_date date;
  v_last_date  date;
  v_is_range   boolean;
  v_msg        text;
  v_title      text;
BEGIN
  -- Auth check: solo utenti autenticati
  IF auth.uid() IS NULL THEN RETURN; END IF;

  SELECT
    a.user_id, p.full_name, p.structure_id,
    count(*)::int, min(a.start_date)::date, max(a.end_date)::date, bool_and(a.is_full_day)
  INTO v_user_id, v_op_name, v_struct_id, v_slot_count, v_first_date, v_last_date, v_is_range
  FROM public.absences a
  JOIN public.profiles p ON p.id = a.user_id
  WHERE a.request_group_id = p_group_id
  GROUP BY a.user_id, p.full_name, p.structure_id
  LIMIT 1;

  IF v_user_id IS NULL THEN RETURN; END IF;

  -- Verifica che il chiamante sia lo stesso utente o un manager della struttura
  IF v_user_id <> auth.uid() AND NOT public.my_org_owns_structure(v_struct_id) THEN
    RETURN;
  END IF;

  v_title := 'Richiesta ferie — ' || coalesce(v_op_name, 'Operatore');

  IF v_slot_count = 1 AND v_is_range AND v_last_date > v_first_date THEN
    v_msg := coalesce(v_op_name, 'Un operatore') || ' ha richiesto ferie dal ' ||
             to_char(v_first_date, 'DD/MM') || ' al ' ||
             to_char(v_last_date, 'DD/MM/YYYY') || '.';
  ELSIF v_slot_count = 1 THEN
    v_msg := coalesce(v_op_name, 'Un operatore') || ' ha richiesto un''assenza per il ' ||
             to_char(v_first_date, 'DD/MM/YYYY') || '.';
  ELSE
    v_msg := coalesce(v_op_name, 'Un operatore') || ' ha inviato ' || v_slot_count ||
             ' richieste di ferie/permesso.';
  END IF;

  FOR v_manager_id IN
    SELECT get_structure_manager_ids(v_struct_id)
  LOOP
    IF v_manager_id <> v_user_id THEN
      INSERT INTO public.notifications(user_id, title, message, type, link)
      VALUES (v_manager_id, v_title, v_msg, 'absence', 'team:' || v_struct_id);
    END IF;
  END LOOP;
END;
$function$;


-- =============================================================================
-- SEZIONE 4 – Fix search_path mutable
-- =============================================================================

-- 4a. get_expiring_items – NOT SECURITY DEFINER, aggiunta solo per completezza
CREATE OR REPLACE FUNCTION public.get_expiring_items(
  p_structure_id bigint,
  p_days_ahead   integer DEFAULT 30
)
 RETURNS TABLE(
   resident_id     bigint,
   resident_nome   text,
   resident_cognome text,
   tipo_item       text,
   label_item      text,
   data_scadenza   date,
   days_remaining  integer,
   source          text
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.nome, r.cognome,
    rd.categoria, coalesce(rd.original_name, rd.categoria),
    rd.data_scadenza,
    (rd.data_scadenza - current_date)::int,
    'document'::text
  FROM public.resident_documents rd
  JOIN public.residents r ON r.id = rd.resident_id
  WHERE r.structure_id    = p_structure_id
    AND r.is_archived     = false
    AND rd.legal_record_id IS NULL
    AND rd.data_scadenza   IS NOT NULL
    AND rd.data_scadenza  <= current_date + p_days_ahead

  UNION ALL

  SELECT r.id, r.nome, r.cognome,
    lr.tipo_pratica, lr.tipo_pratica,
    lr.data_scadenza,
    (lr.data_scadenza - current_date)::int,
    'legal_record'::text
  FROM public.resident_legal_records lr
  JOIN public.residents r ON r.id = lr.resident_id
  WHERE r.structure_id  = p_structure_id
    AND r.is_archived   = false
    AND lr.data_scadenza IS NOT NULL
    AND lr.data_scadenza <= current_date + p_days_ahead

  UNION ALL

  SELECT sub.resident_id, sub.nome, sub.cognome,
    sub.tipo, sub.tipo,
    sub.data_scadenza,
    (sub.data_scadenza - current_date)::int,
    'identity_doc'::text
  FROM (
    SELECT DISTINCT ON (id.resident_id, id.tipo)
      id.resident_id, r.nome, r.cognome, id.tipo, id.data_scadenza
    FROM public.resident_identity_docs id
    JOIN public.residents r ON r.id = id.resident_id
    WHERE r.structure_id   = p_structure_id
      AND r.is_archived    = false
      AND id.data_scadenza IS NOT NULL
      AND id.data_scadenza <= current_date + p_days_ahead
    ORDER BY id.resident_id, id.tipo, id.created_at DESC
  ) sub

  ORDER BY data_scadenza ASC;
$function$;


-- 4b. touch_updated_at – trigger, aggiunta search_path
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;


-- =============================================================================
-- SEZIONE 5 – Fix RLS policies: {public} → {authenticated}
-- =============================================================================

-- 5a. diaries – "manager can delete diaries in own structure" ha roles={public}
DROP POLICY IF EXISTS "manager can delete diaries in own structure" ON public.diaries;
CREATE POLICY "manager can delete diaries in own structure"
  ON public.diaries
  FOR DELETE
  TO authenticated
  USING (
    my_organization_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM structures s
      WHERE s.id = diaries.structure_id
        AND s.organization_id = my_organization_id()
    )
  );

-- 5b. medication_logs – sostituisce le policy {public} con {authenticated}
DROP POLICY IF EXISTS "members_insert_logs" ON public.medication_logs;
DROP POLICY IF EXISTS "members_select_logs" ON public.medication_logs;

CREATE POLICY "members_insert_logs"
  ON public.medication_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (is_same_structure_as_resident(resident_id));

CREATE POLICY "members_select_logs"
  ON public.medication_logs
  FOR SELECT
  TO authenticated
  USING (is_same_structure_as_resident(resident_id));

-- 5c. resident_medications
DROP POLICY IF EXISTS "members_insert_medications" ON public.resident_medications;
DROP POLICY IF EXISTS "members_select_medications" ON public.resident_medications;
DROP POLICY IF EXISTS "members_update_medications" ON public.resident_medications;

CREATE POLICY "members_insert_medications"
  ON public.resident_medications
  FOR INSERT
  TO authenticated
  WITH CHECK (is_same_structure_as_resident(resident_id));

CREATE POLICY "members_select_medications"
  ON public.resident_medications
  FOR SELECT
  TO authenticated
  USING (is_same_structure_as_resident(resident_id));

CREATE POLICY "members_update_medications"
  ON public.resident_medications
  FOR UPDATE
  TO authenticated
  USING  (is_same_structure_as_resident(resident_id))
  WITH CHECK (is_same_structure_as_resident(resident_id));

-- 5d. notifications – sostituisce policy {public} con {authenticated}
DROP POLICY IF EXISTS "notif_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notif_update_own" ON public.notifications;

CREATE POLICY "notif_select_own"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notif_update_own"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- SEZIONE 6 – REVOKE/GRANT su tutte le 59 funzioni SECURITY DEFINER
-- =============================================================================
--
-- Strategia:
--   • REVOKE EXECUTE FROM PUBLIC su tutto
--   • GRANT EXECUTE TO authenticated + service_role
--   • GRANT EXECUTE TO anon solo per check_email_exists
--     (usata da Login.jsx e ForgotPassword.jsx prima del login)
--   • Le funzioni trigger non sono chiamabili via RPC ma revocare è corretto
--

-- Admin
REVOKE EXECUTE ON FUNCTION public.admin_delete_organization(bigint)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_structure(bigint)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_users_with_email()                FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_delete_organization(bigint)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_structure(bigint)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_users_with_email()                 TO authenticated, service_role;

-- Resident helpers
REVOKE EXECUTE ON FUNCTION public.can_manage_resident_data(bigint)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hard_delete_resident(text)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_same_structure_as_resident(bigint)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_accessible_resident(bigint)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_accessible_storage_structure(bigint)     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_resident_data(bigint)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hard_delete_resident(text)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_same_structure_as_resident(bigint)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_accessible_resident(bigint)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_accessible_storage_structure(bigint)      TO authenticated, service_role;

-- check_email_exists: mantiene accesso anon (usata prima del login)
REVOKE EXECUTE ON FUNCTION public.check_email_exists(text)                    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_email_exists(text)                    TO anon, authenticated, service_role;

-- Cron / scheduled (solo service_role ha bisogno di chiamarle)
REVOKE EXECUTE ON FUNCTION public.check_appointment_reminders()               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_expiring_document_notifications()     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_missed_medications()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_notifications()                   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.check_appointment_reminders()                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_expiring_document_notifications()      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_missed_medications()                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications()                    TO authenticated, service_role;

-- Structure / operator management
REVOKE EXECUTE ON FUNCTION public.count_structure_operators(bigint)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_structure(text)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_structure(text,text,text,integer)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_archived_employee(bigint)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_archived_operator(uuid)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_archived_employees(integer)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_archived_team_members(integer)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_structure_manager_ids(bigint)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_structure_members(bigint)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_team_members(integer)                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_structure_ids(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_operator(uuid)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.terminate_employment(uuid,integer,date,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.count_structure_operators(bigint)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_structure(text)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_structure(text,text,text,integer)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_archived_employee(bigint)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_archived_operator(uuid)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_archived_employees(integer)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_archived_team_members(integer)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_structure_manager_ids(bigint)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_structure_members(bigint)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_members(integer)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_structure_ids(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_operator(uuid)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminate_employment(uuid,integer,date,text) TO authenticated, service_role;

-- Absences
REVOKE EXECUTE ON FUNCTION public.get_approved_absences(uuid[])               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_absences(uuid)                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_org_absences()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.manager_add_absence(uuid,date,date,text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.manager_delete_absences(bigint[])           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_absence_status(bigint[],text)        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_approved_absences(uuid[])                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_absences(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_org_absences()                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_add_absence(uuid,date,date,text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_delete_absences(bigint[])            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_absence_status(bigint[],text)         TO authenticated, service_role;

-- Diaries / schedules
REVOKE EXECUTE ON FUNCTION public.get_structure_diaries(bigint,timestamptz,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_month_schedules(bigint,date,date)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_week_schedules(bigint,date)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.publish_week_schedules(bigint,date,date)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_weekend_off(uuid[],date)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_prev_weekend_worked(uuid[],date,date)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_structure_diaries(bigint,timestamptz,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_month_schedules(bigint,date,date)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_week_schedules(bigint,date)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_week_schedules(bigint,date,date)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_weekend_off(uuid[],date)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_prev_weekend_worked(uuid[],date,date)    TO authenticated, service_role;

-- Profiles
REVOKE EXECUTE ON FUNCTION public.get_profiles_by_ids(uuid[])                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_profiles_names(uuid[])                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_profiles_by_ids(uuid[])                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profiles_names(uuid[])                   TO authenticated, service_role;

-- Operator constraints
REVOKE EXECUTE ON FUNCTION public.save_operator_constraints(uuid,integer,integer,text,text,text,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_operator_contract(uuid,integer,integer,text,text,text,jsonb)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_operator_constraints(uuid,integer,integer,text,text,text,jsonb)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_operator_contract(uuid,integer,integer,text,text,text,jsonb)   TO authenticated, service_role;

-- Notifications
REVOKE EXECUTE ON FUNCTION public.delete_all_notifications()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read()               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_absence_group(uuid)                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.delete_all_notifications()                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read()                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_absence_group(uuid)                   TO authenticated, service_role;

-- Trigger / internal functions (non chiamabili via RPC ma revocare è corretto)
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_delete_auth_user()                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_absence_request()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_absence_status_change()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_appointment()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_diary()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_document()                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_urgent_diary()                       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.handle_new_user()                            TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_delete_auth_user()                      TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_absence_request()                     TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_absence_status_change()               TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_new_appointment()                     TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_new_diary()                           TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_new_document()                        TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_urgent_diary()                        TO service_role;

-- My_* helpers (usati da RLS – devono essere accessibili ad authenticated)
REVOKE EXECUTE ON FUNCTION public.my_extra_structure_ids()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_org_owns_structure(bigint)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_organization_id()                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_role()                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_structure_id()                           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_extra_structure_ids()                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_org_owns_structure(bigint)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_organization_id()                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_role()                                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_structure_id()                            TO authenticated, service_role;


-- =============================================================================
-- SEZIONE 7 – ALTER DEFAULT PRIVILEGES
--   Funzioni future create in public non saranno eseguibili da PUBLIC/anon.
-- =============================================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;


COMMIT;
