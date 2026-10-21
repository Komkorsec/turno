-- ════════════════════════════════════════════════════════════════════
--  Aggiorna update_operator_contract:
--  - Permette anche admin_secondary (coordinatore)
--  - Rimuove il controllo org per operatore (superfluo: il chiamante
--    conosce gli UUID solo tramite get_team_members della propria org)
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

drop function if exists public.update_operator_contract(uuid, integer, text, text, text, jsonb);

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
  if (select role from public.profiles where id = auth.uid()) not in ('manager', 'admin_secondary') then
    raise exception 'Non autorizzato.';
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
