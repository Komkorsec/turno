-- ════════════════════════════════════════════════════════════════════
--  Fix RLS coordinatore: strutture visibili solo quelle assegnate
-- ════════════════════════════════════════════════════════════════════

-- Il problema: il coordinatore ha organization_id nel profilo, quindi
-- "organization_id = my_organization_id()" passava per TUTTE le strutture
-- dell'org. Ora quella condizione è riservata ai soli manager.

DROP POLICY IF EXISTS "structures_read" ON public.structures;
CREATE POLICY "structures_read" ON public.structures
  FOR SELECT TO authenticated
  USING (
    -- Admin vede tutto
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    -- Manager vede tutte le strutture della propria org
    OR (
      organization_id = public.my_organization_id()
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    )
    -- Operatore vede la propria struttura
    OR id = public.my_structure_id()
    -- Coordinatore (e operatori multi-struttura) vedono solo le strutture assegnate
    OR id = ANY(public.my_extra_structure_ids())
  );

-- Stessa logica per diaries: il coordinatore vede solo i diari
-- delle strutture a lui assegnate, non tutti quelli dell'org
DROP POLICY IF EXISTS "diaries_read" ON public.diaries;
CREATE POLICY "diaries_read" ON public.diaries
  FOR SELECT TO authenticated
  USING (
    -- Operatore: stessa struttura
    structure_id = public.my_structure_id()
    -- Manager: qualsiasi struttura dell'org
    OR (
      public.my_org_owns_structure(structure_id)
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    )
    -- Coordinatore: solo strutture assegnate
    OR structure_id = ANY(public.my_extra_structure_ids())
  );
