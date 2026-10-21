-- ════════════════════════════════════════════════════════════════════
--  Fix: turni esistenti invisibili dopo aggiunta colonna published
--
--  Problema: ALTER TABLE ... ADD COLUMN published DEFAULT false
--  ha impostato false su tutti i turni già presenti.
--  Gli operatori vedono solo published = true → turni precedenti spariti.
--
--  Soluzione:
--  1. Marca come published tutti i turni già presenti
--  2. Aggiorna la RLS: i turni passati (date già trascorse) sono
--     sempre visibili, indipendentemente da published
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Backfill: tutti i turni esistenti erano già stati pubblicati ──────────

UPDATE public.schedules
   SET published = true
 WHERE published = false;

-- ─── 2. Aggiorna RLS: turni passati visibili, bozze future nascoste ───────────
--  Logica:
--  - Manager / admin_secondary: vede tutto (bozze incluse)
--  - Operatore: vede i propri turni SE published = true
--                               OPPURE la data è già passata (retrocompatibilità)

DROP POLICY IF EXISTS "schedules_operator_select" ON public.schedules;
CREATE POLICY "schedules_operator_select" ON public.schedules
  FOR SELECT TO authenticated
  USING (
    (
      structure_id = public.my_structure_id()
      OR structure_id = ANY(public.my_extra_structure_ids())
    )
    AND (
      -- Manager e coordinatori vedono sempre tutto (bozze incluse)
      (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin_secondary')
      -- Operatori: turno pubblicato OPPURE data già passata
      OR published = true
      OR date < current_date
    )
  );
