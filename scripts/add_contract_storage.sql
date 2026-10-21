-- ─── 1. Colonna contract_pdf_url su profiles ──────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contract_pdf_url TEXT;

-- ─── 2. Bucket privato "contracts" ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  false,            -- PRIVATO: nessun accesso pubblico
  10485760,         -- 10 MB max per file
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public            = false,
  file_size_limit   = 10485760,
  allowed_mime_types = ARRAY['application/pdf'];

-- ─── 3. Storage RLS — solo i manager possono gestire i contratti ───────────────

-- Upload (INSERT)
DROP POLICY IF EXISTS "managers can upload contracts" ON storage.objects;
CREATE POLICY "managers can upload contracts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'contracts'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);

-- Download (SELECT) — signed URL generation richiede SELECT
DROP POLICY IF EXISTS "managers can read contracts" ON storage.objects;
CREATE POLICY "managers can read contracts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'contracts'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);

-- Update (sostituzione file)
DROP POLICY IF EXISTS "managers can update contracts" ON storage.objects;
CREATE POLICY "managers can update contracts"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'contracts'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);

-- Delete
DROP POLICY IF EXISTS "managers can delete contracts" ON storage.objects;
CREATE POLICY "managers can delete contracts"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'contracts'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);
