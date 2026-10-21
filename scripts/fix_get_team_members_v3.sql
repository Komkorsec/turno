-- ════════════════════════════════════════════════════════════════════
--  Fix get_team_members v3 — logica inclusiva più robusta
--
--  Problema: operatori con profilo.structure_id corretto ma con riga
--  user_structures in stato anomalo venivano esclusi.
--
--  Nuova logica:
--  - Includi se: profile.structure_id = p_structure_id
--                OR ha una riga user_structures per questa struttura
--  - Escludi solo se: terminato esplicitamente
--                     (is_active=false AND ended_at IS NOT NULL)
-- ════════════════════════════════════════════════════════════════════

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
    -- Verifica che il chiamante abbia accesso a questa struttura
    EXISTS (
      SELECT 1 FROM structures s
      JOIN   profiles caller ON caller.id = auth.uid()
      WHERE  s.id              = p_structure_id
        AND  s.organization_id = caller.organization_id
    )
    AND (
      -- Il manager chiamante: sempre incluso
      p.id = auth.uid()

      -- Operatori/coordinatori: inclusi se appartengono alla struttura
      OR (
        p.role != 'manager'

        -- Non terminati esplicitamente
        AND NOT EXISTS (
          SELECT 1 FROM user_structures us
          WHERE us.user_id       = p.id
            AND us.structure_id  = p_structure_id
            AND us.is_active     = false
            AND us.ended_at      IS NOT NULL
        )

        -- Appartengono alla struttura tramite profile.structure_id
        -- oppure tramite user_structures (anche senza riga esplicita)
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
