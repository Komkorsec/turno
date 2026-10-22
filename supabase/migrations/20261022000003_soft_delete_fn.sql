CREATE OR REPLACE FUNCTION public.soft_delete_org_document(doc_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id bigint;
  v_role   text;
BEGIN
  SELECT organization_id, role INTO v_org_id, v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role NOT IN ('manager', 'admin_secondary') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.org_documents
  SET deleted_at = now()
  WHERE id = doc_id
    AND organization_id = v_org_id
    AND deleted_at IS NULL;
END;
$$;
