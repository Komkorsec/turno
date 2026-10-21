-- ════════════════════════════════════════════════════════════════════
--  Budget ore per-struttura + aggiornamento get_team_members e
--  update_operator_contract.
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- 1. Aggiungi max_hours_per_week a user_structures (per-struttura)
ALTER TABLE public.user_structures
  ADD COLUMN IF NOT EXISTS max_hours_per_week integer;

-- ── 2. get_team_members v5 ────────────────────────────────────────────────────
-- Restituisce max_hours_per_week specifico per struttura:
--   COALESCE(user_structures.max_hours_per_week, profiles.max_hours_per_week)

DROP FUNCTION IF EXISTS public.get_team_members(integer);

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
  shift_preference    text,
  shift_avoid         text,
  recurring_shifts    jsonb,
  last_weekend_off    date,
  contract_pdf_url    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT DISTINCT
    p.id, p.full_name, p.email, p.role, p.created_at,
    p.structure_id,
    COALESCE(us.max_hours_per_week, p.max_hours_per_week) AS max_hours_per_week,
    p.weekly_rest_day,
    p.shift_preference, p.shift_avoid, p.recurring_shifts,
    p.last_weekend_off, p.contract_pdf_url
  FROM profiles p
  LEFT JOIN user_structures us
         ON us.user_id = p.id
        AND us.structure_id = p_structure_id
  WHERE
    EXISTS (
      SELECT 1 FROM structures s
      JOIN   profiles caller ON caller.id = auth.uid()
      WHERE  s.id              = p_structure_id
        AND  s.organization_id = caller.organization_id
    )
    AND (
      p.id = auth.uid()
      OR (
        p.role != 'manager'
        AND NOT EXISTS (
          SELECT 1 FROM user_structures ux
          WHERE ux.user_id      = p.id
            AND ux.structure_id = p_structure_id
            AND ux.is_active    = false
            AND ux.ended_at     IS NOT NULL
        )
        AND (
          p.structure_id = p_structure_id
          OR EXISTS (
            SELECT 1 FROM user_structures uy
            WHERE uy.user_id      = p.id
              AND uy.structure_id = p_structure_id
          )
        )
      )
    )
  ORDER BY p.full_name;
$$;

-- ── 3. update_operator_contract v3 ───────────────────────────────────────────
-- Aggiunge p_structure_id: salva max_hours_per_week in user_structures
-- (se esiste la riga) oppure in profiles (operatori mono-struttura).
-- Gli altri vincoli (rest_day, preference, avoid, recurring) restano globali
-- nel profilo.

DROP FUNCTION IF EXISTS public.update_operator_contract(uuid, integer, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.update_operator_contract(
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
SET search_path = public
AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid())
     NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato.';
  END IF;

  -- Budget ore per-struttura (user_structures ha priorità)
  UPDATE public.user_structures
     SET max_hours_per_week = p_max_hours
   WHERE user_id      = p_user_id
     AND structure_id = p_structure_id;

  -- Nessuna riga user_structures → operatore mono-struttura, aggiorna profiles
  IF NOT FOUND THEN
    UPDATE public.profiles
       SET max_hours_per_week = p_max_hours
     WHERE id = p_user_id;
  END IF;

  -- Vincoli globali (indipendenti dalla struttura)
  UPDATE public.profiles SET
    weekly_rest_day    = p_rest_day,
    shift_preference   = p_shift_preference,
    shift_avoid        = p_shift_avoid,
    recurring_shifts   = COALESCE(p_recurring_shifts, '[]'::jsonb)
  WHERE id = p_user_id;
END;
$$;
