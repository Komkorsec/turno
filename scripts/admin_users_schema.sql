-- ════════════════════════════════════════════════════════
--  Admin: anagrafica utenti + relazioni molti-a-molti
-- ════════════════════════════════════════════════════════

-- 1. Aggiungi email a profiles (per mostrarla nell'anagrafica)
alter table public.profiles
  add column if not exists email text;

-- 2. Aggiungi used_by a invitation_codes (chi ha riscattato il codice)
alter table public.invitation_codes
  add column if not exists used_by uuid references public.profiles(id);

-- 3. Tabella molti-a-molti utente ↔ strutture aggiuntive
create table if not exists public.user_structures (
  user_id      uuid     not null references public.profiles(id)  on delete cascade,
  structure_id smallint not null references public.structures(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, structure_id)
);

alter table public.user_structures enable row level security;

-- Lettura: ognuno vede le proprie, l'admin vede tutte
create policy "user_structures_read" on public.user_structures
  for select to authenticated
  using (
    user_id = auth.uid()
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );

-- 4. Policy admin su profiles (lettura di tutti i profili)
create policy "profiles_admin_read" on public.profiles
  for select to authenticated
  using (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );

-- 5. Trigger aggiornato: salva email + used_by
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_code     text;
  v_code_row public.invitation_codes%rowtype;
  v_sid      smallint;
  v_role     text;
  v_name     text;
  v_strname  text;
  v_new_uid  uuid;
begin
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  if v_code is not null then
    select * into v_code_row
      from public.invitation_codes
     where code = v_code and is_used = false;

    if not found then
      raise exception 'Codice invito non valido o già utilizzato.';
    end if;

    v_role := v_code_row.role;

    if v_role = 'manager' then
      insert into public.structures (name)
        values (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name))
        returning id into v_sid;
    else
      v_sid := v_code_row.structure_id;
    end if;

    -- Inserisce il profilo e salva l'id
    insert into public.profiles (id, full_name, role, structure_id, email)
      values (new.id, v_name, v_role, v_sid, new.email)
      returning id into v_new_uid;

    -- Marca il codice come usato e registra chi l'ha riscattato
    update public.invitation_codes
       set is_used = true, used_by = v_new_uid
     where code = v_code;

  else
    -- Flusso admin / seed
    v_role := coalesce(new.raw_user_meta_data->>'role', 'operator');
    v_sid  := (new.raw_user_meta_data->>'structure_id')::smallint;

    insert into public.profiles (id, full_name, role, structure_id, email)
      values (new.id, v_name, v_role, v_sid, new.email);
  end if;

  return new;
end;
$$;

-- 6. Aggiorna email nei profili esistenti (retrocompatibilità)
update public.profiles p
   set email = u.email
  from auth.users u
 where p.id = u.id
   and p.email is null;
