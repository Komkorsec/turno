-- Auto-eliminazione task completate dopo 30 giorni
-- Richiede l'estensione pg_cron (già disponibile su Supabase)

select cron.schedule(
  'delete-completed-tasks-30d',   -- nome job (univoco)
  '0 3 * * *',                    -- ogni notte alle 03:00 UTC
  $$
    delete from public.tasks
    where status = 'done'
      and completed_at < now() - interval '30 days';
  $$
);
