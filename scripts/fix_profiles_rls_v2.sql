-- ════════════════════════════════════════════════════════
--  Profiles RLS v2: permetti lettura profili stessa struttura
--  senza ricorsione infinita
-- ════════════════════════════════════════════════════════

-- 1. Funzione security definer: legge structure_id del chiamante
--    bypassando la RLS (evita ricorsione nelle policy)
create or replace function public.my_structure_id()
returns smallint language sql stable security definer
set search_path = public as $$
  select structure_id from public.profiles where id = auth.uid()
$$;

-- 2. Rimpiazza la policy di lettura su profiles
drop policy if exists "profiles_read"        on public.profiles;
drop policy if exists "profiles_admin_read"  on public.profiles;

-- Policy unica: ognuno legge il proprio + tutti nella stessa struttura
-- (necessario per: join diari→profili, join codici→riscattatore)
create policy "profiles_read" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or structure_id = public.my_structure_id()
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );
