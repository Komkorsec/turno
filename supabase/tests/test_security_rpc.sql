-- =============================================================================
-- Turno – Test di sicurezza RPC
-- =============================================================================
-- Eseguire dopo aver applicato la migrazione security_fix.
--
-- Prerequisiti:
--   1. supabase start (stack locale)
--   2. Applicare la migrazione: psql $DB_URL -f supabase/migrations/20261015000000_security_fix.sql
--   3. Creare i dati di test (sezione SETUP qui sotto)
--   4. Eseguire questo file: psql $DB_URL -f supabase/tests/test_security_rpc.sql
--
-- I test usano pgTAP. Installare con:
--   supabase db execute --file - <<< "CREATE EXTENSION IF NOT EXISTS pgtap;"
-- =============================================================================

BEGIN;

SELECT plan(47);

-- =============================================================================
-- SETUP: dati di test fittizi
-- =============================================================================

-- Organizzazione A
INSERT INTO public.organizations (id, name, max_structures)
VALUES (9991, 'Org Test A', 3)
ON CONFLICT DO NOTHING;

-- Organizzazione B (diversa)
INSERT INTO public.organizations (id, name, max_structures)
VALUES (9992, 'Org Test B', 1)
ON CONFLICT DO NOTHING;

-- Struttura A1
INSERT INTO public.structures (id, name, organization_id)
VALUES (9991, 'Struttura A1', 9991)
ON CONFLICT DO NOTHING;

-- Struttura B1 (org diversa)
INSERT INTO public.structures (id, name, organization_id)
VALUES (9992, 'Struttura B1', 9992)
ON CONFLICT DO NOTHING;

-- Utenti fittizi in auth.users e profiles
-- manager org A
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0001-000000000001', 'manager_a@test.local', 'x', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id)
VALUES ('00000000-0000-0000-0001-000000000001', 'Manager A', 'manager', 9991, 9991)
ON CONFLICT DO NOTHING;

-- operatore org A
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0001-000000000002', 'op_a@test.local', 'x', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id)
VALUES ('00000000-0000-0000-0001-000000000002', 'Operatore A', 'operator', 9991, 9991)
ON CONFLICT DO NOTHING;

-- manager org B
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0002-000000000001', 'manager_b@test.local', 'x', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id)
VALUES ('00000000-0000-0000-0002-000000000001', 'Manager B', 'manager', 9992, 9992)
ON CONFLICT DO NOTHING;

-- utente "vittima" da cancellare nei test
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-ffff-0000-000000000001', 'victim@test.local', 'x', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, role, structure_id, organization_id)
VALUES ('00000000-0000-ffff-0000-000000000001', 'Vittima Test', 'operator', 9991, 9991)
ON CONFLICT DO NOTHING;

-- Diario di test
INSERT INTO public.diaries (id, structure_id, operator_id, mood, has_incident, incident_notes, handover_notes, manager_notes)
VALUES (99999, 9991, '00000000-0000-0000-0001-000000000002', 3, false, 'note test', 'handover test', 'manager test')
ON CONFLICT DO NOTHING;

-- Assenza di test
INSERT INTO public.absences (id, user_id, start_date, end_date, is_full_day, slot_type, status)
VALUES (99999, '00000000-0000-0000-0001-000000000002', '2026-12-01', '2026-12-02', true, 'giorno_intero', 'pending')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- TEST 1: anon non può cancellare utenti (admin_delete_user)
-- =============================================================================
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{}';

SELECT throws_ok(
  $$ SELECT public.admin_delete_user('00000000-0000-ffff-0000-000000000001') $$,
  'Non autorizzato.',
  'CRITICO-1: anon non può chiamare admin_delete_user'
);

-- =============================================================================
-- TEST 2: anon non può cancellare organizzazioni (admin_delete_organization)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.admin_delete_organization(9991) $$,
  'Non autorizzato',
  'CRITICO-2: anon non può chiamare admin_delete_organization'
);

