-- ════════════════════════════════════════════════════════════════════
--  Fix: quando una struttura viene eliminata, elimina automaticamente
--  tutti gli operatori/admin_secondary associati.
--
--  Il problema: profiles ha un check constraint "operator_needs_structure"
--  che impedisce SET NULL su structure_id per gli operatori.
--  Soluzione: cambiare la FK profiles→structures da SET NULL a CASCADE.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Rimuovi il check constraint che blocca SET NULL ───────────────────────
alter table public.profiles
  drop constraint if exists operator_needs_structure;

-- ─── 2. Ricrea FK profiles→structures con ON DELETE CASCADE ──────────────────
--  (prima rimuovi quella SET NULL aggiunta da hard_delete.sql)
alter table public.profiles
  drop constraint if exists profiles_structure_id_fkey;

alter table public.profiles
  add constraint profiles_structure_id_fkey
    foreign key (structure_id)
    references public.structures(id)
    on delete cascade;

-- ─── 3. Assicura cascade anche sulle altre tabelle ───────────────────────────

alter table public.diaries
  drop constraint if exists diaries_structure_id_fkey;
alter table public.diaries
  add constraint diaries_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

alter table public.invitation_codes
  drop constraint if exists invitation_codes_structure_id_fkey;
alter table public.invitation_codes
  add constraint invitation_codes_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

alter table public.residents
  drop constraint if exists residents_structure_id_fkey;
alter table public.residents
  add constraint residents_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;

alter table public.schedules
  drop constraint if exists schedules_structure_id_fkey;
alter table public.schedules
  add constraint schedules_structure_id_fkey
    foreign key (structure_id) references public.structures(id) on delete cascade;
