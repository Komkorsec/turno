-- ════════════════════════════════════════════════════════════════════
--  Fix RLS circolare: structures ↔ user_structures
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- 1. Rimuove la policy che causava il loop (structures → user_structures → structures)
DROP POLICY IF EXISTS "user_structures_manager_read" ON public.user_structures;

-- 2. Mantieni solo la policy "leggo le mie righe" (nessun riferimento a structures → nessun loop)
DROP POLICY IF EXISTS "user_structures_own_read" ON public.user_structures;
CREATE POLICY "user_structures_own_read" ON public.user_structures
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Ricrea structures_read usando una funzione security definer per user_structures
--    (la funzione bypassa RLS → non triggera la policy → nessun loop)
CREATE OR REPLACE FUNCTION public.my_extra_structure_ids()
RETURNS smallint[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(array_agg(structure_id), ARRAY[]::smallint[])
    FROM public.user_structures
   WHERE user_id = auth.uid()
$$;

DROP POLICY IF EXISTS "structures_read" ON public.structures;
CREATE POLICY "structures_read" ON public.structures
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    OR organization_id = public.my_organization_id()
    OR id = public.my_structure_id()
    OR id = ANY(public.my_extra_structure_ids())
  );
