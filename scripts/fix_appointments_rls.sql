-- ════════════════════════════════════════════════════════════════════
--  Fix: appuntamenti — RLS + RPC get_structure_members
--
--  Problema 1: policy INSERT/SELECT/UPDATE su resident_appointments
--  usa join profiles.structure_id che non funziona per manager
--  (structure_id NULL) né per coordinatori su strutture extra.
--
--  Problema 2: non esiste un modo sicuro per recuperare tutti gli
--  operatori di una struttura (primari + via user_structures) senza
--  bypassare la profiles_read RLS.
--
--  Fix:
--    1. Sostituisce le tre policy con versioni che usano
--       my_accessible_resident() (già creata in fix_resident_docs_all_roles.sql)
--    2. Aggiunge RPC get_structure_members() SECURITY DEFINER
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Policy appuntamenti ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Structure members can read appointments"   ON public.resident_appointments;
DROP POLICY IF EXISTS "Structure members can insert appointments" ON public.resident_appointments;
DROP POLICY IF EXISTS "Structure members can update appointments" ON public.resident_appointments;
DROP POLICY IF EXISTS "appointments_select"  ON public.resident_appointments;
DROP POLICY IF EXISTS "appointments_insert"  ON public.resident_appointments;
DROP POLICY IF EXISTS "appointments_update"  ON public.resident_appointments;

CREATE POLICY "appointments_select"
  ON public.resident_appointments FOR SELECT
  USING (public.my_accessible_resident(resident_id));

CREATE POLICY "appointments_insert"
  ON public.resident_appointments FOR INSERT
  WITH CHECK (public.my_accessible_resident(resident_id));

CREATE POLICY "appointments_update"
  ON public.resident_appointments FOR UPDATE
  USING (public.my_accessible_resident(resident_id));

-- ─── 2. RPC: tutti i membri di una struttura ──────────────────────────────────
-- Restituisce id + full_name di tutti gli utenti attivi assegnati
-- alla struttura (sia via profiles.structure_id che via user_structures).
-- Usato dal client per popolare il selettore operatore accompagnatore.

CREATE OR REPLACE FUNCTION public.get_structure_members(p_structure_id bigint)
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  -- Operatori/coordinatori con struttura primaria = p_structure_id
  SELECT p.id, p.full_name
  FROM   public.profiles p
  WHERE  p.structure_id = p_structure_id
    AND  p.role IN ('operator', 'admin_secondary', 'manager')

  UNION

  -- Utenti assegnati via user_structures (es. coordinatori multi-struttura)
  SELECT p.id, p.full_name
  FROM   public.user_structures us
  JOIN   public.profiles p ON p.id = us.user_id
  WHERE  us.structure_id = p_structure_id
    AND  us.is_active    = true
    AND  p.role IN ('operator', 'admin_secondary', 'manager')

  ORDER BY full_name
$$;
