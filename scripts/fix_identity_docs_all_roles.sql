-- ════════════════════════════════════════════════════════════════════
--  Fix: permessi su resident_identity_docs per tutti i ruoli
--
--  Problema: le policy originali (resident_identity_docs.sql) limitano
--  INSERT / UPDATE / DELETE ai soli manager → operatori e coordinatori
--  ricevono 403 quando caricano/salvano un documento d'identità.
--
--  Fix: estende tutti i permessi di scrittura a operator,
--  admin_secondary e manager — stessa logica di fix_resident_docs_all_roles.sql.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- Assicura che la funzione helper esista (idempotente)
CREATE OR REPLACE FUNCTION public.my_accessible_resident(p_resident_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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

-- ── SELECT: operator, admin_secondary, manager ────────────────────────────────
DROP POLICY IF EXISTS "identity_docs_select" ON public.resident_identity_docs;
CREATE POLICY "identity_docs_select" ON public.resident_identity_docs
  FOR SELECT TO authenticated
  USING (public.my_accessible_resident(resident_id));

-- ── INSERT: operator, admin_secondary, manager ───────────────────────────────
DROP POLICY IF EXISTS "identity_docs_insert" ON public.resident_identity_docs;
CREATE POLICY "identity_docs_insert" ON public.resident_identity_docs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );

-- ── UPDATE: operator, admin_secondary, manager ───────────────────────────────
DROP POLICY IF EXISTS "identity_docs_update" ON public.resident_identity_docs;
CREATE POLICY "identity_docs_update" ON public.resident_identity_docs
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

-- ── DELETE: operator, admin_secondary, manager ───────────────────────────────
DROP POLICY IF EXISTS "identity_docs_delete" ON public.resident_identity_docs;
CREATE POLICY "identity_docs_delete" ON public.resident_identity_docs
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary', 'operator')
    AND public.my_accessible_resident(resident_id)
  );
