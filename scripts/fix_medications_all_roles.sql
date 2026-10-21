-- ════════════════════════════════════════════════════════════════════
--  Fix: farmaci accessibili a operator, admin_secondary e manager
--
--  Problema: can_manage_resident_data escludeva operator;
--  is_same_structure_as_resident non copriva strutture extra.
--  Entrambe le funzioni vengono aggiornate in-place, le policy
--  INSERT/UPDATE/SELECT usano già queste funzioni → nessuna
--  modifica alle policy stesse.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── Helper: accesso lettura (qualunque ruolo, struttura primaria o extra) ──────

CREATE OR REPLACE FUNCTION public.is_same_structure_as_resident(p_resident_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE  r.id = p_resident_id
      AND (
        r.structure_id = public.my_structure_id()
        OR public.my_org_owns_structure(r.structure_id)
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
  )
$$;

-- ─── Helper: accesso scrittura (tutti i ruoli, struttura accessibile) ───────────

CREATE OR REPLACE FUNCTION public.can_manage_resident_data(p_resident_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.residents r
    JOIN   public.profiles  p ON p.id = auth.uid()
    WHERE  r.id = p_resident_id
      AND  p.role IN ('manager', 'admin_secondary', 'operator')
      AND (
        r.structure_id = p.structure_id
        OR public.my_org_owns_structure(r.structure_id)
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
  )
$$;
