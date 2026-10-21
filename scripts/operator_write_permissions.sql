-- ════════════════════════════════════════════════════════════════════
--  Permessi scrittura operatore: farmaci, appuntamenti, documenti
--  1. Aggiunge created_by a resident_medications e resident_appointments
--  2. Aggiorna can_manage_resident_data() per includere 'operator'
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Colonne created_by ─────────────────────────────────────────────────────

ALTER TABLE public.resident_medications
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.resident_appointments
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ─── 2. Aggiorna helper: include operatori stessa struttura ───────────────────
--  La funzione controlla che l'utente sia nella STESSA struttura del residente
--  e che abbia un ruolo autorizzato (ora include 'operator').

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
      AND  (
        r.structure_id = p.structure_id
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
      AND  p.role IN ('manager', 'admin_secondary', 'operator')
  )
$$;

-- ─── 3. Backfill: aggiorna is_same_structure_as_resident per coerenza ─────────
--  (già ridefinita in coordinator_permissions.sql, ma la riallineiamo)

CREATE OR REPLACE FUNCTION public.is_same_structure_as_resident(p_resident_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = p_resident_id
      AND (
        r.structure_id = (SELECT structure_id FROM public.profiles WHERE id = auth.uid())
        OR r.structure_id = ANY(public.my_extra_structure_ids())
      )
  )
$$;
