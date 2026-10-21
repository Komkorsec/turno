-- ════════════════════════════════════════════════════════════════════
--  Agenda Appuntamenti Residenti
--  1. Tabella resident_appointments
--  2. RLS
--  3. Trigger: nuovo appuntamento → notifica tutti gli operatori
--  4. RPC: check_appointment_reminders() → promemoria per domani
--
--  Da eseguire DOPO add_notifications.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Tabella ───────────────────────────────────────────────────────────────

create table if not exists public.resident_appointments (
  id                   bigint generated always as identity primary key,
  resident_id          bigint not null references public.residents(id) on delete cascade,
  title                text   not null,
  description          text,
  start_datetime       timestamptz not null,
  end_datetime         timestamptz,
  location             text,
  assigned_operator_id uuid references public.profiles(id) on delete set null,
  status               text not null default 'scheduled'
                         check (status in ('scheduled', 'completed', 'cancelled')),
  outcome_note         text,
  created_at           timestamptz not null default now()
);

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────

alter table public.resident_appointments enable row level security;

create policy "Structure members can read appointments"
  on public.resident_appointments for select
  using (
    exists (
      select 1 from public.residents r
      join public.profiles p on p.structure_id = r.structure_id
      where r.id = resident_appointments.resident_id
        and p.id = auth.uid()
    )
  );

create policy "Structure members can insert appointments"
  on public.resident_appointments for insert
  with check (
    exists (
      select 1 from public.residents r
      join public.profiles p on p.structure_id = r.structure_id
      where r.id = resident_appointments.resident_id
        and p.id = auth.uid()
    )
  );

create policy "Structure members can update appointments"
  on public.resident_appointments for update
  using (
    exists (
      select 1 from public.residents r
      join public.profiles p on p.structure_id = r.structure_id
      where r.id = resident_appointments.resident_id
        and p.id = auth.uid()
    )
  );

-- ─── 3. Trigger: nuovo appuntamento → notifica struttura ─────────────────────

create or replace function public.notify_new_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident_name text;
  v_struct_id     bigint;
  v_date_fmt      text;
  v_member_id     uuid;
begin
  select r.nome || ' ' || r.cognome, r.structure_id
    into v_resident_name, v_struct_id
  from public.residents r
  where r.id = new.resident_id;

  v_date_fmt := to_char(new.start_datetime at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI');

  for v_member_id in
    select id from public.profiles
    where structure_id = v_struct_id
      and role in ('operator', 'admin_secondary', 'manager')
  loop
    insert into public.notifications(user_id, title, message, type, link)
    values (
      v_member_id,
      'Appuntamento — ' || coalesce(v_resident_name, 'Residente'),
      new.title || ' · ' || v_date_fmt ||
        coalesce(' · ' || new.location, ''),
      'appointment',
      'residents'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists on_appointment_created on public.resident_appointments;
create trigger on_appointment_created
  after insert on public.resident_appointments
  for each row execute function public.notify_new_appointment();

-- ─── 4. RPC: promemoria appuntamenti di domani ───────────────────────────────
--
--  Da chiamare ogni sera (es. cron Supabase pg_cron o edge function schedulata)
--  Inserisce una notifica per ogni appuntamento scheduled del giorno seguente,
--  evitando duplicati grazie al tag [id:N] nel messaggio.

create or replace function public.check_appointment_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec           record;
  v_resident_name text;
  v_struct_id     bigint;
  v_time_fmt      text;
  v_member_id     uuid;
  v_tag           text;
begin
  for v_rec in
    select a.*
    from public.resident_appointments a
    where a.status = 'scheduled'
      and a.start_datetime >= (current_date + interval '1 day')
      and a.start_datetime <  (current_date + interval '2 days')
  loop
    v_tag := '[appt:' || v_rec.id::text || ']';

    -- Salta se già inviato oggi
    if exists (
      select 1 from public.notifications
      where type = 'appointment_reminder'
        and message like '%' || v_tag || '%'
        and created_at >= current_date
    ) then
      continue;
    end if;

    select r.nome || ' ' || r.cognome, r.structure_id
      into v_resident_name, v_struct_id
    from public.residents r
    where r.id = v_rec.resident_id;

    v_time_fmt := to_char(v_rec.start_datetime at time zone 'Europe/Rome', 'HH24:MI');

    for v_member_id in
      select id from public.profiles
      where structure_id = v_struct_id
        and role in ('operator', 'admin_secondary', 'manager')
    loop
      insert into public.notifications(user_id, title, message, type, link)
      values (
        v_member_id,
        '⏰ Domani — ' || coalesce(v_resident_name, 'Residente'),
        v_rec.title || ' ore ' || v_time_fmt ||
          coalesce(' · ' || v_rec.location, '') || ' ' || v_tag,
        'appointment_reminder',
        'residents'
      );
    end loop;
  end loop;
end;
$$;
