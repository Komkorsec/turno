-- ════════════════════════════════════════════════════════════════════
--  Scadenze — aggiunge data_scadenza a documenti e pratiche legali
--  + RPC get_expiring_items
--  Eseguire DOPO: resident_documents.sql, resident_legal_records.sql,
--                 resident_identity_docs.sql
-- ════════════════════════════════════════════════════════════════════

-- ─── Nuove colonne ────────────────────────────────────────────────────────────

alter table public.resident_documents
  add column if not exists data_scadenza date;

alter table public.resident_legal_records
  add column if not exists data_scadenza date;

-- ─── RPC: scadenze imminenti ──────────────────────────────────────────────────
-- Restituisce tutti gli item con scadenza <= oggi + p_days_ahead
-- (inclusi gli già scaduti con days_remaining negativo)
-- per i residenti attivi (is_archived = false) della struttura.

create or replace function public.get_expiring_items(
  p_structure_id bigint,
  p_days_ahead   int default 30
)
returns table (
  resident_id      bigint,
  resident_nome    text,
  resident_cognome text,
  tipo_item        text,
  label_item       text,
  data_scadenza    date,
  days_remaining   int,
  source           text   -- 'document' | 'legal_record' | 'identity_doc'
)
language sql
security invoker
stable
as $$

  -- Documenti generali (senza pratica legale) con scadenza
  select
    r.id                                          as resident_id,
    r.nome                                        as resident_nome,
    r.cognome                                     as resident_cognome,
    rd.categoria                                  as tipo_item,
    coalesce(rd.original_name, rd.categoria)      as label_item,
    rd.data_scadenza,
    (rd.data_scadenza - current_date)::int        as days_remaining,
    'document'::text                              as source
  from public.resident_documents rd
  join public.residents r on r.id = rd.resident_id
  where r.structure_id      = p_structure_id
    and r.is_archived       = false
    and rd.legal_record_id  is null
    and rd.data_scadenza    is not null
    and rd.data_scadenza    <= current_date + p_days_ahead

  union all

  -- Pratiche legali con scadenza
  select
    r.id,
    r.nome,
    r.cognome,
    lr.tipo_pratica,
    lr.tipo_pratica,
    lr.data_scadenza,
    (lr.data_scadenza - current_date)::int,
    'legal_record'::text
  from public.resident_legal_records lr
  join public.residents r on r.id = lr.resident_id
  where r.structure_id   = p_structure_id
    and r.is_archived    = false
    and lr.data_scadenza is not null
    and lr.data_scadenza <= current_date + p_days_ahead

  union all

  -- Documenti identità — solo il più recente per tipo (DISTINCT ON)
  select
    sub.resident_id,
    sub.nome,
    sub.cognome,
    sub.tipo,
    sub.tipo,
    sub.data_scadenza,
    (sub.data_scadenza - current_date)::int,
    'identity_doc'::text
  from (
    select distinct on (id.resident_id, id.tipo)
      id.resident_id,
      r.nome,
      r.cognome,
      id.tipo,
      id.data_scadenza
    from public.resident_identity_docs id
    join public.residents r on r.id = id.resident_id
    where r.structure_id   = p_structure_id
      and r.is_archived    = false
      and id.data_scadenza is not null
      and id.data_scadenza <= current_date + p_days_ahead
    order by id.resident_id, id.tipo, id.created_at desc
  ) sub

  order by data_scadenza asc

$$;