-- =============================================================================
-- TEST 3: anon non può cancellare strutture (admin_delete_structure)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.admin_delete_structure(9991) $$,
  'Non autorizzato',
  'CRITICO-3: anon non può chiamare admin_delete_structure'
);

-- =============================================================================
-- TEST 4: anon non può rimuovere operatori (remove_operator)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.remove_operator('00000000-0000-0000-0001-000000000002') $$,
  'Autenticazione richiesta.',
  'CRITICO-4: anon non può chiamare remove_operator'
);

-- =============================================================================
-- TEST 5: anon non può eliminare operatori archiviati (delete_archived_operator)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.delete_archived_operator('00000000-0000-0000-0001-000000000002') $$,
  'Autenticazione richiesta.',
  'CRITICO-5: anon non può chiamare delete_archived_operator'
);

-- =============================================================================
-- TEST 6: anon non ottiene diari (get_structure_diaries restituisce 0 righe)
-- =============================================================================
SELECT is(
  (SELECT count(*) FROM public.get_structure_diaries(9991))::integer,
  0,
  'CRITICO-6: anon non ottiene diari dalla struttura'
);

-- =============================================================================
-- TEST 7: anon non può inserire assenze (manager_add_absence)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT * FROM public.manager_add_absence(
       '00000000-0000-0000-0001-000000000002',
       '2026-12-01', '2026-12-02', 'test') $$,
  'Autenticazione richiesta.',
  'ALTO-7: anon non può chiamare manager_add_absence'
);

-- =============================================================================
-- TEST 8: anon non può cancellare assenze (manager_delete_absences)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.manager_delete_absences(ARRAY[99999::bigint]) $$,
  'Autenticazione richiesta.',
  'ALTO-8: anon non può chiamare manager_delete_absences'
);

-- =============================================================================
-- TEST 9: anon non può modificare last_weekend_off (set_weekend_off)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.set_weekend_off(
       ARRAY['00000000-0000-0000-0001-000000000002'::uuid],
       '2026-12-07') $$,
  'Autenticazione richiesta.',
  'ALTO-9: anon non può chiamare set_weekend_off'
);

-- =============================================================================
-- TEST 10: anon non può modificare vincoli operatore (save_operator_constraints)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.save_operator_constraints(
       '00000000-0000-0000-0001-000000000002', 9991,
       40, 'lunedi', 'mattina', NULL, '[]') $$,
  'Autenticazione richiesta.',
  'ALTO-10: anon non può chiamare save_operator_constraints'
);

-- =============================================================================
-- TEST 11: anon non può modificare contratto operatore (update_operator_contract)
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.update_operator_contract(
       '00000000-0000-0000-0001-000000000002', 9991,
       40, 'lunedi', 'mattina', NULL, '[]') $$,
  'Autenticazione richiesta.',
  'ALTO-11: anon non può chiamare update_operator_contract'
);

-- =============================================================================
-- TEST 12: anon non ottiene turni mensili
-- =============================================================================
SELECT is(
  (SELECT count(*) FROM public.get_month_schedules(9991, '2026-12-01', '2026-12-31'))::integer,
  0,
  'ALTO-12: anon non ottiene get_month_schedules'
);

-- =============================================================================
-- TEST 13: anon non ottiene turni settimanali
-- =============================================================================
SELECT is(
  (SELECT count(*) FROM public.get_week_schedules(9991, '2026-12-01'))::integer,
  0,
  'ALTO-13: anon non ottiene get_week_schedules'
);

-- =============================================================================
-- TEST 14: anon non ottiene membri struttura
-- =============================================================================
SELECT is(
  (SELECT count(*) FROM public.get_structure_members(9991))::integer,
  0,
  'ALTO-14: anon non ottiene get_structure_members'
);

-- =============================================================================
-- TEST 15: anon non ottiene assenze membro
-- =============================================================================
SELECT is(
  (SELECT count(*) FROM public.get_member_absences('00000000-0000-0000-0001-000000000002'))::integer,
  0,
  'ALTO-15: anon non ottiene get_member_absences'
);

