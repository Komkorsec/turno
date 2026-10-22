-- Rimuove duplicati (tiene il record con id più basso per ogni org+nome)
DELETE FROM public.org_document_categories a
USING public.org_document_categories b
WHERE a.id > b.id
  AND a.organization_id = b.organization_id
  AND a.name = b.name;

-- Aggiunge unique constraint per prevenire duplicati futuri
ALTER TABLE public.org_document_categories
  ADD CONSTRAINT org_doc_categories_org_name_unique
  UNIQUE (organization_id, name);
