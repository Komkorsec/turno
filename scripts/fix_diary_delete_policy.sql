-- ════════════════════════════════════════════════════════════════════
--  Fix: policy DELETE diari per manager
--
--  Problema: la policy precedente faceva JOIN su profiles.structure_id
--  che è NULL per i manager → DELETE silenziosa senza effetto.
--
--  Fix: usa my_organization_id() (SECURITY DEFINER) che legge
--  direttamente profiles.organization_id, funziona anche con structure_id NULL.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "manager can delete diaries in own structure" on public.diaries;

create policy "manager can delete diaries in own structure"
  on public.diaries
  for delete
  using (
    public.my_organization_id() is not null
    and exists (
      select 1 from public.structures s
      where s.id = diaries.structure_id
        and s.organization_id = public.my_organization_id()
    )
  );
