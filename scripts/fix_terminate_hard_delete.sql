-- ════════════════════════════════════════════════════════════════════
--  delete_archived_operator — elimina definitivamente un ex-dipendente
--
--  terminate_employment rimane soft (archivio con is_active=false).
--  Questa funzione viene chiamata dal pulsante "Elimina" nell'archivio
--  ex-dipendenti, quando il manager vuole rimuovere definitivamente
--  l'account dal database.
--
--  Funziona su operatori con structure_id = NULL (già archiviati),
--  cercando l'organizzazione tramite user_structures.
--
--  Prerequisito: remove_operator.sql deve essere già stato eseguito
--  (aggiunge ON DELETE SET NULL su diaries.operator_id e
--   medication_logs.operator_id).
--
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_archived_operator(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller_role text;
  v_caller_org  bigint;
  v_target_org  bigint;
  v_target_role text;
BEGIN
  -- Verifica chiamante
  SELECT p.role, s.organization_id
    INTO v_caller_role, v_caller_org
    FROM public.profiles p
    JOIN public.structures s ON s.id = p.structure_id
   WHERE p.id = auth.uid();

  IF v_caller_role <> 'manager' THEN
    RAISE EXCEPTION 'Non autorizzato: solo i manager possono eliminare operatori.';
  END IF;

  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'Non puoi eliminare il tuo stesso account.';
  END IF;

  -- Verifica bersaglio tramite user_structures
  -- (profiles.structure_id è NULL per gli archiviati)
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

  IF v_target_org <> v_caller_org THEN
    RAISE EXCEPTION 'Non autorizzato: operatore non appartiene alla tua organizzazione.';
  END IF;

  IF v_target_role NOT IN ('operator', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non puoi eliminare un manager.';
  END IF;

  -- Preserva diari storici (anche senza ON DELETE SET NULL installato)
  UPDATE public.diaries
     SET operator_id = NULL
   WHERE operator_id = p_user_id;

  UPDATE public.medication_logs
     SET operator_id = NULL
   WHERE operator_id = p_user_id;

  -- Hard delete — CASCADE elimina profiles, user_structures, schedules, ecc.
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

ALTER FUNCTION public.delete_archived_operator(uuid)
  OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.delete_archived_operator(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.delete_archived_operator(uuid) TO authenticated;
