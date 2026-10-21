-- ════════════════════════════════════════════════════════════════════
--  Permetti agli operatori di inserire letture in report_views
--  (così il manager vede chi ha consultato la timeline del giorno)
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "report_views_insert_operator" on public.report_views;

create policy "report_views_insert_operator" on public.report_views
  for insert to authenticated
  with check (
    user_id = auth.uid()
    -- Il report deve appartenere alla struttura dell'operatore
    and exists (
      select 1 from public.diaries
       where id    = report_views.report_id
         and structure_id = public.my_structure_id()
    )
  );
