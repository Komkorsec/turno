-- ════════════════════════════════════════════════════════════════════
--  Fix: eliminazione definitiva residente
--
--  Problema: la DELETE su residents e la SELECT su resident_documents
--  falliscono silenziosamente per RLS → il residente riappare al reload.
--
--  Fix: RPC SECURITY DEFINER che bypassa RLS, verifica che il chiamante
--  sia manager o coordinatore dell'organizzazione, poi elimina tutto.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.hard_delete_resident(p_resident_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role          text;
  v_structure_id  bigint;
  v_org_id        uuid;
  v_owns          boolean;
  v_paths         text[];
begin
  -- Verifica ruolo chiamante
  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('manager', 'admin_secondary') then
    return jsonb_build_object('error', 'Permesso negato');
  end if;

  -- Verifica che il residente appartenga all'organizzazione del chiamante
  select r.structure_id into v_structure_id
  from public.residents r
  where r.id = p_resident_id;

  if v_structure_id is null then
    return jsonb_build_object('error', 'Residente non trovato');
  end if;

  select organization_id into v_org_id
  from public.structures
  where id = v_structure_id;

  select (organization_id = v_org_id) into v_owns
  from public.profiles
  where id = auth.uid();

  if not v_owns then
    return jsonb_build_object('error', 'Permesso negato');
  end if;

  -- Raccoglie i path dei file da eliminare dallo Storage (li restituiamo al client)
  select array_agg(storage_path)
  into v_paths
  from public.resident_documents
  where resident_id = p_resident_id
    and storage_path is not null;

  -- Elimina il residente (CASCADE elimina documenti, farmaci, appuntamenti, ecc.)
  delete from public.residents where id = p_resident_id;

  return jsonb_build_object(
    'ok', true,
    'storage_paths', coalesce(to_jsonb(v_paths), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.hard_delete_resident(bigint) to authenticated;
