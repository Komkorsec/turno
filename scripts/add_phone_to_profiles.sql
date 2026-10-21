-- ════════════════════════════════════════════════════════════════════
--  Aggiunge numero di telefono al profilo utente
--
--  1. Aggiunge colonna `phone` a public.profiles
--  2. Aggiorna handle_new_user: salva `phone` dai metadata di registrazione
--  3. Aggiorna get_team_members: include `phone` nei risultati
--
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Colonna phone su profiles ────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;

-- ─── 2. Aggiorna handle_new_user ────────────────────────────────────────────
--  Legge raw_user_meta_data->>'phone' e lo salva nel profilo.
--  Il resto della funzione rimane identico a fix_trigger_no_auto_structure.sql

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code          text;
  v_role          text;
  v_sid           smallint;
  v_org_id        bigint;
  v_name          text;
  v_phone         text;
  v_org_name      text;
  v_sids          smallint[];
  v_code_found    boolean := false;
  v_code_org      bigint;
  v_code_struct   smallint;
  v_max_structures int;
BEGIN
  v_name     := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code     := new.raw_user_meta_data->>'invitation_code';
  v_phone    := nullif(trim(new.raw_user_meta_data->>'phone'), '');

  v_org_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'organization_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'structure_name'),    ''),
    'Cooperativa di ' || v_name
  );

  IF v_code IS NOT NULL THEN

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

        v_sid := NULL;

      ELSE
        INSERT INTO public.organizations (name, max_structures)
          VALUES (v_org_name, coalesce(v_max_structures, 1))
          RETURNING id INTO v_org_id;

        v_sid := NULL;
      END IF;

    ELSE
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

  INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id, phone)
    VALUES (new.id, v_name, v_role, v_sid, v_org_id, v_phone);

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


-- ─── 3. Aggiorna get_team_members: aggiunge phone ────────────────────────────

DROP FUNCTION IF EXISTS public.get_team_members(integer);

CREATE OR REPLACE FUNCTION public.get_team_members(p_structure_id integer)
RETURNS TABLE (
  id                  uuid,
  full_name           text,
  email               text,
  role                text,
  created_at          timestamptz,
  structure_id        integer,
  max_hours_per_week  integer,
  weekly_rest_day     text,
  contract_pdf_url    text,
  phone               text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT DISTINCT
    p.id, p.full_name, p.email, p.role, p.created_at,
    p.structure_id, p.max_hours_per_week, p.weekly_rest_day, p.contract_pdf_url,
    p.phone
  FROM profiles p
  WHERE
    EXISTS (
      SELECT 1 FROM structures s
      JOIN   profiles caller ON caller.id = auth.uid()
      WHERE  s.id              = p_structure_id
        AND  s.organization_id = caller.organization_id
    )
    AND (
      p.id = auth.uid()
      OR (
        p.role != 'manager'
        AND (
          (p.structure_id = p_structure_id
           AND NOT EXISTS (
             SELECT 1 FROM user_structures us
             WHERE us.user_id = p.id AND us.structure_id = p_structure_id AND us.is_active = false
           ))
          OR EXISTS (
            SELECT 1 FROM user_structures us
            WHERE us.user_id      = p.id
              AND us.structure_id = p_structure_id
              AND us.is_active    = true
          )
        )
      )
    )
  ORDER BY p.full_name;
$$;
