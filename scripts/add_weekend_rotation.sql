-- ════════════════════════════════════════════════════════════════════
--  Weekend Rotation
--  1. Aggiunge last_weekend_off a profiles
--  2. Crea RPC set_weekend_off (SECURITY DEFINER)
--
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists last_weekend_off date;

-- RPC: aggiorna last_weekend_off per una lista di operatori
create or replace function public.set_weekend_off(
  p_user_ids uuid[],
  p_date     date
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

  update public.profiles
  set last_weekend_off = p_date
  where id = any(p_user_ids);
end;
$$;
