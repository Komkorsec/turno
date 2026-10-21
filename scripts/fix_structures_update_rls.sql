-- ════════════════════════════════════════════════════════════════════
--  Fix: policy UPDATE su structures + SELECT per coordinatori
--
--  Problema: non esiste nessuna policy UPDATE su structures.
--  Il .update() di saveContacts/saveNotes/handleLogoUpload viene
--  silenziosamente ignorato dal RLS → i dati non persistono mai.
--
--  Fix:
--    1. Policy UPDATE per manager (strutture della propria org)
--       e admin_secondary (strutture extra assegnate)
--    2. Policy SELECT estesa ai coordinatori via user_structures
--       (così vedono email/phone/logo anche nei propri settings)
--    3. Storage policy INSERT/UPDATE/DELETE per structure-logos
--       estesa ad admin_secondary
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Policy UPDATE su structures ──────────────────────────────────────────

DROP POLICY IF EXISTS "structures_update" ON public.structures;
CREATE POLICY "structures_update" ON public.structures
  FOR UPDATE TO authenticated
  USING (
    -- manager: qualsiasi struttura della propria org
    (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      AND organization_id = public.my_organization_id()
    )
    OR
    -- admin_secondary: solo strutture extra assegnate
    (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
      AND id = ANY(public.my_extra_structure_ids())
    )
  )
  WITH CHECK (
    (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      AND organization_id = public.my_organization_id()
    )
    OR
    (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
      AND id = ANY(public.my_extra_structure_ids())
    )
  );

-- ─── 2. Policy SELECT estesa ai coordinatori ─────────────────────────────────
-- (gli operatori e coordinatori con struttura primaria già leggono via
--  id = public.my_structure_id(); questa estende per strutture extra)

DROP POLICY IF EXISTS "structures_read" ON public.structures;
CREATE POLICY "structures_read" ON public.structures
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    OR organization_id = public.my_organization_id()
    OR id = public.my_structure_id()
    OR id = ANY(public.my_extra_structure_ids())
  );

-- ─── 3. Storage structure-logos: estende ad admin_secondary ──────────────────

DROP POLICY IF EXISTS "managers can upload structure logos"  ON storage.objects;
DROP POLICY IF EXISTS "managers can update structure logos"  ON storage.objects;
DROP POLICY IF EXISTS "managers can delete structure logos"  ON storage.objects;

CREATE POLICY "managers can upload structure logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'structure-logos'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary')
  );

CREATE POLICY "managers can update structure logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'structure-logos'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary')
  );

CREATE POLICY "managers can delete structure logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'structure-logos'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('manager', 'admin_secondary')
  );
