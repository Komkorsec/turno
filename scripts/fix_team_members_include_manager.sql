-- ════════════════════════════════════════════════════════════════════
--  Aggiorna get_team_members: il manager vede se stesso nel team.
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
    and (
      -- il manager chiamante: sempre incluso
      p.id = auth.uid()
      -- operatori/coordinatori nella struttura (legacy o user_structures)
      or (
        p.role != 'manager'
        and (
          p.structure_id = p_structure_id
          or exists (
            select 1 from user_structures us
            where us.user_id = p.id and us.structure_id = p_structure_id
          )
        )
      )
    )
  order by p.full_name;
$$;
