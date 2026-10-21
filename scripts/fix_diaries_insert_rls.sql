-- ════════════════════════════════════════════════════════════════════
--  Fix: INSERT RLS su diaries + notifica coordinatori
--
--  Problema: INSERT su diaries dà 403 per operator e manager.
--  Solo admin_secondary aveva una policy INSERT (diaries_coordinator_write).
--
--  Fix:
--    1. Policy INSERT unificata per operator, manager, admin_secondary
--    2. notify_new_diary() aggiornata: notifica anche admin_secondary
--       della struttura (via user_structures)
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Sostituisce diaries_coordinator_write con policy unificata ────────────

DROP POLICY IF EXISTS "diaries_coordinator_write"  ON public.diaries;
DROP POLICY IF EXISTS "diaries_insert"             ON public.diaries;

CREATE POLICY "diaries_insert" ON public.diaries
  FOR INSERT TO authenticated
  WITH CHECK (
    -- L'operatore/coordinatore/manager deve appartenere alla struttura
    -- per cui scrive il diario.
    (
      -- manager: struttura della propria org
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
      AND public.my_org_owns_structure(structure_id)
    )
    OR (
      -- admin_secondary: strutture extra assegnate
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin_secondary'
      AND structure_id = ANY(public.my_extra_structure_ids())
    )
    OR (
      -- operator: struttura principale o strutture extra
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operator'
      AND (
        structure_id = public.my_structure_id()
        OR structure_id = ANY(public.my_extra_structure_ids())
      )
    )
  );

-- ─── 2. Aggiorna notify_new_diary(): aggiunge coordinatori ────────────────────

CREATE OR REPLACE FUNCTION public.notify_new_diary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_struct_name  text;
  v_op_name      text;
  v_recipient_id uuid;
BEGIN
  SELECT name      INTO v_struct_name FROM public.structures WHERE id = NEW.structure_id;
  SELECT full_name INTO v_op_name     FROM public.profiles   WHERE id = NEW.operator_id;

  -- Notifica manager (stessa org, qualsiasi struttura)
  FOR v_recipient_id IN
    SELECT get_structure_manager_ids(NEW.structure_id)
  LOOP
    IF v_recipient_id IS DISTINCT FROM NEW.operator_id THEN
      INSERT INTO public.notifications(user_id, title, message, type, link)
      VALUES (
        v_recipient_id,
        coalesce(v_struct_name, 'Struttura') || ' — Nuovo diario',
        coalesce(v_op_name, 'Un operatore') || ' ha compilato il diario di bordo.',
        'diary',
        'diaries:' || NEW.structure_id
      );
    END IF;
  END LOOP;

  -- Notifica coordinatori (admin_secondary) assegnati a questa struttura
  FOR v_recipient_id IN
    SELECT us.user_id
    FROM   public.user_structures us
    JOIN   public.profiles p ON p.id = us.user_id
    WHERE  us.structure_id = NEW.structure_id
      AND  us.is_active    = true
      AND  p.role          = 'admin_secondary'
  LOOP
    IF v_recipient_id IS DISTINCT FROM NEW.operator_id THEN
      INSERT INTO public.notifications(user_id, title, message, type, link)
      VALUES (
        v_recipient_id,
        coalesce(v_struct_name, 'Struttura') || ' — Nuovo diario',
        coalesce(v_op_name, 'Un operatore') || ' ha compilato il diario di bordo.',
        'diary',
        'diaries:' || NEW.structure_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Il trigger on_diary_created già esiste — nessuna modifica necessaria.
