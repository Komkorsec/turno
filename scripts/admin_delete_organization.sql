-- ════════════════════════════════════════════════════════════════════
--  RPC admin_delete_organization
--  Elimina un'intera organizzazione con tutte le strutture e dati collegati.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_organization(p_org_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_structure_id bigint;
begin
  if (auth.jwt() ->> 'email') <> 'umberto.vignati05@gmail.com' then
    raise exception 'Non autorizzato';
  end if;

  for v_structure_id in
    select id from public.structures where organization_id = p_org_id
  loop
    -- Task ordinarie
    delete from public.tasks            where structure_id = v_structure_id;

    -- Mansioni settimanali (log eliminati in cascade)
    delete from public.weekly_tasks     where structure_id = v_structure_id;

    -- Strutture extra utenti
    delete from public.user_structures  where structure_id = v_structure_id;

    -- Documenti residenti
    delete from public.resident_documents
      where resident_id in (select id from public.residents where structure_id = v_structure_id);

    -- Residenti
    delete from public.residents        where structure_id = v_structure_id;

    -- Diari
    delete from public.diaries          where structure_id = v_structure_id;

    -- Codici invito
    delete from public.invitation_codes where structure_id = v_structure_id;

    -- Turni
    delete from public.schedules        where structure_id = v_structure_id;

    -- Profili: scollega dalla struttura
    update public.profiles set structure_id = null where structure_id = v_structure_id;

    -- Struttura
    delete from public.structures       where id = v_structure_id;
  end loop;

  -- Profili manager dell'organizzazione: scollega dall'org
  update public.profiles set organization_id = null where organization_id = p_org_id;

  -- Organizzazione
  delete from public.organizations where id = p_org_id;
end;
$$;
