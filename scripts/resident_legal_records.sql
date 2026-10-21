-- ════════════════════════════════════════════════════════════════════
--  Storico Pratiche Legali — tabella + alter resident_documents
-- ════════════════════════════════════════════════════════════════════

-- ─── Tabella pratiche legali ─────────────────────────────────────────────────

create table public.resident_legal_records (
  id            bigserial primary key,
  resident_id   bigint      not null references public.residents(id) on delete cascade,
  tipo_pratica  text        not null,
  data_apertura date        not null default current_date,
  stato         text        not null default 'in_corso'
                check (stato in ('in_corso', 'completata', 'urgente')),
  note          text,
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index resident_legal_records_resident_id on public.resident_legal_records(resident_id);

create trigger resident_legal_records_updated_at
  before update on public.resident_legal_records
  for each row execute function public.touch_updated_at();

-- ─── Collega resident_documents alle pratiche legali ─────────────────────────
-- Nota: eseguire DOPO aver già eseguito resident_documents.sql

alter table public.resident_documents
  add column if not exists legal_record_id bigint
    references public.resident_legal_records(id) on delete set null;

create index if not exists resident_documents_legal_record_id
  on public.resident_documents(legal_record_id);

-- ─── RLS pratiche legali ──────────────────────────────────────────────────────

alter table public.resident_legal_records enable row level security;

-- Lettura: operatori struttura + manager org
create policy "legal_records_select" on public.resident_legal_records
  for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = resident_legal_records.resident_id
        and (
          r.structure_id = public.my_structure_id()
          or public.my_org_owns_structure(r.structure_id)
        )
    )
  );

-- Inserimento: solo manager
create policy "legal_records_insert" on public.resident_legal_records
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_legal_records.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- Modifica: solo manager
create policy "legal_records_update" on public.resident_legal_records
  for update to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_legal_records.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  )
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_legal_records.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- Eliminazione: solo manager
create policy "legal_records_delete" on public.resident_legal_records
  for delete to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_legal_records.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );
