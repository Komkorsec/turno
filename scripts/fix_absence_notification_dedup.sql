-- ════════════════════════════════════════════════════════════════════
--  Fix: notifica unica per gruppo di richieste ferie
--
--  Problema: trigger FOR EACH ROW → N slot = N notifiche per il manager
--  Soluzione:
--    1. Trigger modificato: salta le righe con request_group_id (gestite dall'RPC)
--    2. Nuovo RPC notify_absence_group(p_group_id) chiamato dal frontend
--       dopo l'insert → crea UNA sola notifica con riepilogo
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Aggiorna trigger: skip se fa parte di un gruppo ──────────────────────

create or replace function public.notify_absence_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op_name    text;
  v_manager_id uuid;
  v_struct_id  bigint;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  -- Se ha un request_group_id, la notifica è gestita dall'RPC notify_absence_group()
  -- chiamato dal frontend dopo che tutti gli slot sono stati inseriti
  if NEW.request_group_id is not null then
    return NEW;
  end if;

  -- Legacy: righe senza group_id (retrocompatibilità)
  select full_name, structure_id
  into v_op_name, v_struct_id
  from public.profiles
  where id = NEW.user_id;

  for v_manager_id in
    select get_structure_manager_ids(v_struct_id)
  loop
    if v_manager_id <> NEW.user_id then
      insert into public.notifications(user_id, title, message, type, link)
      values (
        v_manager_id,
        'Richiesta ferie — ' || coalesce(v_op_name, 'Operatore'),
        coalesce(v_op_name, 'Un operatore') || ' ha inviato una richiesta di ferie/permesso.',
        'absence',
        'team:' || v_struct_id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

-- ─── 2. Nuovo RPC: crea notifica unica per il gruppo ─────────────────────────

create or replace function public.notify_absence_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_op_name    text;
  v_struct_id  bigint;
  v_manager_id uuid;
  v_slot_count int;
  v_first_date date;
  v_last_date  date;
  v_is_range   boolean;
  v_msg        text;
  v_title      text;
begin
  -- Recupera info aggregate del gruppo
  select
    a.user_id,
    p.full_name,
    p.structure_id,
    count(*)::int,
    min(a.start_date)::date,
    max(a.end_date)::date,
    bool_and(a.is_full_day)
  into v_user_id, v_op_name, v_struct_id, v_slot_count, v_first_date, v_last_date, v_is_range
  from public.absences a
  join public.profiles p on p.id = a.user_id
  where a.request_group_id = p_group_id
  group by a.user_id, p.full_name, p.structure_id
  limit 1;

  if v_user_id is null then return; end if;

  v_title := 'Richiesta ferie — ' || coalesce(v_op_name, 'Operatore');

  -- Messaggio descrittivo
  if v_slot_count = 1 and v_is_range and v_last_date > v_first_date then
    -- Periodo multi-giorno (range)
    v_msg := coalesce(v_op_name, 'Un operatore') || ' ha richiesto ferie dal ' ||
             to_char(v_first_date, 'DD/MM') || ' al ' ||
             to_char(v_last_date, 'DD/MM/YYYY') || '.';
  elsif v_slot_count = 1 then
    -- Singolo giorno o slot
    v_msg := coalesce(v_op_name, 'Un operatore') || ' ha richiesto un''assenza per il ' ||
             to_char(v_first_date, 'DD/MM/YYYY') || '.';
  else
    -- Più slot singoli
    v_msg := coalesce(v_op_name, 'Un operatore') || ' ha inviato ' || v_slot_count ||
             ' richieste di ferie/permesso.';
  end if;

  -- Notifica tutti i manager della struttura
  for v_manager_id in
    select get_structure_manager_ids(v_struct_id)
  loop
    if v_manager_id <> v_user_id then
      insert into public.notifications(user_id, title, message, type, link)
      values (
        v_manager_id,
        v_title,
        v_msg,
        'absence',
        'team:' || v_struct_id
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.notify_absence_group(uuid) to authenticated;
