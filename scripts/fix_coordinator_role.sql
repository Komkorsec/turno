-- ════════════════════════════════════════════════════════════════════
--  Fix coordinatore: constraint role_check + user_structures + trigger
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Fix constraint role su invitation_codes ──────────────────────────────
ALTER TABLE public.invitation_codes DROP CONSTRAINT IF EXISTS invitation_codes_role_check;
ALTER TABLE public.invitation_codes ADD CONSTRAINT invitation_codes_role_check
  CHECK (role IN ('operator', 'manager', 'admin_secondary'));

-- ─── 2. Assicura che user_structures esista ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_structures (
  user_id      uuid      NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  structure_id smallint  NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, structure_id)
);

ALTER TABLE public.user_structures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_structures_own_read" ON public.user_structures;
CREATE POLICY "user_structures_own_read" ON public.user_structures
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── 3. Funzione helper per structures_read (senza loop) ─────────────────────
CREATE OR REPLACE FUNCTION public.my_extra_structure_ids()
RETURNS smallint[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(array_agg(structure_id), ARRAY[]::smallint[])
    FROM public.user_structures
   WHERE user_id = auth.uid()
$$;

-- ─── 4. Ricrea structures_read senza loop ────────────────────────────────────
DROP POLICY IF EXISTS "structures_read" ON public.structures;
CREATE POLICY "structures_read" ON public.structures
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    OR organization_id = public.my_organization_id()
    OR id = public.my_structure_id()
    OR id = ANY(public.my_extra_structure_ids())
  );

-- ─── 5. Popola user_structures dai profili esistenti (retrocompatibilità) ─────
INSERT INTO public.user_structures (user_id, structure_id)
  SELECT id, structure_id
    FROM public.profiles
   WHERE structure_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- ─── 6. Aggiorna handle_new_user con gestione difensiva ──────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code     text;
  v_code_row public.invitation_codes%rowtype;
  v_sid      smallint;
  v_role     text;
  v_name     text;
  v_strname  text;
  v_org_id   bigint;
  v_sids     smallint[];
BEGIN
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  IF v_code IS NOT NULL THEN
    SELECT * INTO v_code_row
      FROM public.invitation_codes
     WHERE code = v_code AND is_used = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Codice invito non valido o già utilizzato.';
    END IF;

    v_role := v_code_row.role;

    IF v_role = 'manager' THEN
      IF v_code_row.organization_id IS NOT NULL THEN
        v_org_id := v_code_row.organization_id;

        IF (SELECT count(*) FROM public.structures WHERE organization_id = v_org_id)
           >= (SELECT max_structures FROM public.organizations WHERE id = v_org_id) THEN
          RAISE EXCEPTION 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
        END IF;

        INSERT INTO public.structures (name, organization_id)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          RETURNING id INTO v_sid;
      ELSE
        INSERT INTO public.organizations (name, max_structures)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Org di ' || v_name), 1)
          RETURNING id INTO v_org_id;

        INSERT INTO public.structures (name, organization_id)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          RETURNING id INTO v_sid;
      END IF;

    ELSE
      -- Operatore o Coordinatore
      IF v_code_row.structure_ids IS NOT NULL
         AND array_length(v_code_row.structure_ids, 1) > 0 THEN
        -- Invito multi-struttura (coordinatore)
        v_sids   := v_code_row.structure_ids;
        v_sid    := v_sids[1];
        v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
      ELSE
        -- Invito singola struttura
        v_sid    := v_code_row.structure_id;
        v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
        v_sids   := ARRAY[v_sid];
      END IF;
    END IF;

    UPDATE public.invitation_codes SET is_used = true WHERE code = v_code;

  ELSE
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

  -- Inserisci in user_structures (con gestione difensiva per evitare errori su tabella mancante)
  IF v_sids IS NOT NULL THEN
    BEGIN
      INSERT INTO public.user_structures (user_id, structure_id)
        SELECT new.id, unnest(v_sids)
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Non blocca la registrazione se user_structures ha problemi
      NULL;
    END;
  END IF;

  RETURN new;
END;
$$;
