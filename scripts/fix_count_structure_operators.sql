-- ════════════════════════════════════════════════════════════════════
--  RPC: conteggio operatori di una struttura (bypassa RLS)
--
--  Problema: il manager non può leggere user_structures degli altri
--  utenti (policy = solo user_id = auth.uid()), quindi il count
--  torna sempre 0. Stessa cosa per profiles.structure_id quando
--  alcuni operatori sono assegnati solo via user_structures.
--
--  Fix: RPC SECURITY DEFINER che conta l'unione delle due sorgenti.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.count_structure_operators(p_structure_id bigint)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT uid)::integer
  FROM (
    -- Operatori con struttura primaria
    SELECT id AS uid
    FROM   public.profiles
    WHERE  structure_id = p_structure_id
      AND  role IN ('operator', 'admin_secondary')

    UNION

    -- Operatori assegnati via user_structures
    SELECT us.user_id AS uid
    FROM   public.user_structures us
    JOIN   public.profiles p ON p.id = us.user_id
    WHERE  us.structure_id = p_structure_id
      AND  us.is_active    = true
      AND  p.role IN ('operator', 'admin_secondary')
  ) sub
$$;
