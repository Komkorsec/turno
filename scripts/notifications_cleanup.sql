-- ════════════════════════════════════════════════════════════════════
--  Notifiche: pulizia automatica 7 giorni + svuota tutto
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. RPC: elimina notifiche > 7 giorni per l'utente corrente ──────────────

CREATE OR REPLACE FUNCTION public.purge_old_notifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.notifications
   WHERE user_id = auth.uid()
     AND created_at < now() - INTERVAL '7 days';
$$;

-- ─── 2. RPC: segna una singola notifica come letta ──────────────────────────

CREATE OR REPLACE FUNCTION public.mark_notification_read(notif_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications
     SET is_read = true
   WHERE id = notif_id
     AND user_id = auth.uid();
$$;

-- ─── 3. RPC: elimina tutte le notifiche dell'utente corrente ─────────────────

CREATE OR REPLACE FUNCTION public.delete_all_notifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.notifications
   WHERE user_id = auth.uid();
$$;
