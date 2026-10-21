-- ════════════════════════════════════════════════════════════════════
--  Hard Delete: CASCADE FK + RLS DELETE (solo super admin)
--  Prerequisito: organizations_v2.sql già eseguito
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Ricrea FK con ON DELETE CASCADE ──────────────────────────────────────
--  diaries.structure_id → structures (CASCADE: elimina tutti i diari della struttura)
alter table public.diaries
  drop constraint if exists diaries_structure_id_fkey;
alter table public.diaries
  add constraint diaries_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

--  invitation_codes.structure_id → structures (CASCADE: elimina i codici della struttura)
alter table public.invitation_codes
  drop constraint if exists invitation_codes_structure_id_fkey;
alter table public.invitation_codes
  add constraint invitation_codes_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

--  profiles.structure_id → structures (SET NULL: non cancella gli utenti)
alter table public.profiles
  drop constraint if exists profiles_structure_id_fkey;
alter table public.profiles
  add constraint profiles_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete set null;

--  structures.organization_id → organizations (CASCADE: elimina le strutture dell'org)
alter table public.structures
  drop constraint if exists structures_organization_id_fkey;
alter table public.structures
  add constraint structures_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

-- Nota: report_views e report_history hanno già ON DELETE CASCADE su diaries.id
--       quindi vengono eliminati automaticamente a cascata dai diari.

-- ─── 2. RLS DELETE: solo super admin ─────────────────────────────────────────

-- invitation_codes: hard delete
drop policy if exists "invitation_codes_delete_admin" on public.invitation_codes;
create policy "invitation_codes_delete_admin" on public.invitation_codes
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com');

-- structures: hard delete (a cascata elimina diari, codici, views, history)
drop policy if exists "structures_delete_admin" on public.structures;
create policy "structures_delete_admin" on public.structures
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com');

-- organizations: hard delete
drop policy if exists "organizations_delete_admin" on public.organizations;
create policy "organizations_delete_admin" on public.organizations
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com');
