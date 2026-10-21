-- ════════════════════════════════════════════════════════════════════
--  Pubblicazione turni: notifica unica + campo published
--  1. Aggiunge colonna published a schedules
--  2. Aggiorna RLS operatori: vede solo turni pubblicati
--  3. Rimuove trigger per-turno on_schedule_assigned
--  4. RPC publish_week_schedules: marca pubblicati + invia notifiche
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Colonna published ─────────────────────────────────────────────────────

ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

-- ─── 2. RLS operatori: solo turni pubblicati ──────────────────────────────────

DROP POLICY IF EXISTS "schedules_operator_select" ON public.schedules;
CREATE POLICY "schedules_operator_select" ON public.schedules
  FOR SELECT TO authenticated
  USING (
    (
      structure_id = public.my_structure_id()
      OR structure_id = ANY(public.my_extra_structure_ids())
    )
    AND (
      -- Manager e coordinatori vedono anche bozze (published = false)
      (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
      OR published = true
    )
  );

-- ─── 3. Rimuove trigger per-turno ─────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_schedule_assigned ON public.schedules;
DROP FUNCTION IF EXISTS public.notify_schedule_assigned();

-- ─── 4. RPC: pubblica turni della settimana + notifica operatori ──────────────

CREATE OR REPLACE FUNCTION public.publish_week_schedules(
  p_structure_id bigint,
  p_week_start   date,
  p_week_end     date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_struct_name  text;
  v_week_label   text;
  v_start_label  text;
  v_end_label    text;
  v_op_id        uuid;
BEGIN
  -- Solo manager e admin_secondary possono chiamare questa funzione
  IF (SELECT role FROM public.profiles WHERE id = auth.uid())
     NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  -- Verifica che la struttura appartenga all'org del chiamante
  IF NOT public.my_org_owns_structure(p_structure_id)
     AND p_structure_id <> ALL(public.my_extra_structure_ids()) THEN
    RAISE EXCEPTION 'Struttura non autorizzata';
  END IF;

  -- Marca i turni come pubblicati
  UPDATE public.schedules
     SET published = true
   WHERE structure_id = p_structure_id
     AND date >= p_week_start
     AND date <= p_week_end;

  -- Nome struttura per il messaggio
  SELECT name INTO v_struct_name
    FROM public.structures WHERE id = p_structure_id;

  v_start_label := to_char(p_week_start, 'DD/MM/YYYY');
  v_end_label   := to_char(p_week_end,   'DD/MM/YYYY');
  v_week_label  := v_start_label || ' – ' || v_end_label;

  -- Invia una notifica per ogni operatore con turni nella settimana
  FOR v_op_id IN
    SELECT DISTINCT s.user_id
      FROM public.schedules s
      JOIN public.profiles  p ON p.id = s.user_id
     WHERE s.structure_id = p_structure_id
       AND s.date >= p_week_start
       AND s.date <= p_week_end
       AND s.published = true
       AND p.role = 'operator'
  LOOP
    INSERT INTO public.notifications(user_id, title, message, type, link)
    VALUES (
      v_op_id,
      '📅 Turni pubblicati · ' || v_week_label,
      'I tuoi turni per la settimana dal ' || v_week_label ||
        coalesce(' · ' || v_struct_name, '') ||
        ' sono stati pubblicati. Apri la sezione I miei turni per vederli.',
      'schedule',
      'shifts:' || to_char(p_week_start, 'YYYY-MM-DD')
    );
  END LOOP;
END;
$$;
