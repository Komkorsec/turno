-- ════════════════════════════════════════════════════════════════════
--  Fix: permessi scrittura per operator, admin_secondary e manager
--  su resident_legal_records, resident_documents e storage bucket
--
--  Problema: operatori e coordinatori ricevono 400/403 quando
--  cercano di caricare documenti o creare pratiche nel percorso
--  educativo — le policy originali erano solo per manager.
--
--  Fix: tutti e tre i ruoli (operator, admin_secondary, manager)
--  possono scrivere sulle strutture a cui appartengono.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  Helper interno: verifica che l'utente corrente abbia accesso
--  alla struttura del residente (qualsiasi ruolo, qualsiasi struttura
--  assegnata — primaria o extra).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.my_accessible_resident(p_resident_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = p_resident_id
      AND (
        r.structure_id = public.my_structure_id()
        OR public.my_org_owns_structure(r.structure_id)
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
  )
$$;

-- ═══════════════════════════════════════════════════════════════════
--  1. resident_legal_records — INSERT / UPDATE / DELETE
-- ═══════════════════════════════════════════════════════════════════

-- Lettura: estendi ai coordinatori con strutture extra
DROP POLICY IF EXISTS "legal_records_select" ON public.resident_legal_records;
CREATE POLICY "legal_records_select" ON public.resident_legal_records
  FOR SELECT TO authenticated
  USING (public.my_accessible_resident(resident_id));

-- INSERT: operator, admin_secondary, manager
DROP POLICY IF EXISTS "legal_records_insert" ON public.resident_legal_records;
CREATE POLICY "legal_records_insert" ON public.resident_legal_records
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );

-- UPDATE: operator, admin_secondary, manager
DROP POLICY IF EXISTS "legal_records_update" ON public.resident_legal_records;
CREATE POLICY "legal_records_update" ON public.resident_legal_records
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );

-- DELETE: operator, admin_secondary, manager
DROP POLICY IF EXISTS "legal_records_delete" ON public.resident_legal_records;
CREATE POLICY "legal_records_delete" ON public.resident_legal_records
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );

-- ═══════════════════════════════════════════════════════════════════
--  2. resident_documents — SELECT / INSERT / DELETE
-- ═══════════════════════════════════════════════════════════════════

-- Lettura: estendi ai coordinatori con strutture extra
DROP POLICY IF EXISTS "resident_documents_select" ON public.resident_documents;
CREATE POLICY "resident_documents_select" ON public.resident_documents
  FOR SELECT TO authenticated
  USING (public.my_accessible_resident(resident_id));

-- INSERT: operator, admin_secondary, manager
DROP POLICY IF EXISTS "resident_documents_insert" ON public.resident_documents;
CREATE POLICY "resident_documents_insert" ON public.resident_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );

-- DELETE: operator, admin_secondary, manager
DROP POLICY IF EXISTS "resident_documents_delete" ON public.resident_documents;
CREATE POLICY "resident_documents_delete" ON public.resident_documents
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );

-- ═══════════════════════════════════════════════════════════════════
--  3. storage.objects — bucket "resident-documents"
--     Path: {structure_id}/{resident_id}/{uuid}.ext
-- ═══════════════════════════════════════════════════════════════════

-- Helper per lo storage: verifica accesso alla struttura nel path
CREATE OR REPLACE FUNCTION public.my_accessible_storage_structure(p_structure_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    p_structure_id = public.my_structure_id()
    OR public.my_org_owns_structure(p_structure_id)
    OR p_structure_id = ANY(public.my_extra_structure_ids())
  )
$$;

-- SELECT: tutti i ruoli sulle strutture accessibili
DROP POLICY IF EXISTS "resident_docs_storage_select" ON storage.objects;
CREATE POLICY "resident_docs_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'resident-documents'
    AND public.my_accessible_storage_structure(split_part(name, '/', 1)::bigint)
  );

-- INSERT: operator, admin_secondary, manager
DROP POLICY IF EXISTS "resident_docs_storage_insert" ON storage.objects;
CREATE POLICY "resident_docs_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resident-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_storage_structure(split_part(name, '/', 1)::bigint)
  );

-- DELETE: operator, admin_secondary, manager
DROP POLICY IF EXISTS "resident_docs_storage_delete" ON storage.objects;
CREATE POLICY "resident_docs_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'resident-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_storage_structure(split_part(name, '/', 1)::bigint)
  );
