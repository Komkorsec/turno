-- ════════════════════════════════════════════════════════
--  Team Management: profili dettagliati + note private
-- ════════════════════════════════════════════════════════

-- 1. Aggiungi created_at a profiles e retrocompila da auth.users
alter table public.profiles
  add column if not exists created_at timestamptz;

update public.profiles p
   set created_at = u.created_at
  from auth.users u
 where p.id = u.id;

alter table public.profiles
  alter column created_at set default now();

-- 2. Tabella note private (solo management può leggere/scrivere)
create table if not exists public.user_notes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  notes      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_notes enable row level security;

-- Solo manager e admin_secondary della stessa struttura
drop policy if exists "user_notes_management" on public.user_notes;
create policy "user_notes_management" on public.user_notes
  for all to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
    and (select structure_id from public.profiles where id = user_notes.user_id) = public.my_structure_id()
  )
  with check (
    (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
    and (select structure_id from public.profiles where id = user_notes.user_id) = public.my_structure_id()
  );
