-- ════════════════════════════════════════════════════════════════════
--  RPC get_team_members: il manager legge i profili del team
--  bypassando la RLS (SECURITY DEFINER) senza toccare la policy
--  globale su profiles.
--
--  Sicurezza: verifica che la struttura richiesta appartenga
--  all'organizzazione del manager chiamante.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.get_team_members(p_structure_id integer)
returns table (
  id                  uuid,
  full_name           text,
  email               text,
  role                text,
  created_at          timestamptz,
  structure_id        integer,
  max_hours_per_week  integer,
  weekly_rest_day     text,
  contract_pdf_url    text
)
language sql stable security definer
set search_path = public as $$
  -- Sicurezza: il chiamante deve essere manager/admin_secondary
  -- della stessa organizzazione cui appartiene la struttura richiesta.
  select distinct
    p.id, p.full_name, p.email, p.role, p.created_at,
    p.structure_id, p.max_hours_per_week, p.weekly_rest_day, p.contract_pdf_url
  from profiles p
  where
    -- la struttura appartiene all'organizzazione del chiamante
    exists (
      select 1 from structures s
      join  profiles caller on caller.id = auth.uid()
      where s.id = p_structure_id
        and s.organization_id = caller.organization_id
    )
    -- l'operatore è nella struttura (legacy: profile.structure_id)
    -- oppure assegnato via user_structures (multi-struttura)
    and (
      p.structure_id = p_structure_id
      or exists (
        select 1 from user_structures us
        where us.user_id = p.id and us.structure_id = p_structure_id
      )
    )
    -- escludi i manager stessi dall'elenco team
    and p.role != 'manager'
  order by p.full_name;
$$;
