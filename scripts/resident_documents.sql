-- ════════════════════════════════════════════════════════════════════
--  Documenti residenti — tabella metadati + Storage bucket + RLS
--
--  STEP 1: esegui questo script nel SQL editor di Supabase
--  STEP 2: crea il bucket dal dashboard
--          Storage → New bucket → Name: "resident-documents" → Private
--  STEP 3: esegui le policy di storage in fondo a questo file
-- ════════════════════════════════════════════════════════════════════

-- ─── Tabella metadati ────────────────────────────────────────────────────────

create table public.resident_documents (
  id            bigserial primary key,
  resident_id   bigint      not null references public.residents(id) on delete cascade,
  storage_path  text        not null unique,
  original_name text        not null,
  categoria     text        not null default 'Altro',
  file_size     bigint,
  uploaded_by   uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index resident_documents_resident_id on public.resident_documents(resident_id);

-- ─── RLS su tabella metadati ─────────────────────────────────────────────────

alter table public.resident_documents enable row level security;

-- Lettura: operatori struttura + manager org
create policy "resident_documents_select" on public.resident_documents
  for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = resident_documents.resident_id
        and (
          r.structure_id = public.my_structure_id()
          or public.my_org_owns_structure(r.structure_id)
        )
    )
  );

-- Inserimento: solo manager
create policy "resident_documents_insert" on public.resident_documents
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_documents.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- Eliminazione: solo manager
create policy "resident_documents_delete" on public.resident_documents
  for delete to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_documents.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- ─── Storage bucket ───────────────────────────────────────────────────────────
-- Crea il bucket via dashboard OPPURE con questa query:

insert into storage.buckets (id, name, public, file_size_limit)
values ('resident-documents', 'resident-documents', false, 10485760)  -- 10 MB limit
on conflict (id) do nothing;

-- ─── Storage RLS policies ─────────────────────────────────────────────────────
-- Path convention: {structure_id}/{resident_id}/{uuid}.{ext}
-- split_part(name, '/', 1) = structure_id  →  usato per il controllo org

-- SELECT: operatori della struttura + manager dell'org
create policy "resident_docs_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'resident-documents'
    and (
      split_part(name, '/', 1)::bigint = public.my_structure_id()
      or public.my_org_owns_structure(split_part(name, '/', 1)::bigint)
    )
  );

-- INSERT: solo manager
create policy "resident_docs_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resident-documents'
    and (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(split_part(name, '/', 1)::bigint)
  );

-- UPDATE: disabilitato (i file non si modificano, si cancellano e ricaricano)
-- DELETE: solo manager
create policy "resident_docs_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'resident-documents'
    and (select role from public.profiles where id = auth.uid()) = 'manager'
    and public.my_org_owns_structure(split_part(name, '/', 1)::bigint)
  );
