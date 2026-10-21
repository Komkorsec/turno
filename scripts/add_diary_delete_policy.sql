-- ════════════════════════════════════════════════════════════════════
--  Policy RLS: eliminazione diari da parte del manager
--  Il manager può eliminare i diari della propria struttura.
--  Esegui una volta nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- Abilita RLS sulla tabella diaries (no-op se già abilitato)
alter table public.diaries enable row level security;

-- Elimina policy esistente con lo stesso nome (idempotente)
drop policy if exists "manager can delete diaries in own structure" on public.diaries;

-- Policy DELETE: il manager può eliminare i diari
-- delle strutture della sua organizzazione
create policy "manager can delete diaries in own structure"
  on public.diaries
  for delete
  using (
    exists (
      select 1
        from public.profiles p
        join public.structures s on s.id = p.structure_id
       where p.id     = auth.uid()
         and p.role   = 'manager'
         and s.organization_id = (
               select s2.organization_id
                 from public.structures s2
                where s2.id = diaries.structure_id
             )
    )
  );
