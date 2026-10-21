-- ════════════════════════════════════════════════════════════════════
--  RECOVERY URGENTE: ripristina la policy profiles_read originale
--  Esegui SUBITO nel SQL Editor di Supabase se l'app è bloccata.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "profiles_read" on public.profiles;

create policy "profiles_read" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or structure_id = public.my_structure_id()
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );
