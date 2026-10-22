-- ─────────────────────────────────────────────────────────────────────────────
-- Categorie documenti personalizzabili per organizzazione
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_document_categories (
  id              bigserial   PRIMARY KEY,
  organization_id bigint      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  emoji           text        NOT NULL DEFAULT '📁',
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_doc_categories_org_idx
  ON public.org_document_categories (organization_id, sort_order);

ALTER TABLE public.org_document_categories ENABLE ROW LEVEL SECURITY;

-- SELECT: manager e coordinator stessa org
CREATE POLICY "org_doc_categories_select" ON public.org_document_categories
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );

-- INSERT: manager e coordinator stessa org
CREATE POLICY "org_doc_categories_insert" ON public.org_document_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );

-- UPDATE: manager e coordinator stessa org
CREATE POLICY "org_doc_categories_update" ON public.org_document_categories
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );

-- DELETE: solo manager
CREATE POLICY "org_doc_categories_delete" ON public.org_document_categories
  FOR DELETE TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  );
