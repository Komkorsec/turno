-- ════════════════════════════════════════════════════════════════════
--  RPC: update_operator_contract
--  SECURITY DEFINER → bypassa RLS, esegue controllo autorizzazione
--  manualmente dentro la funzione stessa.
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.update_operator_contract(
  p_user_id          uuid,
  p_max_hours        integer,
  p_rest_day         text,
  p_shift_preference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo il manager può chiamare questa funzione
  if (select role from public.profiles where id = auth.uid()) <> 'manager' then
    raise exception 'Non autorizzato: solo il manager può modificare i contratti.';
  end if;

  -- L'operatore target deve appartenere alla stessa organizzazione
  if not exists (
    select 1 from public.profiles
    where id = p_user_id
      and public.my_org_owns_structure(structure_id)
  ) then
    raise exception 'Non autorizzato: operatore non appartiene alla tua organizzazione.';
  end if;

  -- Aggiornamento effettivo (bypassa RLS grazie a SECURITY DEFINER)
  update public.profiles set
    max_hours_per_week = p_max_hours,
    weekly_rest_day    = p_rest_day,
    shift_preference   = p_shift_preference
  where id = p_user_id;
end;
$$;
