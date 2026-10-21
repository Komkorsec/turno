-- ════════════════════════════════════════════════════════════════════
--  Terminazione rapporto multi-struttura — v2
--
--  1. Crea tabella archived_employees  (storico persistente, sopravvive
--     all'eliminazione dell'account)
--  2. Aggiorna terminate_employment:
--       a. Archivia dati in archived_employees PRIMA di qualsiasi modifica
--       b. Cancella turni FUTURI dell'operatore in questa struttura
--       c. Soft-terminate (is_active = false) in user_structures
--       d. Se non rimangono strutture attive → hard-delete automatico
--  3. Crea get_archived_employees(p_structure_id) — lettura archivio
--  4. Crea delete_archived_employee(p_archive_id) — rimozione definitiva
--     del record dall'archivio (non tocca l'account se ancora attivo altrove)
--
--  Prerequisiti già applicati:
--    - remove_operator.sql  (ON DELETE SET NULL su diaries/medication_logs)
--    - fix_user_hard_delete.sql (trigger trg_delete_auth_user)
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Tabella archived_employees ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.archived_employees (
  id           bigint      NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid        NOT NULL,          -- UUID originale (non FK: l'utente può essere eliminato)
  structure_id integer     NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  full_name    text        NOT NULL,
  email        text,
  role         text,
  started_at   timestamptz,                   -- profiles.created_at al momento dell'archiviazione
  ended_at     date,
  end_reason   text,
  archived_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS archived_employees_structure_idx
  ON public.archived_employees (structure_id);

-- ─── 2. RLS archived_employees ───────────────────────────────────────────────

ALTER TABLE public.archived_employees ENABLE ROW LEVEL SECURITY;

-- Solo manager della stessa organizzazione possono leggere l'archivio
DROP POLICY IF EXISTS "manager_reads_own_org_archives" ON public.archived_employees;
CREATE POLICY "manager_reads_own_org_archives"
  ON public.archived_employees FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.structures s
      JOIN   public.profiles   caller ON caller.id = auth.uid()
      WHERE  s.id              = archived_employees.structure_id
        AND  s.organization_id = caller.organization_id
        AND  caller.role       = 'manager'
    )
  );


-- ─── 3. terminate_employment — versione aggiornata ────────────────────────────

CREATE OR REPLACE FUNCTION public.terminate_employment(
  p_user_id      uuid,
  p_structure_id integer,
  p_ended_at     date,
  p_end_reason   text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_active_count integer;
BEGIN
  -- ── Autorizzazione ───────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1
    FROM   public.structures s
    JOIN   public.profiles   caller ON caller.id = auth.uid()
    WHERE  s.id              = p_structure_id
      AND  s.organization_id = caller.organization_id
      AND  caller.role       = 'manager'
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  -- ── 1. Archivia dati essenziali PRIMA di modificare qualsiasi riga ────────────
  --       Usiamo INSERT ... ON CONFLICT DO NOTHING per idempotenza
  --       (re-run manuale dello script non crea duplicati)
  INSERT INTO public.archived_employees
    (user_id, structure_id, full_name, email, role, started_at, ended_at, end_reason)
  SELECT
    p.id,
    p_structure_id,
    p.full_name,
    p.email,
    p.role,
    p.created_at,
    p_ended_at,
    p_end_reason
  FROM public.profiles p
  WHERE p.id = p_user_id;

  -- ── 2. Cancella turni FUTURI dell'operatore in questa struttura ───────────────
  DELETE FROM public.schedules
  WHERE  user_id      = p_user_id
    AND  structure_id = p_structure_id
    AND  date         > CURRENT_DATE;

  -- ── 3. Soft-terminate in user_structures ─────────────────────────────────────
  UPDATE public.user_structures
  SET    is_active  = false,
         ended_at   = p_ended_at,
         end_reason = p_end_reason
  WHERE  user_id      = p_user_id
    AND  structure_id = p_structure_id;

  -- Inserisce se non esisteva (operatori legacy con solo profiles.structure_id)
  INSERT INTO public.user_structures (user_id, structure_id, is_active, ended_at, end_reason)
  SELECT p_user_id, p_structure_id, false, p_ended_at, p_end_reason
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_structures
    WHERE user_id = p_user_id AND structure_id = p_structure_id
  );

  -- ── 4. Nullifica profiles.structure_id se punta a questa struttura ───────────
  UPDATE public.profiles
  SET    structure_id = NULL
  WHERE  id           = p_user_id
    AND  structure_id = p_structure_id;

  -- ── 5. Auto-elimina se non rimangono strutture attive ────────────────────────
  SELECT COUNT(*) INTO v_active_count
  FROM   public.user_structures
  WHERE  user_id   = p_user_id
    AND  is_active = true;

  IF v_active_count = 0 THEN
    -- Preserva storici: nullifica FK prima dell'eliminazione
    UPDATE public.diaries         SET operator_id = NULL WHERE operator_id = p_user_id;
    UPDATE public.medication_logs SET operator_id = NULL WHERE operator_id = p_user_id;
    -- Hard-delete: il trigger trg_delete_auth_user (o CASCADE) elimina profiles
    DELETE FROM auth.users WHERE id = p_user_id;
  END IF;
END;
$$;

ALTER FUNCTION public.terminate_employment(uuid, integer, date, text) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.terminate_employment(uuid, integer, date, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.terminate_employment(uuid, integer, date, text) TO authenticated;


-- ─── 4. get_archived_employees ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_archived_employees(integer);

CREATE FUNCTION public.get_archived_employees(p_structure_id integer)
RETURNS TABLE (
  archive_id   bigint,
  user_id      uuid,
  full_name    text,
  email        text,
  role         text,
  started_at   timestamptz,
  ended_at     date,
  end_reason   text,
  archived_at  timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    ae.id           AS archive_id,
    ae.user_id,
    ae.full_name,
    ae.email,
    ae.role,
    ae.started_at,
    ae.ended_at,
    ae.end_reason,
    ae.archived_at
  FROM public.archived_employees ae
  WHERE ae.structure_id = p_structure_id
    AND EXISTS (
      SELECT 1
      FROM   public.structures s
      JOIN   public.profiles   caller ON caller.id = auth.uid()
      WHERE  s.id              = p_structure_id
        AND  s.organization_id = caller.organization_id
    )
  ORDER BY ae.ended_at DESC NULLS LAST, ae.archived_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_archived_employees(integer) TO authenticated;


-- ─── 5. delete_archived_employee ─────────────────────────────────────────────
--  Rimuove solo il record dall'archivio.
--  Se l'account esiste ancora (operatore multi-struttura ancora attivo altrove)
--  non viene toccato — solo il record storico viene cancellato.

DROP FUNCTION IF EXISTS public.delete_archived_employee(bigint);

CREATE FUNCTION public.delete_archived_employee(p_archive_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_structure_id integer;
BEGIN
  -- Trova la struttura del record
  SELECT ae.structure_id INTO v_structure_id
    FROM public.archived_employees ae
   WHERE ae.id = p_archive_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record archivio non trovato.';
  END IF;

  -- Verifica autorizzazione
  IF NOT EXISTS (
    SELECT 1
    FROM   public.structures s
    JOIN   public.profiles   caller ON caller.id = auth.uid()
    WHERE  s.id              = v_structure_id
      AND  s.organization_id = caller.organization_id
      AND  caller.role       = 'manager'
  ) THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  -- Elimina solo il record storico
  DELETE FROM public.archived_employees WHERE id = p_archive_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_archived_employee(bigint) TO authenticated;
