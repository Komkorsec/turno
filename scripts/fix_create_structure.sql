-- Fix: create_structure con SECURITY DEFINER
-- La funzione bypassa RLS sull'INSERT perché i controlli
-- (ruolo manager, ownership org, limite strutture) sono già dentro.

create or replace function public.create_structure(
  p_name     text,
  p_address  text default null,
  p_type     text default null,
  p_capacity int  default null
)
returns bigint language plpgsql
security definer                  -- ← fix: bypassa RLS sull'INSERT
set search_path = public
as $$
declare
  v_org_id bigint;
  v_max    int;
  v_count  int;
  v_new_id bigint;
begin
  -- Verifica che chi chiama sia un manager
  if (select role from public.profiles where id = auth.uid()) != 'manager' then
    raise exception 'Accesso negato: solo i manager possono creare strutture.';
  end if;

  select organization_id into v_org_id
    from public.profiles where id = auth.uid();

  if v_org_id is null then
    raise exception 'Nessuna organizzazione associata a questo account.';
  end if;

  select max_structures into v_max
    from public.organizations where id = v_org_id;

  select count(*) into v_count
    from public.structures where organization_id = v_org_id;

  if v_count >= v_max then
    raise exception 'Limite strutture raggiunto. Contatta l''assistenza per l''upgrade.';
  end if;

  insert into public.structures (name, address, type, capacity, organization_id)
    values (
      trim(p_name),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_type,    '')), ''),
      p_capacity,
      v_org_id
    )
    returning id into v_new_id;

  return v_new_id;
end;
$$;
