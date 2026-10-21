-- ════════════════════════════════════════════════════════════════════
--  Notifiche Operatori
--  1. Colonna is_urgent su diaries
--  2. Trigger: ferie approvate/rifiutate → notifica operatore
--  3. Trigger: nuovo turno assegnato → notifica operatore
--  4. Trigger: diario urgente → notifica tutti gli operatori struttura
--  5. Aggiunge tipo 'schedule' e 'urgent' a NOTIF_ICON (solo documentazione)
--
--  Da eseguire DOPO add_notifications.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Colonna is_urgent su diaries ─────────────────────────────────────────

alter table public.diaries
  add column if not exists is_urgent boolean not null default false;

-- ─── 2. Trigger: ferie approvate / rifiutate ─────────────────────────────────

create or replace function public.notify_absence_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_msg   text;
  v_start text;
  v_end   text;
begin
  -- Solo quando lo status cambia verso approved o rejected
  if new.status = old.status then return new; end if;
  if new.status not in ('approved', 'rejected') then return new; end if;

  v_start := to_char(new.start_date::date, 'DD/MM/YYYY');
  v_end   := to_char(new.end_date::date,   'DD/MM/YYYY');

  if new.status = 'approved' then
    v_title := 'Ferie approvate';
    v_msg   := 'La tua richiesta dal ' || v_start || ' al ' || v_end || ' è stata approvata.';
  else
    v_title := 'Ferie rifiutate';
    v_msg   := 'La tua richiesta dal ' || v_start || ' al ' || v_end || ' è stata rifiutata.';
  end if;

  insert into public.notifications(user_id, title, message, type, link)
  values (new.user_id, v_title, v_msg, 'absence_reply', 'ferie');

  return new;
end;
$$;

drop trigger if exists on_absence_status_changed on public.absences;
create trigger on_absence_status_changed
  after update on public.absences
  for each row execute function public.notify_absence_status_change();

-- ─── 3. Trigger: nuovo turno pubblicato ──────────────────────────────────────

create or replace function public.notify_schedule_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date_fmt   text;
  v_shift_lbl  text;
  v_struct_name text;
begin
  -- Notifica solo i turni standard (no tipo 'speciale')
  if new.shift_type = 'speciale' then return new; end if;

  v_date_fmt := to_char(new.date::date, 'DD/MM/YYYY');

  v_shift_lbl := case new.shift_type
    when 'mattina'    then 'Mattina 08–14'
    when 'pomeriggio' then 'Pomeriggio 14–20'
    when 'notte'      then 'Notte 20–08'
    else new.shift_type
  end;

  select name into v_struct_name
  from public.structures where id = new.structure_id;

  insert into public.notifications(user_id, title, message, type, link)
  values (
    new.user_id,
    'Turno confermato — ' || v_date_fmt,
    v_shift_lbl || ' del ' || v_date_fmt ||
      coalesce(' · ' || v_struct_name, '') || ' è stato pubblicato.',
    'schedule',
    'shifts'
  );

  return new;
end;
$$;

drop trigger if exists on_schedule_assigned on public.schedules;
create trigger on_schedule_assigned
  after insert on public.schedules
  for each row execute function public.notify_schedule_assigned();

-- ─── 4. Trigger: diario urgente ──────────────────────────────────────────────

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

  -- Notifica tutti gli operatori della struttura tranne chi l'ha scritto
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
      'diary'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists on_urgent_diary on public.diaries;
create trigger on_urgent_diary
  after insert on public.diaries
  for each row execute function public.notify_urgent_diary();
