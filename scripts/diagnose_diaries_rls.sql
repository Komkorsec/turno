-- ── Diagnosi: perché il manager vede 0 diari ─────────────────────────────────
-- Esegui ogni blocco separatamente nel SQL Editor di Supabase
-- mentre sei loggato come manager (o usa "Run as role" se disponibile)

-- 1. Controlla il tuo ruolo e struttura nel profilo
SELECT id, role, structure_id, organization_id
FROM public.profiles
WHERE id = auth.uid();

-- 2. Controlla se my_org_owns_structure funziona per le strutture esistenti
SELECT id, name, public.my_org_owns_structure(id) AS owned
FROM public.structures;

-- 3. Quanti diari esistono totalmente in DB (bypassando RLS)
-- (da eseguire come postgres/service_role, non come utente)
-- SELECT COUNT(*) FROM public.diaries;

-- 4. Controlla le policy attive su diaries
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'diaries';

-- 5. Prova la query diretta con RLS attiva (come l'utente corrente)
SELECT COUNT(*) FROM public.diaries;
