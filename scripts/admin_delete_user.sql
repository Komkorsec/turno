-- ════════════════════════════════════════════════════════════════════
--  RPC admin_delete_user  (v2 — senza check email, accesso gated dall'app)
--  Eseguire nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Impedisce auto-eliminazione
  if auth.uid() = p_user_id then
    raise exception 'Non puoi eliminare il tuo stesso account.';
  end if;

  -- Preserva i diari: nullifica operator_id invece di eliminarli
  update public.diaries
     set operator_id = null
   where operator_id = p_user_id;

  -- Preserva i log farmaci se la tabella esiste
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'medication_logs') then
    execute 'update public.medication_logs set operator_id = null where operator_id = $1'
      using p_user_id;
  end if;

  -- Elimina il profilo (cascade: turni, notifiche, assenze, ecc.)
  delete from public.profiles where id = p_user_id;

  -- Revoca l'accesso all'app eliminando l'utente da auth
  delete from auth.users where id = p_user_id;
end;
$$;

-- Solo gli utenti autenticati possono chiamarla (l'app verifica già che sia l'admin)
revoke execute on function public.admin_delete_user(uuid) from public;
grant  execute on function public.admin_delete_user(uuid) to authenticated;

-- Policy DELETE su profiles per l'admin (usata come fallback se la RPC non è disponibile)
drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles
  for delete to authenticated
  using (auth.uid() = id or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com');
