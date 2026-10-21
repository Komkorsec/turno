-- ════════════════════════════════════════════════════════════════════
--  STEP 1 — Esegui questa query per trovare il tipo di ritorno:
--
--  SELECT pg_get_function_result(oid)
--  FROM pg_proc
--  WHERE proname = 'my_extra_structure_ids'
--    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
--
--  STEP 2 — Poi esegui il blocco qui sotto sostituendo <TIPO> con
--           il valore trovato (es. bigint, integer, smallint, int4…)
-- ════════════════════════════════════════════════════════════════════

-- Ricrea la funzione con CASCADE (ricostruisce le policy automaticamente
-- perché le policy referenziano il nome, non l'OID della funzione)
DROP FUNCTION IF EXISTS public.my_extra_structure_ids() CASCADE;

CREATE FUNCTION public.my_extra_structure_ids()
RETURNS SETOF bigint   -- ← cambia questo se la query STEP 1 restituisce un tipo diverso
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT structure_id
  FROM   public.user_structures
  WHERE  user_id   = auth.uid()
    AND  is_active = true
$$;
