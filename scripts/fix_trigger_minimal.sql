-- ════════════════════════════════════════════════════════════════════
--  Trigger minimale per diagnostica — NO user_structures, NO structure_ids
--  Se il signup funziona con questo, il problema è in user_structures.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code     text;
  v_role     text;
  v_sid      smallint;
  v_org_id   bigint;
  v_name     text;
  v_strname  text;
BEGIN
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  IF v_code IS NOT NULL THEN

    SELECT role, structure_id INTO v_role, v_sid
      FROM public.invitation_codes
     WHERE code = v_code AND is_used = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Codice invito non valido o già utilizzato.';
    END IF;

    IF v_role = 'manager' THEN
      DECLARE
        v_code_org bigint;
      BEGIN
        SELECT organization_id INTO v_code_org
          FROM public.invitation_codes WHERE code = v_code;

        IF v_code_org IS NOT NULL THEN
          v_org_id := v_code_org;
          IF (SELECT count(*) FROM public.structures WHERE organization_id = v_org_id)
             >= (SELECT max_structures FROM public.organizations WHERE id = v_org_id) THEN
            RAISE EXCEPTION 'Limite strutture raggiunto.';
          END IF;
          INSERT INTO public.structures (name, organization_id)
            VALUES (coalesce(nullif(trim(v_strname),''), 'Struttura di '||v_name), v_org_id)
            RETURNING id INTO v_sid;
        ELSE
          INSERT INTO public.organizations (name, max_structures)
            VALUES (coalesce(nullif(trim(v_strname),''), 'Org di '||v_name), 1)
            RETURNING id INTO v_org_id;
          INSERT INTO public.structures (name, organization_id)
            VALUES (coalesce(nullif(trim(v_strname),''), 'Struttura di '||v_name), v_org_id)
            RETURNING id INTO v_sid;
        END IF;
      END;
    ELSE
      v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
    END IF;

    UPDATE public.invitation_codes SET is_used = true WHERE code = v_code;

  ELSE
    v_role   := coalesce(new.raw_user_meta_data->>'role', 'operator');
    v_sid    := (new.raw_user_meta_data->>'structure_id')::smallint;
    v_org_id := (new.raw_user_meta_data->>'organization_id')::bigint;
    IF v_org_id IS NULL AND v_sid IS NOT NULL THEN
      v_org_id := (SELECT organization_id FROM public.structures WHERE id = v_sid);
    END IF;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id)
    VALUES (new.id, v_name, v_role, v_sid, v_org_id);

  RETURN new;
END;
$$;
