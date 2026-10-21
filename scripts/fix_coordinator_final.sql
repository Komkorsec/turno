-- ════════════════════════════════════════════════════════════════════
--  Fix coordinatore FINALE — risolve tutti i problemi noti
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Assicura colonna structure_ids su invitation_codes ───────────────────
ALTER TABLE public.invitation_codes
  ADD COLUMN IF NOT EXISTS structure_ids smallint[];

-- ─── 2. Aggiorna constraint role su invitation_codes (include admin_secondary) ──
ALTER TABLE public.invitation_codes
  DROP CONSTRAINT IF EXISTS invitation_codes_role_check;
ALTER TABLE public.invitation_codes
  ADD CONSTRAINT invitation_codes_role_check
    CHECK (role IN ('operator', 'manager', 'admin_secondary'));

-- ─── 2b. Aggiorna constraint role su profiles (include admin_secondary) ────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('operator', 'manager', 'admin_secondary'));

-- ─── 3. Constraint struttura obbligatoria per non-manager ───────────────────
--  Per admin_secondary un codice deve avere structure_id (o structure_ids)
ALTER TABLE public.invitation_codes
  DROP CONSTRAINT IF EXISTS operator_code_needs_structure;
ALTER TABLE public.invitation_codes
  ADD CONSTRAINT operator_code_needs_structure
    CHECK (
      role = 'manager'
      OR structure_id IS NOT NULL
      OR (structure_ids IS NOT NULL AND array_length(structure_ids, 1) > 0)
    );

-- ─── 4. Tabella user_structures (se non esiste) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_structures (
  user_id      uuid     NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  structure_id smallint NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, structure_id)
);
ALTER TABLE public.user_structures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_structures_own_read" ON public.user_structures;
CREATE POLICY "user_structures_own_read" ON public.user_structures
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Helper security definer (evita loop RLS structures ↔ user_structures)
CREATE OR REPLACE FUNCTION public.my_extra_structure_ids()
RETURNS smallint[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(array_agg(structure_id), ARRAY[]::smallint[])
    FROM public.user_structures
   WHERE user_id = auth.uid()
$$;

-- ─── 5. Trigger handle_new_user — versione finale senza %rowtype ─────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code        text;
  v_role        text;
  v_sid         smallint;
  v_org_id      bigint;
  v_name        text;
  v_strname     text;
  v_sids        smallint[];
  v_code_org    bigint;
  v_code_found  boolean;
BEGIN
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  IF v_code IS NOT NULL THEN

    -- Legge i campi base senza %rowtype
    SELECT role, structure_id, organization_id
      INTO v_role, v_sid, v_code_org
      FROM public.invitation_codes
     WHERE code = v_code AND is_used = false
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Codice invito non valido o già utilizzato.';
    END IF;

    IF v_role = 'manager' THEN

      IF v_code_org IS NOT NULL THEN
        -- Manager aggiunto a org esistente
        v_org_id := v_code_org;

        IF (SELECT count(*) FROM public.structures WHERE organization_id = v_org_id)
           >= (SELECT max_structures FROM public.organizations WHERE id = v_org_id) THEN
          RAISE EXCEPTION 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
        END IF;

        INSERT INTO public.structures (name, organization_id)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          RETURNING id INTO v_sid;
      ELSE
        -- Nuova organizzazione
        INSERT INTO public.organizations (name, max_structures)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Org di ' || v_name), 1)
          RETURNING id INTO v_org_id;

        INSERT INTO public.structures (name, organization_id)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          RETURNING id INTO v_sid;
      END IF;

      v_sids := ARRAY[v_sid];

    ELSE
      -- Operatore o Coordinatore: legge structure_ids separatamente (safe)
      BEGIN
        SELECT structure_ids INTO v_sids
          FROM public.invitation_codes
         WHERE code = v_code
         LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
        v_sids := NULL;
      END;

      IF v_sids IS NOT NULL AND array_length(v_sids, 1) > 0 THEN
        -- Coordinatore multi-struttura
        v_sid    := v_sids[1];
        v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
      ELSE
        -- Operatore (o coordinatore con structure_id singolo)
        -- v_sid già letto sopra dalla SELECT base
        v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
        v_sids   := ARRAY[v_sid];
      END IF;
    END IF;

    UPDATE public.invitation_codes
       SET is_used = true
     WHERE code = v_code;

  ELSE
    -- Flusso admin (seed script / Supabase dashboard)
    v_role   := coalesce(new.raw_user_meta_data->>'role', 'operator');
    v_sid    := (new.raw_user_meta_data->>'structure_id')::smallint;
    v_org_id := (new.raw_user_meta_data->>'organization_id')::bigint;

    IF v_org_id IS NULL AND v_sid IS NOT NULL THEN
      v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
    END IF;

    v_sids := CASE WHEN v_sid IS NOT NULL THEN ARRAY[v_sid] ELSE NULL END;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id)
    VALUES (new.id, v_name, v_role, v_sid, v_org_id);

  -- Ora che il profilo esiste, aggiorna used_by (FK su profiles)
  IF v_code IS NOT NULL THEN
    BEGIN
      UPDATE public.invitation_codes
         SET used_by = new.id
       WHERE code = v_code;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Inserisci in user_structures (non blocca il signup se la tabella manca o ha problemi)
  IF v_sids IS NOT NULL THEN
    BEGIN
      INSERT INTO public.user_structures (user_id, structure_id)
        SELECT new.id, s FROM unnest(v_sids) AS s
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN new;
END;
$$;

-- ─── 6. Retrocompatibilità: popola user_structures da profili esistenti ───────
INSERT INTO public.user_structures (user_id, structure_id)
  SELECT id, structure_id
    FROM public.profiles
   WHERE structure_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- ─── 7. RLS structures aggiornata (usa helper per evitare loop) ──────────────
DROP POLICY IF EXISTS "structures_read" ON public.structures;
CREATE POLICY "structures_read" ON public.structures
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    OR organization_id = public.my_organization_id()
    OR id = public.my_structure_id()
    OR id = ANY(public.my_extra_structure_ids())
  );

-- ─── 8. RLS invitation_codes: permette inserimento codici coordinatore ────────
DROP POLICY IF EXISTS "invitation_codes_manager_insert" ON public.invitation_codes;
CREATE POLICY "invitation_codes_manager_insert" ON public.invitation_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND public.my_org_owns_structure(structure_id)
    AND created_by = auth.uid()
    AND role IN ('operator', 'admin_secondary')
  );
