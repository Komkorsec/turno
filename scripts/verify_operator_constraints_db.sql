-- ════════════════════════════════════════════════════════════════════
--  verify_operator_constraints_db
--  Script di diagnosi e fix per la persistenza dei vincoli orari.
--
--  Eseguire SEZIONE PER SEZIONE nel SQL Editor di Supabase.
--  Leggere i risultati prima di procedere alla sezione successiva.
-- ════════════════════════════════════════════════════════════════════

-- ── SEZIONE 1: Verifica colonne in profiles ───────────────────────────────────
-- Controlla che tutte le colonne usate dal solver esistano.
-- Nota: il codebase usa max_hours_per_week (NON weekly_hours_limit).
--       contract_type non esiste nel codebase — non è necessario aggiungerla.

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name IN (
    'max_hours_per_week',
    'weekly_rest_day',
    'shift_preference',
    'shift_avoid',
    'recurring_shifts'
  )
ORDER BY column_name;

-- Risultato atteso: 5 righe.
-- Se mancano righe, eseguire la SEZIONE 2 per aggiungere le colonne mancanti.

-- ── SEZIONE 2: Aggiungi colonne mancanti (eseguire solo se SEZIONE 1 < 5 righe) ─

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS max_hours_per_week  integer,
  ADD COLUMN IF NOT EXISTS weekly_rest_day     text,
  ADD COLUMN IF NOT EXISTS shift_preference    text,
  ADD COLUMN IF NOT EXISTS shift_avoid         text,
  ADD COLUMN IF NOT EXISTS recurring_shifts    jsonb DEFAULT '[]'::jsonb;

-- ── SEZIONE 3: Verifica funzione save_operator_constraints ───────────────────

SELECT
  routine_name,
  routine_type,
  security_type,
  data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'save_operator_constraints';

-- Risultato atteso: 1 riga con security_type = 'DEFINER'.
-- Se 0 righe → la funzione non esiste: eseguire SEZIONE 4.
-- Se security_type = 'INVOKER' → la funzione non bypassa RLS: eseguire SEZIONE 4.

-- ── SEZIONE 4: Ricrea save_operator_constraints (eseguire se SEZIONE 3 fallisce) ─

DROP FUNCTION IF EXISTS public.save_operator_constraints(uuid, integer, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.save_operator_constraints(
  p_user_id          uuid,
  p_max_hours        integer,
  p_rest_day         text,
  p_shift_preference text,
  p_shift_avoid      text,
  p_recurring_shifts jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo manager e admin_secondary possono aggiornare i vincoli altrui
  IF (SELECT role FROM public.profiles WHERE id = auth.uid())
       NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Non autorizzato: ruolo insufficiente.';
  END IF;

  UPDATE public.profiles SET
    max_hours_per_week = p_max_hours,
    weekly_rest_day    = p_rest_day,
    shift_preference   = p_shift_preference,
    shift_avoid        = p_shift_avoid,
    recurring_shifts   = COALESCE(p_recurring_shifts, '[]'::jsonb)
  WHERE id = p_user_id;

  -- Verifica che la riga sia stata aggiornata
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operatore non trovato: %', p_user_id;
  END IF;
END;
$$;

-- ── SEZIONE 5: Test funzionale (sostituire <OPERATOR_UUID> con un UUID reale) ──
-- Questo test verifica che il manager loggato possa salvare i vincoli.
-- Eseguire SOLO se loggato come manager nel SQL Editor (usa auth.uid()).

/*
SELECT public.save_operator_constraints(
  '<OPERATOR_UUID>'::uuid,
  36,
  'Lunedì',
  'mattina',
  'notte',
  '[]'::jsonb
);
*/

-- ── SEZIONE 6: Verifica post-salvataggio ──────────────────────────────────────
-- Dopo aver salvato dalla UI, eseguire questa query per confermare la persistenza.

SELECT
  id,
  full_name,
  role,
  max_hours_per_week,
  weekly_rest_day,
  shift_preference,
  shift_avoid
FROM public.profiles
WHERE role IN ('operator', 'admin_secondary', 'coordinator')
  AND max_hours_per_week IS NOT NULL
ORDER BY full_name;

-- Se questa query mostra valori corretti ma l'UI li perde al cambio pagina,
-- il problema è nella lettura (get_team_members), non nella scrittura.

-- ── SEZIONE 7: Verifica get_team_members restituisce i vincoli ───────────────

SELECT
  routine_name,
  string_agg(parameter_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS params
FROM information_schema.routines r
LEFT JOIN information_schema.parameters p
  ON r.specific_name = p.specific_name
WHERE r.routine_schema = 'public'
  AND r.routine_name   = 'get_team_members'
GROUP BY routine_name;

-- Verifica che max_hours_per_week, weekly_rest_day, shift_preference, shift_avoid,
-- recurring_shifts siano nel RETURN TABLE di get_team_members.
-- Se mancano → aggiornare get_team_members con fix_get_team_members_v4.sql.
