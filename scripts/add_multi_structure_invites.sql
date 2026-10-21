-- ════════════════════════════════════════════════════════════════════
--  Turno — Multi-struttura per coordinatori
--  Esegui tutto in una volta nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Aggiungi structure_ids a invitation_codes ────────────────────────────

ALTER TABLE public.invitation_codes
  ADD COLUMN IF NOT EXISTS structure_ids smallint[];

-- ─── 2. Tabella user_structures (se non esiste) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_structures (
  user_id      uuid      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  structure_id smallint  NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, structure_id)
);

ALTER TABLE public.user_structures ENABLE ROW LEVEL SECURITY;

-- Ogni utente legge le proprie righe
DROP POLICY IF EXISTS "user_structures_own_read"     ON public.user_structures;
CREATE POLICY "user_structures_own_read" ON public.user_structures
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Manager legge le strutture della propria org
DROP POLICY IF EXISTS "user_structures_manager_read" ON public.user_structures;
CREATE POLICY "user_structures_manager_read" ON public.user_structures
  FOR SELECT TO authenticated
  USING (
    structure_id IN (
      SELECT id FROM public.structures
       WHERE organization_id = public.my_organization_id()
    )
  );

-- ─── 3. Popola user_structures dai profili esistenti ────────────────────────
--  (rende retrocompatibili gli utenti già registrati)

INSERT INTO public.user_structures (user_id, structure_id)
  SELECT id, structure_id
    FROM public.profiles
   WHERE structure_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- ─── 4. Aggiorna handle_new_user per supportare structure_ids[] ─────────────

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
        -- Aggiunge a un'org esistente (multi-struttura)
        v_org_id := v_code_row.organization_id;

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

    ELSE
      -- Operatore o Coordinatore
      IF v_code_row.structure_ids IS NOT NULL AND array_length(v_code_row.structure_ids, 1) > 0 THEN
        -- Invito multi-struttura (coordinatore)
        v_sids   := v_code_row.structure_ids;
        v_sid    := v_sids[1];  -- struttura primaria
        v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
      ELSE
        -- Invito singola struttura (classico)
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

  -- Inserisci in user_structures per tutte le strutture assegnate
  IF v_sids IS NOT NULL THEN
    INSERT INTO public.user_structures (user_id, structure_id)
      SELECT new.id, unnest(v_sids)
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

-- ─── 5. Aggiorna RLS structures per coprire user_structures ─────────────────

DROP POLICY IF EXISTS "structures_read" ON public.structures;
CREATE POLICY "structures_read" ON public.structures
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
    OR organization_id = public.my_organization_id()
    OR id = public.my_structure_id()
    OR id IN (
      SELECT structure_id FROM public.user_structures WHERE user_id = auth.uid()
    )
  );

-- ─── 6. Aggiorna invitation_codes insert policy per manager ─────────────────
--  Ora permette anche structure_ids[] per i codici coordinatore

DROP POLICY IF EXISTS "invitation_codes_manager_insert" ON public.invitation_codes;
CREATE POLICY "invitation_codes_manager_insert" ON public.invitation_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND public.my_org_owns_structure(structure_id)
    AND created_by = auth.uid()
    AND role IN ('operator', 'admin_secondary')
  );
