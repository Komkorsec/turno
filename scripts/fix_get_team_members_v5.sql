-- ════════════════════════════════════════════════════════════════════
--  get_team_members v5 — rimuove STABLE (causa caching PostgREST).
--
--  Problema: la funzione era dichiarata STABLE, quindi PostgreSQL/PostgREST
--  poteva restituire il risultato cachato della chiamata precedente nella
--  stessa sessione. Dopo un save, il re-fetch tornava i valori vecchi.
--
--  Fix: la funzione diventa VOLATILE (default senza STABLE/IMMUTABLE),
--  così ogni chiamata legge sempre dati freschi dal DB.
-- ════════════════════════════════════════════════════════════════════

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
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT DISTINCT
    p.id, p.full_name, p.email, p.role, p.created_at,
    p.structure_id, p.max_hours_per_week, p.weekly_rest_day,
    p.shift_preference, p.shift_avoid, p.recurring_shifts,
    p.last_weekend_off, p.contract_pdf_url
  FROM profiles p
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
          SELECT 1 FROM user_structures us
          WHERE us.user_id       = p.id
            AND us.structure_id  = p_structure_id
            AND us.is_active     = false
            AND us.ended_at      IS NOT NULL
        )
        AND (
          p.structure_id = p_structure_id
          OR EXISTS (
            SELECT 1 FROM user_structures us
            WHERE us.user_id      = p.id
              AND us.structure_id = p_structure_id
          )
        )
      )
    )
  ORDER BY p.full_name;
$$;
