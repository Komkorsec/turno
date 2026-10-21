-- ════════════════════════════════════════════════════════════════════
--  save_operator_constraints
--  Nuova funzione con nome univoco — elimina il problema delle
--  multiple overload di update_operator_contract che causava il
--  mancato salvataggio silenzioso (PostgREST non riusciva a fare
--  il match della firma).
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- Rimuove tutte le versioni di update_operator_contract (cleanup)
drop function if exists public.update_operator_contract(uuid, integer, text, text);
drop function if exists public.update_operator_contract(uuid, integer, text, text, jsonb);
drop function if exists public.update_operator_contract(uuid, integer, text, text, text, jsonb);
drop function if exists public.update_operator_contract(uuid, uuid, integer, text, text, text, jsonb);

-- Nuova funzione con nome univoco — nessun overload, nessuna ambiguità
create or replace function public.save_operator_constraints(
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
  if (select role from public.profiles where id = auth.uid())
       not in ('manager', 'admin_secondary') then
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
