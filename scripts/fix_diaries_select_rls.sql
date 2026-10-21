-- ════════════════════════════════════════════════════════════════════
--  Fix: SELECT RLS su diaries per manager e coordinatori
--
--  Problema: la policy "diaries_read" usa
--      structure_id = (select structure_id from profiles where id = auth.uid())
--  I manager hanno structure_id = NULL nel profilo → vedono 0 diari.
--  Questo rompe OrgDashboard (tab Oggi, Settimana, HR).
--
--  Fix: policy SELECT allineata alla policy INSERT (fix_diaries_insert_rls.sql):
--    - manager:         my_org_owns_structure(structure_id)
--    - admin_secondary: strutture extra assegnate
--    - operator:        struttura principale o extra
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "diaries_read"               ON public.diaries;
DROP POLICY IF EXISTS "diaries_operator_read"      ON public.diaries;
DROP POLICY IF EXISTS "diaries_manager_read"       ON public.diaries;

CREATE POLICY "diaries_read" ON public.diaries
  FOR SELECT TO authenticated
  USING (
    (
      -- manager: tutte le strutture della propria org
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      AND public.my_org_owns_structure(structure_id)
    )
    OR (
      -- admin_secondary: strutture extra assegnate
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
      AND structure_id = ANY(public.my_extra_structure_ids())
    )
    OR (
      -- operator: struttura principale o strutture extra
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operator'
      AND (
        structure_id = public.my_structure_id()
        OR structure_id = ANY(public.my_extra_structure_ids())
      )
    )
  );
