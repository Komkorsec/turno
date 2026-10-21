-- ════════════════════════════════════════════════════════════════════
--  Fix: nome operatore mancante nella cronologia diari
--
--  Problema: il join `profiles!operator_id` nelle query dirette
--  fallisce silenziosamente (FK assente o RLS blocca il join)
--  e restituisce null → il frontend mostra "Operatore".
--
--  Soluzione:
--    1. Assicura che la FK esista
--    2. Crea RPC get_structure_diaries() con SECURITY DEFINER
--       che fa un SQL JOIN diretto su profiles (bypassando RLS)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Assicura FK diaries.operator_id → profiles.id ────────────────────────

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'diaries'
      and constraint_name = 'diaries_operator_id_fkey'
      and constraint_type = 'FOREIGN KEY'
  ) then
    alter table public.diaries
      add constraint diaries_operator_id_fkey
        foreign key (operator_id) references public.profiles(id) on delete set null;
  end if;
end $$;

-- ─── 2. RPC get_structure_diaries ────────────────────────────────────────────

create or replace function public.get_structure_diaries(
  p_structure_id bigint,
  p_date_from    timestamptz default null,
  p_limit        int         default 200
)
returns table (
  id              bigint,
  operator_id     uuid,
  operator_name   text,
  mood            int,
  has_incident    boolean,
  incident_type   text,
  incident_notes  text,
  handover_notes  text,
  manager_notes   text,
  created_at      timestamptz,
  edited_at       timestamptz,
  shift_start     text,
  shift_end       text,
  is_urgent       boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    d.id,
    d.operator_id,
    coalesce(p.full_name, 'Operatore rimosso') as operator_name,
    d.mood,
    d.has_incident,
    d.incident_type,
    d.incident_notes,
    d.handover_notes,
    d.manager_notes,
    d.created_at,
    d.edited_at,
    d.shift_start,
    d.shift_end,
    coalesce(d.is_urgent, false) as is_urgent
  from public.diaries d
  left join public.profiles p on p.id = d.operator_id
  where d.structure_id = p_structure_id
    and (p_date_from is null or d.created_at >= p_date_from)
  order by d.created_at desc
  limit p_limit;
$$;

grant execute on function public.get_structure_diaries(bigint, timestamptz, int) to authenticated;
