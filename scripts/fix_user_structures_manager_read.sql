-- ════════════════════════════════════════════════════════════════════
--  Funzione security definer per leggere le strutture di un operatore
--  (bypass RLS necessario perché la policy su user_structures
--   permette solo di leggere le proprie righe)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_structure_ids(p_user_id uuid)
RETURNS smallint[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(array_agg(us.structure_id), ARRAY[]::smallint[])
    FROM public.user_structures us
    JOIN public.structures st ON st.id = us.structure_id
   WHERE us.user_id = p_user_id
     AND st.organization_id = public.my_organization_id()
$$;
