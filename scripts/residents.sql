-- ════════════════════════════════════════════════════════════════════
--  Gestionale Utenti — Residenti e Contatti
-- ════════════════════════════════════════════════════════════════════

-- ─── Tabella residenti ───────────────────────────────────────────────────────

create table public.residents (
  id            bigserial primary key,
  structure_id  bigint      not null references public.structures(id) on delete cascade,
  nome          text        not null check (char_length(nome) >= 1),
  cognome       text        not null check (char_length(cognome) >= 1),
  data_nascita  date,
  nazionalita   text,
  data_arrivo   date        not null default current_date,
  data_partenza date,
  foto_url      text,
  is_archived   boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index residents_structure_id on public.residents(structure_id);
create index residents_archived      on public.residents(is_archived);

-- trigger updated_at (riutilizza la funzione se già esiste, altrimenti la crea)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger residents_updated_at
  before update on public.residents
  for each row execute function public.touch_updated_at();

-- ─── Tabella contatti ────────────────────────────────────────────────────────

create table public.resident_contacts (
  id          bigserial primary key,
  resident_id bigint      not null references public.residents(id) on delete cascade,
  tipo        text        not null default 'Altro',
  nome        text        not null check (char_length(nome) >= 1),
  telefono    text,
  note        text,
  created_at  timestamptz not null default now()
);

create index resident_contacts_resident_id on public.resident_contacts(resident_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.residents         enable row level security;
alter table public.resident_contacts enable row level security;

-- residents — lettura: operatori della struttura + manager/admin_secondary dell'org
create policy "residents_select" on public.residents
  for select to authenticated
  using (
    structure_id = public.my_structure_id()
    or public.my_org_owns_structure(structure_id)
  );

-- residents — inserimento: solo manager
create policy "residents_insert" on public.residents
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
  );

-- residents — modifica (inclusa archiviazione): solo manager
create policy "residents_update" on public.residents
  for update to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
  )
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
  );

-- residents — cancellazione: solo manager
create policy "residents_delete" on public.residents
  for delete to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(structure_id)
  );

-- resident_contacts — lettura
create policy "resident_contacts_select" on public.resident_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = resident_contacts.resident_id
        and (r.structure_id = public.my_structure_id()
             or public.my_org_owns_structure(r.structure_id))
    )
  );

-- resident_contacts — inserimento: solo manager
create policy "resident_contacts_insert" on public.resident_contacts
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_contacts.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- resident_contacts — modifica: solo manager
create policy "resident_contacts_update" on public.resident_contacts
  for update to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_contacts.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  )
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_contacts.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- resident_contacts — cancellazione: solo manager
create policy "resident_contacts_delete" on public.resident_contacts
  for delete to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_contacts.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );
