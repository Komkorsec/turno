-- ════════════════════════════════════════════════════════
--  Report Views: "Visto da" simile a WhatsApp
-- ════════════════════════════════════════════════════════

-- Assicura che my_structure_id() esista (creata in fix_profiles_rls_v2.sql)
create or replace function public.my_structure_id()
returns smallint language sql stable security definer
set search_path = public as $$
  select structure_id from public.profiles where id = auth.uid()
$$;

-- 1. Tabella letture
create table if not exists public.report_views (
  report_id  bigint      not null references public.diaries(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (report_id, user_id)
);

alter table public.report_views enable row level security;

-- 2. SELECT: manager e admin_secondary vedono le letture dei report della propria struttura
drop policy if exists "report_views_select" on public.report_views;
create policy "report_views_select" on public.report_views
  for select to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
    and exists (
      select 1 from public.diaries
       where id = report_views.report_id
         and structure_id = public.my_structure_id()
    )
  );

-- 3. INSERT: manager e admin_secondary possono registrare la propria lettura
drop policy if exists "report_views_insert" on public.report_views;
create policy "report_views_insert" on public.report_views
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (select role from public.profiles where id = auth.uid()) in ('manager', 'admin_secondary')
    and exists (
      select 1 from public.diaries
       where id = report_views.report_id
         and structure_id = public.my_structure_id()
    )
  );
