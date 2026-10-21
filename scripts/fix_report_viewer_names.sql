-- ════════════════════════════════════════════════════════════════════
--  Fix: nomi visualizzatori report (doppie spunte) mostrano "?"
--
--  Problema: la query diretta su profiles è bloccata da RLS per i
--  manager → viewerProfiles torna vuoto → fallback a "?"
--
--  Fix: RPC SECURITY DEFINER che riceve un array di UUID e restituisce
--  id + full_name, bypassando RLS come già fatto per get_structure_diaries
-- ════════════════════════════════════════════════════════════════════

create or replace function public.get_profiles_by_ids(p_ids uuid[])
returns table (id uuid, full_name text)
language sql
security definer
stable
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.id = any(p_ids);
$$;

grant execute on function public.get_profiles_by_ids(uuid[]) to authenticated;
