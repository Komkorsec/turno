-- ════════════════════════════════════════════════════════
--  Manager Invites: i manager generano codici per il loro team
-- ════════════════════════════════════════════════════════

-- 1. Aggiungi created_by (nullable: dati esistenti non vengono toccati)
alter table public.invitation_codes
  add column if not exists created_by uuid references auth.users(id);

-- 2. Abilita RLS se non già attivo
alter table public.invitation_codes enable row level security;

-- 3. SELECT anonimo: necessario per la validazione del codice durante la registrazione
drop policy if exists "invitation_codes_anon_select" on public.invitation_codes;
create policy "invitation_codes_anon_select" on public.invitation_codes
  for select to anon
  using (is_used = false);

-- 4. SELECT autenticato: manager vede i codici della propria struttura, admin vede tutto
drop policy if exists "invitation_codes_manager_read" on public.invitation_codes;
create policy "invitation_codes_manager_read" on public.invitation_codes
  for select to authenticated
  using (
    structure_id = (select structure_id from public.profiles where id = auth.uid())
    or (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );

-- 5. INSERT manager: può creare codici solo per la propria struttura
--    (la policy admin_insert esistente rimane invariata e si sommano con OR)
drop policy if exists "invitation_codes_manager_insert" on public.invitation_codes;
create policy "invitation_codes_manager_insert" on public.invitation_codes
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'manager'
    and structure_id = (select structure_id from public.profiles where id = auth.uid())
    and created_by = auth.uid()
    and role in ('operator', 'admin_secondary')
  );
