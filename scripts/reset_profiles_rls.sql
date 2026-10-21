-- Step 1: elimina TUTTE le policy su profiles
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies where tablename = 'profiles' and schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end;
$$;

-- Step 2: unica policy semplice, nessuna subquery, nessuna ricorsione
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);
