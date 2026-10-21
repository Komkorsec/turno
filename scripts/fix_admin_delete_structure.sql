-- ════════════════════════════════════════════════════════════════════
--  Fix: cancellazione strutture dal pannello admin
--  Sostituisce il hard-delete diretto (bloccato da RLS) con una
--  funzione RPC SECURITY DEFINER che bypassa RLS e gestisce CASCADE.
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Assicura CASCADE su tutte le FK rilevanti ──────────────────────────────

-- diaries → structures
alter table public.diaries
  drop constraint if exists diaries_structure_id_fkey;
alter table public.diaries
  add constraint diaries_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

-- invitation_codes → structures
alter table public.invitation_codes
  drop constraint if exists invitation_codes_structure_id_fkey;
alter table public.invitation_codes
  add constraint invitation_codes_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

-- profiles → structures (SET NULL: non cancella gli utenti)
alter table public.profiles
  drop constraint if exists profiles_structure_id_fkey;
alter table public.profiles
  add constraint profiles_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete set null;

-- residents → structures
alter table public.residents
  drop constraint if exists residents_structure_id_fkey;
alter table public.residents
  add constraint residents_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

-- schedules → structures
alter table public.schedules
  drop constraint if exists schedules_structure_id_fkey;
alter table public.schedules
  add constraint schedules_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

-- ─── 2. RPC admin_delete_structure ────────────────────────────────────────────
--  SECURITY DEFINER = gira come owner del DB, bypassa RLS.
--  Controllo email hardcoded: solo il super admin può chiamarla.

create or replace function public.admin_delete_structure(p_structure_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() ->> 'email') <> 'umberto.vignati05@gmail.com' then
    raise exception 'Non autorizzato';
  end if;

  delete from public.structures where id = p_structure_id;
end;
$$;

-- ─── 3. Policy DELETE per sicurezza (fallback) ─────────────────────────────────

drop policy if exists "structures_delete_admin" on public.structures;
create policy "structures_delete_admin" on public.structures
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com');
