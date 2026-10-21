-- ════════════════════════════════════════════════════════════════════
--  Documenti d'Identità residenti
--  Eseguire DOPO: residents.sql, resident_documents.sql,
--                 resident_legal_records.sql
-- ════════════════════════════════════════════════════════════════════

create table public.resident_identity_docs (
  id            bigserial primary key,
  resident_id   bigint      not null references public.residents(id) on delete cascade,
  tipo          text        not null,   -- carta_identita | passaporto | permesso_soggiorno | tessera_sanitaria
  data_scadenza date,
  storage_path  text,
  original_name text,
  file_size     bigint,
  note          text,
  uploaded_by   uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Indici
create index resident_identity_docs_resident_id on public.resident_identity_docs(resident_id);
create index resident_identity_docs_tipo        on public.resident_identity_docs(tipo);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.resident_identity_docs enable row level security;

-- Lettura: operatori struttura + manager org
create policy "identity_docs_select" on public.resident_identity_docs
  for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = resident_identity_docs.resident_id
        and (
          r.structure_id = public.my_structure_id()
          or public.my_org_owns_structure(r.structure_id)
        )
    )
  );

-- Inserimento: solo manager
create policy "identity_docs_insert" on public.resident_identity_docs
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_identity_docs.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- Modifica: solo manager (per aggiornare scadenza senza ri-caricare file)
create policy "identity_docs_update" on public.resident_identity_docs
  for update to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_identity_docs.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  )
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_identity_docs.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- Eliminazione: solo manager
create policy "identity_docs_delete" on public.resident_identity_docs
  for delete to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and exists (
      select 1 from public.residents r
      where r.id = resident_identity_docs.resident_id
        and public.my_org_owns_structure(r.structure_id)
    )
  );

-- ─── Storage: i file vanno nel bucket resident-documents ─────────────────────
-- Path: {structure_id}/{resident_id}/identity/{uuid}.{ext}
-- Le policy esistenti su storage.objects coprono già questo percorso
-- perché split_part(name, '/', 1) = structure_id resta valido.
-- Nessuna policy aggiuntiva richiesta.
