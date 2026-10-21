-- ════════════════════════════════════════════════════════════════════
--  Turno — Commenti ai report
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Tabella ──────────────────────────────────────────────────────────────

create table if not exists public.diary_comments (
  id         bigserial   primary key,
  diary_id   bigint      not null references public.diaries(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  body       text        not null
                         check (char_length(trim(body)) > 0)
                         check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists diary_comments_diary_id_idx
  on public.diary_comments (diary_id, created_at);

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────

alter table public.diary_comments enable row level security;

drop policy if exists "comments_select" on public.diary_comments;
drop policy if exists "comments_insert" on public.diary_comments;
drop policy if exists "comments_delete" on public.diary_comments;

-- Lettura: chiunque possa vedere il diario (stessa struttura o manager dell'org)
create policy "comments_select" on public.diary_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.diaries d
       where d.id = diary_id
         and (
           d.structure_id = public.my_structure_id()
           or public.my_org_owns_structure(d.structure_id)
         )
    )
  );

-- Inserimento: stessa struttura + deve essere il proprio user_id
create policy "comments_insert" on public.diary_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.diaries d
       where d.id = diary_id
         and (
           d.structure_id = public.my_structure_id()
           or public.my_org_owns_structure(d.structure_id)
         )
    )
  );

-- Cancellazione: solo l'autore del commento
create policy "comments_delete" on public.diary_comments
  for delete to authenticated
  using (user_id = auth.uid());
