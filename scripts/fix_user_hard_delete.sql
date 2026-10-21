-- ════════════════════════════════════════════════════════════════════
--  Fix eliminazione utente: sincronizza public.profiles → auth.users
--
--  Problema: DELETE su public.profiles non rimuoveva la riga in
--  auth.users → l'email restava bloccata e non si poteva ricreare
--  l'account.
--
--  Soluzione (a due livelli):
--  1. TRIGGER  — AFTER DELETE su profiles elimina auth.users
--               (rete di sicurezza, indipendente dall'app)
--  2. RPC      — remove_operator / admin_delete_user ora cancellano
--               da auth.users PRIMA (il CASCADE gestisce profiles),
--               evitando dipendenze FK inverse.
--
--  Esegui nel SQL Editor di Supabase (una sola volta).
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Funzione trigger: elimina auth.users quando profiles viene cancellato ──

CREATE OR REPLACE FUNCTION public.sync_delete_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rimuove l'utente dall'autenticazione Supabase.
  -- SECURITY DEFINER garantisce che giri con i permessi del proprietario
  -- della funzione (postgres), che ha accesso ad auth.users.
  DELETE FROM auth.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

-- Assicura che la funzione giri come postgres (superuser Supabase)
ALTER FUNCTION public.sync_delete_auth_user() OWNER TO postgres;

-- Crea il trigger (idempotente)
DROP TRIGGER IF EXISTS trg_delete_auth_user ON public.profiles;

CREATE TRIGGER trg_delete_auth_user
  AFTER DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_delete_auth_user();


-- ─── 2. remove_operator — nuovo ordine: auth.users prima, CASCADE gestisce profiles ──

CREATE OR REPLACE FUNCTION public.remove_operator(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  text;
  v_caller_org   bigint;
  v_target_role  text;
  v_target_org   bigint;
BEGIN
  -- ── Verifica chiamante ─────────────────────────────────────────────────────
  SELECT p.role, s.organization_id
    INTO v_caller_role, v_caller_org
    FROM public.profiles p
    LEFT JOIN public.structures s ON s.id = p.structure_id
   WHERE p.id = auth.uid();

  IF v_caller_role <> 'manager' THEN
    RAISE EXCEPTION 'Non autorizzato: solo i manager possono rimuovere operatori.';
  END IF;

  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'Non puoi eliminare il tuo stesso account.';
  END IF;

  -- ── Verifica bersaglio ─────────────────────────────────────────────────────
  SELECT p.role, s.organization_id
    INTO v_target_role, v_target_org
    FROM public.profiles p
    LEFT JOIN public.structures s ON s.id = p.structure_id
   WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operatore non trovato.';
  END IF;

  IF v_target_org <> v_caller_org THEN
    RAISE EXCEPTION 'Non autorizzato: l''operatore non appartiene alla tua organizzazione.';
  END IF;

  IF v_target_role NOT IN ('operator', 'admin_secondary', 'coordinator') THEN
    RAISE EXCEPTION 'Non puoi eliminare un manager.';
  END IF;

  -- ── 1. Preserva dati storici: nullifica FK prima di eliminare ─────────────
  UPDATE public.diaries
     SET operator_id = NULL
   WHERE operator_id = p_user_id;

  UPDATE public.medication_logs
     SET operator_id = NULL
   WHERE operator_id = p_user_id;

  -- ── 2. Elimina da auth.users → CASCADE rimuove automaticamente:
  --       profiles, schedules, notifications, absences, user_structures,
  --       diary_comments, report_views, report_edits, ecc.
  DELETE FROM auth.users WHERE id = p_user_id;

  -- Nota: il trigger trg_delete_auth_user su profiles è una rete di
  -- sicurezza, ma qui cancelliamo direttamente da auth.users, quindi
  -- il trigger non viene invocato (CASCADE è più veloce).
END;
$$;

ALTER FUNCTION public.remove_operator(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.remove_operator(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.remove_operator(uuid) TO authenticated;


-- ─── 3. admin_delete_user — stesso fix ordine operazioni ──────────────────────

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'Non puoi eliminare il tuo stesso account.';
  END IF;

  -- Preserva dati storici
  UPDATE public.diaries
     SET operator_id = NULL
   WHERE operator_id = p_user_id;

  UPDATE public.medication_logs
     SET operator_id = NULL
   WHERE operator_id = p_user_id;

  -- Elimina da auth.users → CASCADE gestisce tutto il resto
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

ALTER FUNCTION public.admin_delete_user(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;


-- ─── 4. Verifica: controlla che il trigger esista ─────────────────────────────
-- Esegui per conferma (facoltativo):
--
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'profiles'
--   AND trigger_schema = 'public';
