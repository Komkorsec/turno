-- ════════════════════════════════════════════════════════════════════
--  Sistema Notifiche Manager
--  1. Tabella notifications + RLS
--  2. Trigger: nuovo diario → notifica manager
--  3. Trigger: richiesta ferie (pending) → notifica manager
--  4. Trigger: nuovo documento residente → notifica manager
--  5. RPC mark_all_notifications_read
--  6. RPC check_expiring_document_notifications (chiama dal client)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Tabella ──────────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  title      text        not null,
  message    text,
  type       text        not null default 'info',
  is_read    boolean     not null default false,
  link       text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created
  on public.notifications(user_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.notifications enable row level security;

create policy "notif_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notif_update_own"
  on public.notifications for update
  using (user_id = auth.uid());

-- ─── Helper: trova i manager di una struttura ─────────────────────────────────

create or replace function public.get_structure_manager_ids(p_structure_id bigint)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select p.id
  from public.profiles p
  join public.structures s on s.organization_id = p.organization_id
  where s.id = p_structure_id
    and p.role = 'manager';
$$;

-- ─── 2. Trigger: nuovo diario ─────────────────────────────────────────────────

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
        'diaries:' || NEW.structure_id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists on_diary_created on public.diaries;
create trigger on_diary_created
  after insert on public.diaries
  for each row execute function public.notify_new_diary();

-- ─── 3. Trigger: richiesta ferie pending ─────────────────────────────────────

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
        'team:' || v_struct_id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists on_absence_requested on public.absences;
create trigger on_absence_requested
  after insert on public.absences
  for each row execute function public.notify_absence_request();

-- ─── 4. Trigger: nuovo documento residente ────────────────────────────────────

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
        'residents:' || v_struct_id
      );
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists on_document_uploaded on public.resident_documents;
create trigger on_document_uploaded
  after insert on public.resident_documents
  for each row execute function public.notify_new_document();

-- ─── 5. RPC: segna tutte come lette ──────────────────────────────────────────

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set is_read = true
  where user_id = auth.uid() and is_read = false;
$$;

-- ─── 6. RPC: notifiche scadenze documenti (chiama dal client all'avvio) ───────
-- Crea notifiche per documenti con scadenza entro 30 giorni.
-- Non duplica: salta se c'è già una notifica 'expiry' per lo stesso documento
-- creata nelle ultime 24 ore.

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
  -- Documenti resident_documents in scadenza
  for rec in
    select
      rd.id,
      rd.original_name,
      rd.categoria,
      rd.data_scadenza,
      r.nome_cognome as resident_name,
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
      -- Non duplicare se già notificato nelle ultime 24h per questo documento
      if not exists (
        select 1 from public.notifications
        where user_id = v_manager_id
          and type = 'expiry'
          and link = 'residents:' || rec.structure_id
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
          'residents:' || rec.structure_id
        );
      end if;
    end loop;
  end loop;
end;
$$;
