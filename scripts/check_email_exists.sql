-- Verifica se una email è registrata in auth.users
-- SECURITY DEFINER necessario perché auth.users non è accessibile agli utenti anonimi

create or replace function public.check_email_exists(p_email text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from auth.users where lower(email) = lower(p_email)
  );
$$;

grant execute on function public.check_email_exists(text) to anon, authenticated;
