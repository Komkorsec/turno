-- ════════════════════════════════════════════════════════════════════
--  Aggiunge shift_avoid a profiles e aggiorna update_operator_contract
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists shift_avoid text;

drop function if exists public.update_operator_contract(uuid, integer, text, text, jsonb);

create or replace function public.update_operator_contract(
  p_user_id          uuid,
  p_max_hours        integer,
  p_rest_day         text,
  p_shift_preference text,
  p_shift_avoid      text,
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
    shift_avoid        = p_shift_avoid,
    recurring_shifts   = coalesce(p_recurring_shifts, '[]'::jsonb)
  where id = p_user_id;
end;
$$;