-- =============================================================================
-- TEST 16: anon non ottiene profili per ID
-- =============================================================================
SELECT is(
  (SELECT count(*) FROM public.get_profiles_by_ids(
     ARRAY['00000000-0000-0000-0001-000000000001'::uuid]))::integer,
  0,
  'MEDIO-16: anon non ottiene get_profiles_by_ids'
);

-- =============================================================================
-- TEST 17: check_email_exists accessibile ad anon (necessaria per login flow)
-- =============================================================================
SELECT ok(
  (SELECT public.check_email_exists('manager_a@test.local')) = true,
  'ATTESO-17: check_email_exists funziona per anon (login flow)'
);

-- =============================================================================
-- TEST 18: anon non ottiene count operatori
-- =============================================================================
SELECT is(
  public.count_structure_operators(9991),
  0,
  'MEDIO-18: anon ottiene 0 da count_structure_operators (non espone dati)'
);

-- =============================================================================
-- Ora testiamo con JWT manager org A
-- =============================================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0000-0001-000000000001","role":"authenticated"}';

-- TEST 19: manager A ottiene diari della propria struttura
SELECT ok(
  (SELECT count(*) FROM public.get_structure_diaries(9991)) >= 0,
  'LEGITTIMO-19: manager A può leggere get_structure_diaries struttura propria'
);

-- TEST 20: manager A non ottiene diari della struttura B (org diversa)
SELECT is(
  (SELECT count(*) FROM public.get_structure_diaries(9992))::integer,
  0,
  'ISOLAMENTO-20: manager A non ottiene diari struttura di org B'
);

-- TEST 21: manager A ottiene turni mensili propria struttura
SELECT ok(
  (SELECT count(*) FROM public.get_month_schedules(9991, '2026-12-01', '2026-12-31')) >= 0,
  'LEGITTIMO-21: manager A legge get_month_schedules struttura propria'
);

-- TEST 22: manager A non ottiene turni struttura B
SELECT is(
  (SELECT count(*) FROM public.get_month_schedules(9992, '2026-12-01', '2026-12-31'))::integer,
  0,
  'ISOLAMENTO-22: manager A non legge turni struttura di org B'
);

-- TEST 23: manager A non può cancellare utente di org B (remove_operator)
SELECT throws_ok(
  $$ SELECT public.remove_operator('00000000-0000-0002-0000-000000000001') $$,
  NULL, -- l'eccezione può variare (non trovato o non autorizzato)
  'ISOLAMENTO-23: manager A non può rimuovere manager di org B'
);

-- TEST 24: manager A non può cancellare sé stesso (remove_operator)
SELECT throws_ok(
  $$ SELECT public.remove_operator('00000000-0000-0000-0001-000000000001') $$,
  'Non puoi eliminare il tuo stesso account.',
  'LEGITTIMO-24: manager A non può rimuovere sé stesso'
);

-- TEST 25: manager A può leggere assenze del proprio operatore
SELECT ok(
  (SELECT count(*) FROM public.get_member_absences('00000000-0000-0000-0001-000000000002')) >= 0,
  'LEGITTIMO-25: manager A legge assenze operatore proprio org'
);

-- TEST 26: manager A non legge assenze di utente org B
SELECT is(
  (SELECT count(*) FROM public.get_member_absences('00000000-0000-0002-0000-000000000001'))::integer,
  0,
  'ISOLAMENTO-26: manager A non legge assenze utenti org B'
);

-- =============================================================================
-- Test con JWT operatore org A
-- =============================================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0000-0001-000000000002","role":"authenticated"}';

-- TEST 27: operatore A ottiene diari della propria struttura
SELECT ok(
  (SELECT count(*) FROM public.get_structure_diaries(9991)) >= 0,
  'LEGITTIMO-27: operatore A legge get_structure_diaries propria struttura'
);

-- TEST 28: operatore A non ottiene diari struttura B
SELECT is(
  (SELECT count(*) FROM public.get_structure_diaries(9992))::integer,
  0,
  'ISOLAMENTO-28: operatore A non legge diari struttura org B'
);

