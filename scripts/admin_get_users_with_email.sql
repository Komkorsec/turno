-- ════════════════════════════════════════════════════════════════════
--  RPC admin_get_users_with_email
--  Restituisce tutti i profili con l'email presa da auth.users.
--  SECURITY DEFINER: solo il super admin può chiamarla.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_get_users_with_email()
returns table (
  id          uuid,
  full_name   text,
  email       text,
  role        text,
  structure_id bigint,
  created_at  timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    u.email,
    p.role,
    p.structure_id,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  order by p.created_at desc;
$$;
