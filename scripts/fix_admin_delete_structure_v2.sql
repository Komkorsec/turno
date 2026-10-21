-- ════════════════════════════════════════════════════════════════════
--  Fix: admin_delete_structure v2
--  Elimina esplicitamente tutte le righe figlie prima di cancellare
--  la struttura, evitando errori 409 da FK senza CASCADE.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_structure(p_structure_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() ->> 'email') <> 'umberto.vignati05@gmail.com' then
    raise exception 'Non autorizzato';
  end if;

  -- Task ordinarie
  delete from public.tasks           where structure_id = p_structure_id;

  -- Mansioni settimanali (i log vengono eliminati in cascade da weekly_tasks)
  delete from public.weekly_tasks    where structure_id = p_structure_id;

  -- Strutture extra utenti
  delete from public.user_structures where structure_id = p_structure_id;

  -- Documenti residenti (prima i file storage rimangono ma i metadati vengono rimossi)
  delete from public.resident_documents
    where resident_id in (select id from public.residents where structure_id = p_structure_id);

  -- Residenti
  delete from public.residents       where structure_id = p_structure_id;

  -- Diari
  delete from public.diaries         where structure_id = p_structure_id;

  -- Codici invito
  delete from public.invitation_codes where structure_id = p_structure_id;

  -- Turni / schedule
  delete from public.schedules       where structure_id = p_structure_id;

  -- Profili operatori (scollegali dalla struttura)
  update public.profiles set structure_id = null where structure_id = p_structure_id;

  -- Struttura
  delete from public.structures where id = p_structure_id;
end;
$$;