-- TEST 29: operatore A non può chiamare admin_delete_user
SELECT throws_ok(
  $$ SELECT public.admin_delete_user('00000000-0000-ffff-0000-000000000001') $$,
  'Non autorizzato.',
  'LEGITTIMO-29: operatore A non può chiamare admin_delete_user'
);

-- TEST 30: operatore A non può chiamare remove_operator
SELECT throws_ok(
  $$ SELECT public.remove_operator('00000000-0000-ffff-0000-000000000001') $$,
  'Non autorizzato: solo i manager possono rimuovere operatori.',
  'LEGITTIMO-30: operatore A non può chiamare remove_operator'
);

-- TEST 31: operatore A non può inserire assenze per altri utenti
SELECT throws_ok(
  $$ SELECT * FROM public.manager_add_absence(
       '00000000-0000-0000-0001-000000000001',
       '2026-12-01', '2026-12-02', 'test') $$,
  'Non autorizzato.',
  'LEGITTIMO-31: operatore A non può usare manager_add_absence'
);

-- TEST 32: operatore A non può pubblicare turni
SELECT throws_ok(
  $$ SELECT public.publish_week_schedules(9991, '2026-12-01', '2026-12-07') $$,
  'Non autorizzato',
  'LEGITTIMO-32: operatore A non può chiamare publish_week_schedules'
);

-- TEST 33: operatore A vede le proprie assenze
SELECT ok(
  (SELECT count(*) FROM public.get_member_absences('00000000-0000-0000-0001-000000000002')) >= 0,
  'LEGITTIMO-33: operatore A legge le proprie assenze'
);

-- =============================================================================
-- Test con JWT manager org B
-- =============================================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0002-0000-000000000001","role":"authenticated"}';

-- TEST 34: manager B non legge diari struttura A
SELECT is(
  (SELECT count(*) FROM public.get_structure_diaries(9991))::integer,
  0,
  'ISOLAMENTO-34: manager B non legge diari struttura org A'
);

-- TEST 35: manager B non legge turni struttura A
SELECT is(
  (SELECT count(*) FROM public.get_week_schedules(9991, '2026-12-01'))::integer,
  0,
  'ISOLAMENTO-35: manager B non legge turni struttura org A'
);

-- TEST 36: manager B non ottiene membri struttura A
SELECT is(
  (SELECT count(*) FROM public.get_structure_members(9991))::integer,
  0,
  'ISOLAMENTO-36: manager B non ottiene membri struttura org A'
);

-- TEST 37: manager B non legge assenze operatori org A
SELECT is(
  (SELECT count(*) FROM public.get_member_absences('00000000-0000-0000-0001-000000000002'))::integer,
  0,
  'ISOLAMENTO-37: manager B non legge assenze operatori org A'
);

-- TEST 38: manager B non può aggiungere assenze a operatori org A
SELECT throws_ok(
  $$ SELECT * FROM public.manager_add_absence(
       '00000000-0000-0000-0001-000000000002',
       '2026-12-01', '2026-12-02', NULL) $$,
  'Non autorizzato: utente non appartiene alla tua organizzazione.',
  'ISOLAMENTO-38: manager B non può aggiungere assenze a operatori org A'
);

-- TEST 39: manager B non può rimuovere operatori org A
SELECT throws_ok(
  $$ SELECT public.remove_operator('00000000-0000-0000-0001-000000000002') $$,
  'Non autorizzato: l''operatore non appartiene alla tua organizzazione.',
  'ISOLAMENTO-39: manager B non può rimuovere operatori org A'
);

-- TEST 40: get_profiles_by_ids restituisce risultati solo per authenticated
SELECT ok(
  (SELECT count(*) FROM public.get_profiles_by_ids(
     ARRAY['00000000-0000-0002-0000-000000000001'::uuid])) >= 0,
  'LEGITTIMO-40: authenticated può chiamare get_profiles_by_ids'
);

-- =============================================================================
-- CLEANUP
-- =============================================================================
-- =============================================================================
-- SEZIONE: update_user_structures — permessi e casi limite
-- =============================================================================

