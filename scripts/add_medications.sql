-- ════════════════════════════════════════════════════════════════════
--  Gestione Farmacologica
--  1. Tabella resident_medications
--  2. Tabella medication_logs
--  3. RLS
--  4. RPC check_missed_medications() → alert manager se farmaco non
--     somministrato entro 60 min dalla scadenza
--
--  Richiede: ADD NOTIFICATIONS eseguito in precedenza.
--
--  Storage: creare bucket "prescriptions" (public: false)
--  in Supabase > Storage > New bucket.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. resident_medications ─────────────────────────────────────────────────

create table if not exists public.resident_medications (
  id               bigint generated always as identity primary key,
  resident_id      bigint not null references public.residents(id) on delete cascade,
  name             text   not null,
  dosage           text,
  frequency        text[] not null default '{}',
  instructions     text,
  prescription_url text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ─── 2. medication_logs ──────────────────────────────────────────────────────

create table if not exists public.medication_logs (
  id              bigint generated always as identity primary key,
  medication_id   bigint not null references public.resident_medications(id) on delete cascade,
  operator_id     uuid   not null references public.profiles(id),
  resident_id     bigint not null references public.residents(id) on delete cascade,
  administered_at timestamptz not null default now(),
  status          text not null check (status in ('given', 'refused')),
  notes           text,
  created_at      timestamptz not null default now()
);

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.resident_medications enable row level security;
alter table public.medication_logs      enable row level security;

-- Helper per verificare appartenenza alla struttura del residente
create or replace function public.is_same_structure_as_resident(p_resident_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.residents r
    join public.profiles p on p.structure_id = r.structure_id
    where r.id = p_resident_id and p.id = auth.uid()
  )
$$;

create policy "members_select_medications"
  on public.resident_medications for select
  using ( is_same_structure_as_resident(resident_id) );

create policy "managers_insert_medications"
  on public.resident_medications for insert
  with check (
    exists (
      select 1 from public.residents r
      join public.profiles p on p.structure_id = r.structure_id
      where r.id = resident_medications.resident_id
        and p.id = auth.uid()
        and p.role in ('manager', 'admin_secondary')
    )
  );

create policy "managers_update_medications"
  on public.resident_medications for update
  using (
    exists (
      select 1 from public.residents r
      join public.profiles p on p.structure_id = r.structure_id
      where r.id = resident_medications.resident_id
        and p.id = auth.uid()
        and p.role in ('manager', 'admin_secondary')
    )
  );

create policy "members_select_logs"
  on public.medication_logs for select
  using ( is_same_structure_as_resident(resident_id) );

create policy "members_insert_logs"
  on public.medication_logs for insert
  with check ( is_same_structure_as_resident(resident_id) );

-- ─── 4. RPC: alert farmaci non somministrati ──────────────────────────────────
--
--  Chiama questa funzione ogni ora con pg_cron:
--  select cron.schedule('check-missed-meds', '5 * * * *',
--    'select check_missed_medications()');

create or replace function public.check_missed_medications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_med      record;
  v_slot     text;
  v_sch_min  int;
  v_now_min  int;
  v_diff     int;
  v_tag      text;
  v_mgr_id   uuid;
begin
  v_now_min := extract(hour   from now() at time zone 'Europe/Rome')::int * 60 +
               extract(minute from now() at time zone 'Europe/Rome')::int;

  for v_med in
    select m.id, m.name, m.dosage, m.frequency,
           r.nome || ' ' || r.cognome as resident_name,
           r.structure_id
    from   public.resident_medications m
    join   public.residents            r on r.id = m.resident_id
    where  m.is_active = true
      and  not r.is_archived
  loop
    foreach v_slot in array v_med.frequency
    loop
      v_sch_min := split_part(v_slot, ':', 1)::int * 60 +
                   split_part(v_slot, ':', 2)::int;
      v_diff    := v_now_min - v_sch_min;

      -- Finestra: tra 60 e 120 minuti dopo l'orario programmato
      if v_diff < 60 or v_diff > 120 then continue; end if;

      -- Controlla se già somministrato oggi nella fascia oraria
      if exists (
        select 1 from public.medication_logs
        where  medication_id = v_med.id
          and  administered_at::date = current_date
          and  abs(
                 extract(hour   from administered_at at time zone 'Europe/Rome')::int * 60 +
                 extract(minute from administered_at at time zone 'Europe/Rome')::int
                 - v_sch_min
               ) <= 60
      ) then continue; end if;

      -- Antiduplicato per oggi
      v_tag := '[med:' || v_med.id::text || ':' || v_slot || ':' || current_date::text || ']';
      if exists (
        select 1 from public.notifications
        where  type = 'medication_alert'
          and  message like '%' || v_tag || '%'
          and  created_at >= current_date
      ) then continue; end if;

      -- Notifica i manager della struttura
      for v_mgr_id in
        select id from public.profiles
        where  structure_id = v_med.structure_id
          and  role in ('manager', 'admin_secondary')
      loop
        insert into public.notifications(user_id, title, message, type, link)
        values (
          v_mgr_id,
          '⚠ Farmaco non somministrato — ' || v_med.resident_name,
          v_med.name || coalesce(' ' || v_med.dosage, '') ||
            ' (ore ' || v_slot || ') non risulta registrato. ' || v_tag,
          'medication_alert',
          'residents'
        );
      end loop;

    end loop;
  end loop;
end;
$$;
