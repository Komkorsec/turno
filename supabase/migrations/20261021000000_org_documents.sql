-- ─────────────────────────────────────────────────────────────────────────────
-- Archivio Generale — tabella org_documents + bucket Storage + RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Bucket privato ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-documents',
  'org-documents',
  false,
  20971520,  -- 20 MB
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── Tabella ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_documents (
  id              bigserial     PRIMARY KEY,
  organization_id bigint        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  structure_id    smallint      REFERENCES public.structures(id) ON DELETE SET NULL,
  categoria       text          NOT NULL DEFAULT 'Altro',
  titolo          text          NOT NULL,
  storage_path    text          NOT NULL UNIQUE,
  original_name   text          NOT NULL,
  file_size       bigint,
  mime_type       text,
  data_scadenza   date,
  note            text,
  uploaded_by     uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- Indici utili
CREATE INDEX IF NOT EXISTS org_documents_org_idx      ON public.org_documents (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS org_documents_struct_idx   ON public.org_documents (structure_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS org_documents_scadenza_idx ON public.org_documents (data_scadenza)   WHERE deleted_at IS NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_org_documents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_documents_updated_at ON public.org_documents;
CREATE TRIGGER trg_org_documents_updated_at
  BEFORE UPDATE ON public.org_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_org_documents();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: manager vede tutto l'ente; coordinator vede doc generali + sue strutture
CREATE POLICY "org_documents_select" ON public.org_documents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
        AND (
          structure_id IS NULL
          OR structure_id = ANY(public.my_extra_structure_ids())
        )
      )
    )
  );

-- INSERT: manager e coordinator (solo nelle proprie strutture o doc generali)
CREATE POLICY "org_documents_insert" ON public.org_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
        AND (
          structure_id IS NULL
          OR structure_id = ANY(public.my_extra_structure_ids())
        )
      )
    )
  );

-- UPDATE: stessa logica di INSERT (modifica metadati + soft delete)
CREATE POLICY "org_documents_update" ON public.org_documents
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
        AND (
          structure_id IS NULL
          OR structure_id = ANY(public.my_extra_structure_ids())
        )
      )
    )
  )
  WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
        AND (
          structure_id IS NULL
          OR structure_id = ANY(public.my_extra_structure_ids())
        )
      )
    )
  );

-- ── Storage policies per bucket org-documents ─────────────────────────────────
-- Solo manager e coordinator possono accedere al bucket.
-- La granularità struttura/org è già garantita dalla RLS tabella.

CREATE POLICY "org_documents_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'org-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );

CREATE POLICY "org_documents_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );

CREATE POLICY "org_documents_storage_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );

CREATE POLICY "org_documents_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-documents'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
  );
