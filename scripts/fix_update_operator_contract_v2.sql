-- ════════════════════════════════════════════════════════════════════
--  fix_update_operator_contract_v2
--  Rimuove TUTTE le versioni precedenti della funzione (con qualunque
--  firma) e ricrea l'unica versione corretta a 6 parametri.
--
--  Problema: il JS passava p_structure_id che non esiste nella firma
--  → PostgREST non trovava la funzione → aggiornamento silenziosamente
--  ignorato senza errore.
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- Rimuove tutte le overload esistenti
drop function if exists public.update_operator_contract(uuid, integer, text, text);
drop function if exists public.update_operator_contract(uuid, integer, text, text, text, jsonb);
drop function if exists public.update_operator_contract(uuid, uuid, integer, text, text, text, jsonb);

-- Unica versione corretta: SECURITY DEFINER bypassa RLS
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
  -- Solo manager o admin_secondary possono modificare contratti altrui
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
