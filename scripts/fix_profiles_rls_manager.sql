-- ════════════════════════════════════════════════════════════════════
--  Fix RLS profiles: i manager possono vedere tutti i profili
--  delle strutture nella loro organizzazione.
--
--  Problema: my_structure_id() ritorna NULL per i manager (il loro
--  profilo non ha structure_id), quindi la policy "profiles_read"
--  non fa matchare nessun operatore.
--
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- 1. Helper: organization_id del chiamante (bypassa RLS, nessuna ricorsione)
create or replace function public.my_organization_id()
returns bigint language sql stable security definer
set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

-- 2. Sostituisce la policy di lettura su profiles
drop policy if exists "profiles_read" on public.profiles;

create policy "profiles_read" on public.profiles
  for select to authenticated
  using (
    -- il proprio profilo
    id = auth.uid()

    -- stessa struttura (operatori/coordinatori vedono i colleghi)
    or (
      public.my_structure_id() is not null
      and structure_id = public.my_structure_id()
    )

    -- manager: tutti i profili nelle strutture della propria organizzazione
    -- (incluso chi è assegnato via user_structures)
    or (
      public.my_organization_id() is not null
      and (
        structure_id in (
          select id from public.structures
          where organization_id = public.my_organization_id()
        )
        or id in (
          select us.user_id
          from public.user_structures us
          join public.structures s on s.id = us.structure_id
          where s.organization_id = public.my_organization_id()
        )
      )
    )

    -- admin override
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );
