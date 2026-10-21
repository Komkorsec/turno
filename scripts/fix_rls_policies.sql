-- Fix: rimozione delle policy ricorsive su profiles e diaries
-- Esegui questo script nel SQL Editor di Supabase

-- 1. Drop delle policy problematiche
drop policy if exists "profiles_own"          on public.profiles;
drop policy if exists "profiles_manager_read" on public.profiles;
drop policy if exists "diaries_manager_read"  on public.diaries;

-- 2. Nuova policy profiles: ogni utente legge solo il proprio profilo
--    (nessuna subquery su profiles → zero ricorsione)
create policy "profiles_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- 3. Nuova policy profiles: il manager legge tutti i profili
--    Leggiamo il ruolo dal JWT (user_metadata), NON dalla tabella profiles
create policy "profiles_manager_read" on public.profiles
  for select to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
  );

-- 4. Nuova policy diaries: il manager vede i diari di tutte le strutture
--    Stessa tecnica: ruolo dal JWT, nessuna subquery su profiles
create policy "diaries_manager_read" on public.diaries
  for select to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
  );