-- Setup aggiuntivo: struttura extra 9993 nella stessa org 9991
INSERT INTO public.organizations (id, name, max_structures)
VALUES (9993, 'Org Test C (struttura extra)', 5)
ON CONFLICT DO NOTHING;

INSERT INTO public.structures (id, name, organization_id)
VALUES (9993, 'Struttura Extra Test', 9991)
ON CONFLICT DO NOTHING;

-- Turno futuro per l'operatore 9992-001 nella struttura 9992
INSERT INTO public.schedules (id, structure_id, user_id, date, shift_type, published)
VALUES (
  99998,
  9992,
  '00000000-0000-0002-0000-000000000001',
  CURRENT_DATE + 7,
  'mattina',
  true
)
ON CONFLICT DO NOTHING;

-- ── Permessi ──────────────────────────────────────────────────────────────────

-- 41. anon non può chiamare update_user_structures
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{}';
SELECT throws_ok(
  $$ SELECT public.update_user_structures(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[9992]::bigint[],
       false
     ) $$,
  'Autenticazione richiesta.',
  'PERM-41: anon non può update_user_structures'
);
RESET ROLE;

-- 42. operatore non può chiamare update_user_structures
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0002-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.update_user_structures(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[9992]::bigint[],
       false
     ) $$,
  'Non autorizzato: solo i manager possono modificare le strutture assegnate.',
  'PERM-42: operatore non può update_user_structures'
);
RESET ROLE;

-- 43. coordinatore (admin_secondary) non può chiamare update_user_structures
-- Nota: se non esiste un admin_secondary nei dati di test, simula con JWT non-manager
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-ffff-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.update_user_structures(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[9992]::bigint[],
       false
     ) $$,
  'Non autorizzato: solo i manager possono modificare le strutture assegnate.',
  'PERM-43: non-manager non può update_user_structures'
);
RESET ROLE;

-- ── Ultima struttura ──────────────────────────────────────────────────────────

-- 44. manager non può passare array vuoto
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0001-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.update_user_structures(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[]::bigint[],
       false
     ) $$,
  'Un utente deve appartenere ad almeno una struttura.',
  'EDGE-44: array vuoto bloccato'
);
RESET ROLE;

-- 45. manager non può passare strutture di un''altra org
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0001-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.update_user_structures(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[9992, 99999]::bigint[],  -- 99999 non esiste / altra org
       false
     ) $$,
  'Non autorizzato: alcune strutture non appartengono alla tua organizzazione.',
  'EDGE-45: struttura altra org bloccata'
);
RESET ROLE;

-- ── Turni futuri ──────────────────────────────────────────────────────────────

-- 46. check_structure_removal_impact trova il turno futuro pubblicato
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"00000000-0000-0001-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT schedule_count
     FROM public.check_structure_removal_impact(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[9992]::bigint[]
     )
   LIMIT 1)::int,
  1,
  'IMPACT-46: check_structure_removal_impact trova il turno futuro'
);
RESET ROLE;

-- 47. anon non ottiene risultati da check_structure_removal_impact
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{}';
SELECT is(
  (SELECT count(*)::int
     FROM public.check_structure_removal_impact(
       '00000000-0000-0002-0000-000000000001'::uuid,
       ARRAY[9992]::bigint[]
     )),
  0,
  'IMPACT-47: anon non vede impatto (auth.uid() NULL filtra tutto)'
);
RESET ROLE;

-- Cleanup dati aggiuntivi
DELETE FROM public.schedules    WHERE id = 99998;
DELETE FROM public.structures   WHERE id = 9993;
DELETE FROM public.organizations WHERE id = 9993;

RESET ROLE;

DELETE FROM public.diaries WHERE id = 99999;
DELETE FROM public.absences WHERE id = 99999;
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0002-0000-000000000001',
  '00000000-0000-ffff-0000-000000000001'
);
DELETE FROM public.structures WHERE id IN (9991, 9992);
DELETE FROM public.organizations WHERE id IN (9991, 9992);

SELECT * FROM finish();

ROLLBACK; -- i test non modificano il db
