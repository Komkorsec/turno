-- ════════════════════════════════════════════════════════
--  Isolamento totale per struttura
-- ════════════════════════════════════════════════════════

-- ── structures ───────────────────────────────────────────
drop policy if exists "structures_read" on public.structures;

-- Ogni utente vede SOLO la propria struttura.
-- L'admin (email hardcoded) vede tutte le strutture
-- per poter generare codici operatore dalla dashboard.
create policy "structures_read" on public.structures
  for select to authenticated
  using (
    id = (select structure_id from public.profiles where id = auth.uid())
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );

-- ── diaries ──────────────────────────────────────────────
drop policy if exists "diaries_operator_read" on public.diaries;
drop policy if exists "diaries_manager_read"  on public.diaries;

-- Policy unica: chiunque (operatore o manager) vede solo
-- i diari della propria struttura.
create policy "diaries_read" on public.diaries
  for select to authenticated
  using (
    structure_id = (select structure_id from public.profiles where id = auth.uid())
  );

-- La policy di insert era già corretta, non va toccata.
