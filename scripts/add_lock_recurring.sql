-- ════════════════════════════════════════════════════════════════════
--  Lock & Recurring Shifts
--  1. Aggiunge is_locked a schedules
--  2. Aggiunge recurring_shifts a profiles
--  3. Aggiorna get_week_schedules per restituire is_locked
--  4. Aggiorna update_operator_contract per gestire recurring_shifts
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Colonna is_locked su schedules ───────────────────────────────────────

alter table public.schedules
  add column if not exists is_locked boolean not null default false;

create index if not exists schedules_locked_idx on public.schedules(is_locked)
  where is_locked = true;

-- ─── 2. Colonna recurring_shifts su profiles ─────────────────────────────────
-- Formato: [{"day": "Lunedì", "shift": "mattina"}, ...]

alter table public.profiles
  add column if not exists recurring_shifts jsonb not null default '[]'::jsonb;

-- ─── 3. Aggiorna get_week_schedules ──────────────────────────────────────────

create or replace function public.get_week_schedules(
  p_structure_id bigint,
  p_week_start   date
)
returns table (
  id           bigint,
  structure_id bigint,
  user_id      uuid,
  date         date,
  shift_type   public.shift_type,
  label        text,
  is_locked    boolean,
  created_at   timestamptz,
  updated_at   timestamptz,
  full_name    text
)
language sql stable security invoker
set search_path = public
as $$
  select
    s.id,
    s.structure_id,
    s.user_id,
    s.date,
    s.shift_type,
    s.label,
    s.is_locked,
    s.created_at,
    s.updated_at,
    p.full_name
  from public.schedules s
  join public.profiles  p on p.id = s.user_id
  where s.structure_id = p_structure_id
    and s.date >= p_week_start
    and s.date <  p_week_start + interval '7 days'
  order by s.date, s.shift_type, p.full_name;
$$;

-- ─── 4. Aggiorna update_operator_contract ────────────────────────────────────

create or replace function public.update_operator_contract(
  p_user_id          uuid,
  p_max_hours        integer,
  p_rest_day         text,
  p_shift_preference text,
  p_recurring_shifts jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'manager' then
    raise exception 'Non autorizzato.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id
      and public.my_org_owns_structure(structure_id)
  ) then
    raise exception 'Operatore non nella tua organizzazione.';
  end if;

  update public.profiles set
    max_hours_per_week = p_max_hours,
    weekly_rest_day    = p_rest_day,
    shift_preference   = p_shift_preference,
    recurring_shifts   = coalesce(p_recurring_shifts, '[]'::jsonb)
  where id = p_user_id;
end;
$$;
