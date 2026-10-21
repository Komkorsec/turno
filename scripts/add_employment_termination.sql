-- ════════════════════════════════════════════════════════════════════
--  Fine Rapporto di Lavoro — schema + RPC
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Nuove colonne su user_structures ─────────────────────────────────────

ALTER TABLE public.user_structures
  ADD COLUMN IF NOT EXISTS is_active   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ended_at    date,
  ADD COLUMN IF NOT EXISTS end_reason  text;

-- ─── 2. my_extra_structure_ids: aggiornata separatamente (vedi fix_extra_structure_ids.sql) ──

-- ─── 3. RPC terminate_employment ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.terminate_employment(
  p_user_id      uuid,
  p_structure_id integer,
  p_ended_at     date,
  p_end_reason   text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Solo manager della stessa organizzazione può terminare un rapporto
  IF NOT EXISTS (
    SELECT 1
    FROM   structures s
    JOIN   profiles caller ON caller.id = auth.uid()
    WHERE  s.id               = p_structure_id
      AND  s.organization_id  = caller.organization_id
      AND  caller.role        = 'manager'
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  -- Aggiorna se la riga esiste già in user_structures
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

  -- Rimuove anche il legame diretto su profiles (sicurezza accesso)
  UPDATE public.profiles
  SET    structure_id = NULL
  WHERE  id           = p_user_id
    AND  structure_id = p_structure_id;
END;
$$;

-- ─── 4. Aggiorna get_team_members: solo membri attivi ────────────────────────

CREATE OR REPLACE FUNCTION public.get_team_members(p_structure_id integer)
RETURNS TABLE (
  id                  uuid,
  full_name           text,
  email               text,
  role                text,
  created_at          timestamptz,
  structure_id        integer,
  max_hours_per_week  integer,
  weekly_rest_day     text,
  contract_pdf_url    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT DISTINCT
    p.id, p.full_name, p.email, p.role, p.created_at,
    p.structure_id, p.max_hours_per_week, p.weekly_rest_day, p.contract_pdf_url
  FROM profiles p
  WHERE
    EXISTS (
      SELECT 1 FROM structures s
      JOIN   profiles caller ON caller.id = auth.uid()
      WHERE  s.id              = p_structure_id
        AND  s.organization_id = caller.organization_id
    )
    AND (
      -- il manager chiamante: sempre incluso
      p.id = auth.uid()
      -- operatori/coordinatori attivi nella struttura
      OR (
        p.role != 'manager'
        AND (
          (p.structure_id = p_structure_id
           AND NOT EXISTS (
             SELECT 1 FROM user_structures us
             WHERE us.user_id = p.id AND us.structure_id = p_structure_id AND us.is_active = false
           ))
          OR EXISTS (
            SELECT 1 FROM user_structures us
            WHERE us.user_id      = p.id
              AND us.structure_id = p_structure_id
              AND us.is_active    = true
          )
        )
      )
    )
  ORDER BY p.full_name;
$$;

-- ─── 5. RPC get_archived_team_members ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_archived_team_members(p_structure_id integer)
RETURNS TABLE (
  id          uuid,
  full_name   text,
  email       text,
  role        text,
  started_at  timestamptz,
  ended_at    date,
  end_reason  text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.role,
    p.created_at   AS started_at,
    us.ended_at,
    us.end_reason
  FROM public.user_structures us
  JOIN public.profiles p ON p.id = us.user_id
  WHERE us.structure_id = p_structure_id
    AND us.is_active    = false
    AND EXISTS (
      SELECT 1 FROM structures s
      JOIN   profiles caller ON caller.id = auth.uid()
      WHERE  s.id              = p_structure_id
        AND  s.organization_id = caller.organization_id
    )
  ORDER BY us.ended_at DESC NULLS LAST;
$$;
