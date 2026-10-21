-- ════════════════════════════════════════════════════════════════════
--  Permessi coordinatore (admin_secondary)
--  Stessi poteri operativi del manager, escluso:
--    - generazione codici invito
--    - eliminazione struttura
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Schedules (turni) ────────────────────────────────────────────────────

-- Scrivi (INSERT/UPDATE/DELETE) per coordinatore sulle strutture assegnate
DROP POLICY IF EXISTS "schedules_coordinator_write" ON public.schedules;
CREATE POLICY "schedules_coordinator_write" ON public.schedules
  FOR ALL TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
    AND structure_id = ANY(public.my_extra_structure_ids())
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
    AND structure_id = ANY(public.my_extra_structure_ids())
  );

-- Lettura turni: estendi agli operatori multi-struttura e coordinatori
DROP POLICY IF EXISTS "schedules_operator_select" ON public.schedules;
CREATE POLICY "schedules_operator_select" ON public.schedules
  FOR SELECT TO authenticated
  USING (
    structure_id = public.my_structure_id()
    OR structure_id = ANY(public.my_extra_structure_ids())
  );

-- ─── 2. Residenti ────────────────────────────────────────────────────────────

-- Lettura residenti: aggiungi strutture extra del coordinatore
DROP POLICY IF EXISTS "residents_select" ON public.residents;
CREATE POLICY "residents_select" ON public.residents
  FOR SELECT TO authenticated
  USING (
    structure_id = public.my_structure_id()
    OR public.my_org_owns_structure(structure_id)
    OR structure_id = ANY(public.my_extra_structure_ids())
  );

-- Inserimento residenti: aggiungi admin_secondary
DROP POLICY IF EXISTS "residents_insert" ON public.residents;
CREATE POLICY "residents_insert" ON public.residents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND (
      public.my_org_owns_structure(structure_id)
      OR structure_id = ANY(public.my_extra_structure_ids())
    )
  );

-- Modifica residenti: aggiungi admin_secondary
DROP POLICY IF EXISTS "residents_update" ON public.residents;
CREATE POLICY "residents_update" ON public.residents
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND (
      public.my_org_owns_structure(structure_id)
      OR structure_id = ANY(public.my_extra_structure_ids())
    )
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND (
      public.my_org_owns_structure(structure_id)
      OR structure_id = ANY(public.my_extra_structure_ids())
    )
  );

-- ─── 3. Documenti residenti ──────────────────────────────────────────────────

-- Insert documenti: aggiungi admin_secondary
DROP POLICY IF EXISTS "resident_documents_insert" ON public.resident_documents;
CREATE POLICY "resident_documents_insert" ON public.resident_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND EXISTS (
      SELECT 1 FROM public.residents r
      WHERE r.id = resident_documents.resident_id
        AND (
          public.my_org_owns_structure(r.structure_id)
          OR r.structure_id = ANY(public.my_extra_structure_ids())
        )
    )
  );

-- Delete documenti: aggiungi admin_secondary
DROP POLICY IF EXISTS "resident_documents_delete" ON public.resident_documents;
CREATE POLICY "resident_documents_delete" ON public.resident_documents
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND EXISTS (
      SELECT 1 FROM public.residents r
      WHERE r.id = resident_documents.resident_id
        AND (
          public.my_org_owns_structure(r.structure_id)
          OR r.structure_id = ANY(public.my_extra_structure_ids())
        )
    )
  );

-- ─── 4. Storage bucket resident-documents ────────────────────────────────────

DROP POLICY IF EXISTS "resident_docs_storage_insert" ON storage.objects;
CREATE POLICY "resident_docs_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resident-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND (
      public.my_org_owns_structure(split_part(name, '/', 1)::bigint)
      OR split_part(name, '/', 1)::bigint = ANY(public.my_extra_structure_ids())
    )
  );

DROP POLICY IF EXISTS "resident_docs_storage_delete" ON storage.objects;
CREATE POLICY "resident_docs_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'resident-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND (
      public.my_org_owns_structure(split_part(name, '/', 1)::bigint)
      OR split_part(name, '/', 1)::bigint = ANY(public.my_extra_structure_ids())
    )
  );

-- ─── 5. Farmaci e log ────────────────────────────────────────────────────────
-- can_manage_resident_data() già include admin_secondary (da fix_medications_rls.sql)
-- Aggiorniamo is_same_structure_as_resident per coprire strutture extra del coordinatore

CREATE OR REPLACE FUNCTION public.is_same_structure_as_resident(p_resident_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = p_resident_id
      AND (
        r.structure_id = (SELECT structure_id FROM public.profiles WHERE id = auth.uid())
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_resident_data(p_resident_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.residents r
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE r.id = p_resident_id
      AND (
        r.structure_id = p.structure_id
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
      AND p.role IN ('manager', 'admin_secondary')
  )
$$;

-- ─── 6. Diari (diaries) — scrittura per coordinatore ─────────────────────────
-- (lettura già garantita da fix_coordinator_rls.sql)

DROP POLICY IF EXISTS "diaries_coordinator_write" ON public.diaries;
CREATE POLICY "diaries_coordinator_write" ON public.diaries
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
    AND structure_id = ANY(public.my_extra_structure_ids())
  );

-- ─── 7. report_views — accesso per coordinatore ───────────────────────────────

DROP POLICY IF EXISTS "report_views_select" ON public.report_views;
CREATE POLICY "report_views_select" ON public.report_views
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND EXISTS (
      SELECT 1 FROM public.diaries d
      WHERE d.id = report_views.report_id
        AND (
          public.my_org_owns_structure(d.structure_id)
          OR d.structure_id = ANY(public.my_extra_structure_ids())
        )
    )
  );

DROP POLICY IF EXISTS "report_views_insert" ON public.report_views;
CREATE POLICY "report_views_insert" ON public.report_views
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
    AND EXISTS (
      SELECT 1 FROM public.diaries d
      WHERE d.id = report_views.report_id
        AND (
          public.my_org_owns_structure(d.structure_id)
          OR d.structure_id = ANY(public.my_extra_structure_ids())
        )
    )
  );
