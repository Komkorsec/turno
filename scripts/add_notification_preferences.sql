-- ─── Tabella preferenze notifiche utente ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id       UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  expiry_docs   BOOLEAN NOT NULL DEFAULT true,   -- scadenze documenti (manager)
  new_diaries   BOOLEAN NOT NULL DEFAULT true,   -- nuovi diari di bordo
  new_files     BOOLEAN NOT NULL DEFAULT true,   -- nuovi file / PEI caricati
  absence_reply BOOLEAN NOT NULL DEFAULT true,   -- approvazione/rifiuto ferie (operatore)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own preferences" ON public.notification_preferences;
CREATE POLICY "users manage own preferences"
  ON public.notification_preferences
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
