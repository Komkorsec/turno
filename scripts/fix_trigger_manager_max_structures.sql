-- ════════════════════════════════════════════════════════════════════
--  Fix handle_new_user: legge max_structures dal codice invito
--  invece di usare il valore hardcoded 1.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code          text;
  v_role          text;
  v_sid           smallint;
  v_org_id        bigint;
  v_name          text;
  v_strname       text;
  v_sids          smallint[];
  v_code_found    boolean := false;
  v_code_org      bigint;
  v_code_struct   smallint;
  v_max_structures int;
BEGIN
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  IF v_code IS NOT NULL THEN

    -- Legge i campi base del codice (incluso max_structures)
    SELECT role, structure_id, organization_id, max_structures, true
      INTO v_role, v_code_struct, v_code_org, v_max_structures, v_code_found
      FROM public.invitation_codes
     WHERE code = v_code AND is_used = false;

    IF NOT v_code_found THEN
      RAISE EXCEPTION 'Codice invito non valido o già utilizzato.';
    END IF;

    IF v_role = 'manager' THEN
      IF v_code_org IS NOT NULL THEN
        v_org_id := v_code_org;

        IF (SELECT count(*) FROM public.structures WHERE organization_id = v_org_id)
           >= (SELECT max_structures FROM public.organizations WHERE id = v_org_id) THEN
          RAISE EXCEPTION 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
        END IF;

        INSERT INTO public.structures (name, organization_id)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          RETURNING id INTO v_sid;
      ELSE
        -- Crea una nuova organizzazione usando max_structures dal codice (default 1)
        INSERT INTO public.organizations (name, max_structures)
          VALUES (
            coalesce(nullif(trim(v_strname), ''), 'Org di ' || v_name),
            coalesce(v_max_structures, 1)
          )
          RETURNING id INTO v_org_id;

        INSERT INTO public.structures (name, organization_id)
          VALUES (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name), v_org_id)
          RETURNING id INTO v_sid;
      END IF;

    ELSE
      -- Operatore o Coordinatore
      BEGIN
        SELECT structure_ids INTO v_sids
          FROM public.invitation_codes
         WHERE code = v_code;
      EXCEPTION WHEN OTHERS THEN
        v_sids := NULL;
      END;

      IF v_sids IS NOT NULL AND array_length(v_sids, 1) > 0 THEN
        v_sid    := v_sids[1];
        v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
      ELSE
        v_sid    := v_code_struct;
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
