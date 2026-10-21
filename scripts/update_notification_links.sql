-- ════════════════════════════════════════════════════════════════════
--  Aggiorna i link delle notifiche per includere l'ID della risorsa
--  Formato nuovo: 'view:structureId:resourceId'
--  Esempio: 'diaries:5:abc-123'
--
--  Da eseguire dopo add_notifications.sql e add_operator_notifications.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. notify_new_diary ──────────────────────────────────────────────────────
-- link: 'diaries:structureId:diaryId'

create or replace function public.notify_new_diary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_struct_name  text;
  v_op_name      text;
  v_manager_id   uuid;
begin
  select name      into v_struct_name from public.structures  where id = NEW.structure_id;
  select full_name into v_op_name     from public.profiles    where id = NEW.operator_id;

  for v_manager_id in
    select get_structure_manager_ids(NEW.structure_id)
  loop
    if v_manager_id <> NEW.operator_id then
      insert into public.notifications(user_id, title, message, type, link)
      values (
        v_manager_id,
        coalesce(v_struct_name, 'Struttura') || ' — Nuovo diario',
        coalesce(v_op_name, 'Un operatore') || ' ha compilato il diario di bordo.',
        'diary',
        'diaries:' || NEW.structure_id || ':' || NEW.id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

-- ─── 2. notify_absence_request ────────────────────────────────────────────────
-- link: 'team:structureId:userId'

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
        'Richiesta ferie in attesa',
        coalesce(v_op_name, 'Un operatore') || ' ha inviato una richiesta di ferie/permesso.',
        'absence',
        'team:' || v_struct_id || ':' || NEW.user_id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

-- ─── 3. notify_new_document ───────────────────────────────────────────────────
-- link: 'residents:structureId:residentId'

create or replace function public.notify_new_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident_name text;
  v_struct_id     bigint;
  v_uploader_name text;
  v_manager_id    uuid;
begin
  select r.nome_cognome, r.structure_id
  into v_resident_name, v_struct_id
  from public.residents r
  where r.id = NEW.resident_id;

  if NEW.uploaded_by is not null then
    select full_name into v_uploader_name
    from public.profiles where id = NEW.uploaded_by;
  end if;

  for v_manager_id in
    select get_structure_manager_ids(v_struct_id)
  loop
    if v_manager_id is distinct from NEW.uploaded_by then
      insert into public.notifications(user_id, title, message, type, link)
      values (
        v_manager_id,
        'Nuovo documento — ' || coalesce(v_resident_name, 'Residente'),
        coalesce(v_uploader_name, 'Un operatore') || ' ha caricato: ' || coalesce(NEW.original_name, NEW.categoria),
        'document',
        'residents:' || v_struct_id || ':' || NEW.resident_id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

-- ─── 4. check_expiring_document_notifications ─────────────────────────────────
-- link: 'residents:structureId:residentId'

create or replace function public.check_expiring_document_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec          record;
  v_manager_id uuid;
  v_days_left  int;
begin
  for rec in
    select
      rd.id,
      rd.original_name,
      rd.categoria,
      rd.data_scadenza,
      r.nome_cognome as resident_name,
      r.id           as resident_id,
      r.structure_id
    from public.resident_documents rd
    join public.residents r on r.id = rd.resident_id
    where rd.data_scadenza is not null
      and rd.data_scadenza <= current_date + interval '30 days'
      and rd.data_scadenza >= current_date
      and r.is_archived = false
  loop
    v_days_left := rec.data_scadenza - current_date;

    for v_manager_id in
      select get_structure_manager_ids(rec.structure_id)
    loop
      -- Non duplicare se già notificato nelle ultime 24h per questo residente + documento
      if not exists (
        select 1 from public.notifications
        where user_id = v_manager_id
          and type = 'expiry'
          and link = 'residents:' || rec.structure_id || ':' || rec.resident_id
          and message like '%' || coalesce(rec.original_name, rec.categoria) || '%'
          and created_at > now() - interval '24 hours'
      ) then
        insert into public.notifications(user_id, title, message, type, link)
        values (
          v_manager_id,
          'Scadenza imminente — ' || coalesce(rec.resident_name, 'Residente'),
          coalesce(rec.original_name, rec.categoria) || ' scade in ' || v_days_left || ' giorn' ||
            case when v_days_left = 1 then 'o' else 'i' end || '.',
          'expiry',
          'residents:' || rec.structure_id || ':' || rec.resident_id
        );
      end if;
    end loop;
  end loop;
end;
$$;

-- ─── 5. notify_urgent_diary ───────────────────────────────────────────────────
-- link: 'diaries:structureId:diaryId'

create or replace function public.notify_urgent_diary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_struct_name text;
  v_op_name     text;
  v_member_id   uuid;
begin
  if not new.is_urgent then return new; end if;

  select name      into v_struct_name from public.structures where id = new.structure_id;
  select full_name into v_op_name     from public.profiles   where id = new.operator_id;

  for v_member_id in
    select id from public.profiles
    where structure_id = new.structure_id
      and id <> new.operator_id
      and role in ('operator', 'admin_secondary', 'manager')
  loop
    insert into public.notifications(user_id, title, message, type, link)
    values (
      v_member_id,
      coalesce(v_struct_name, 'Struttura') || ' — Nota urgente',
      coalesce(v_op_name, 'Un collega') || ' ha segnalato un''urgenza nel diario di bordo.',
      'urgent',
      'diaries:' || new.structure_id || ':' || new.id
    );
  end loop;

  return new;
end;
$$;
