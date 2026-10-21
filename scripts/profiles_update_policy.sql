-- ════════════════════════════════════════════════════════════════════
--  Profiles UPDATE policy
--  Permette al manager di aggiornare i campi contrattuali degli
--  operatori della propria organizzazione.
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- Policy 1: ogni utente autenticato può aggiornare il proprio profilo
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using  (id = auth.uid())
  with check (id = auth.uid());

-- Policy 2: il manager può aggiornare i profili degli operatori
--           nella propria organizzazione
create policy "profiles_update_manager" on public.profiles
  for update to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    and public.my_org_owns_structure(structure_id)
  )
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    and public.my_org_owns_structure(structure_id)
  );
