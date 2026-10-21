-- ─── 1. Colonne aggiuntive su structures ──────────────────────────────────────
ALTER TABLE public.structures
  ADD COLUMN IF NOT EXISTS logo_url     TEXT,
  ADD COLUMN IF NOT EXISTS notes_private TEXT;

-- capacity è già presente (aggiunta in structures_detail.sql)
-- ALTER TABLE public.structures ADD COLUMN IF NOT EXISTS capacity INT;

-- ─── 2. Bucket pubblico "structure-logos" ─────────────────────────────────────
-- I loghi delle strutture non sono dati sensibili → bucket pubblico
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'structure-logos',
  'structure-logos',
  true,
  5242880,   -- 5 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public           = true,
  file_size_limit  = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

-- ─── 3. Storage RLS — solo i manager possono caricare/eliminare loghi ─────────

DROP POLICY IF EXISTS "managers can upload structure logos" ON storage.objects;
CREATE POLICY "managers can upload structure logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'structure-logos'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);

DROP POLICY IF EXISTS "managers can update structure logos" ON storage.objects;
CREATE POLICY "managers can update structure logos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'structure-logos'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);

DROP POLICY IF EXISTS "managers can delete structure logos" ON storage.objects;
CREATE POLICY "managers can delete structure logos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'structure-logos'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
);

-- Lettura pubblica (bucket è già public, questa policy è per completezza)
DROP POLICY IF EXISTS "public can read structure logos" ON storage.objects;
CREATE POLICY "public can read structure logos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'structure-logos');
