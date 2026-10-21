-- ════════════════════════════════════════════════════════════════════
--  Fix: trigger notify_new_document usa r.nome_cognome che non esiste
--
--  Problema: la tabella residents ha colonne separate nome e cognome,
--  non nome_cognome. Il trigger on_document_uploaded fallisce ogni volta
--  che viene inserito un documento → INSERT torna 400.
--
--  Fix: sostituisce nome_cognome con nome || ' ' || cognome nei due
--  posti in cui viene usato.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── notify_new_document (trigger after INSERT on resident_documents) ──────────

CREATE OR REPLACE FUNCTION public.notify_new_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resident_name text;
  v_struct_id     bigint;
  v_uploader_name text;
  v_manager_id    uuid;
BEGIN
  SELECT r.nome || ' ' || r.cognome, r.structure_id
  INTO   v_resident_name, v_struct_id
  FROM   public.residents r
  WHERE  r.id = NEW.resident_id;

  IF NEW.uploaded_by IS NOT NULL THEN
    SELECT full_name INTO v_uploader_name
    FROM   public.profiles WHERE id = NEW.uploaded_by;
  END IF;

  -- Notifica manager
  FOR v_manager_id IN
    SELECT get_structure_manager_ids(v_struct_id)
  LOOP
    IF v_manager_id IS DISTINCT FROM NEW.uploaded_by THEN
      INSERT INTO public.notifications(user_id, title, message, type, link)
      VALUES (
        v_manager_id,
        'Nuovo documento — ' || coalesce(v_resident_name, 'Residente'),
        coalesce(v_uploader_name, 'Un operatore') || ' ha caricato: '
          || coalesce(NEW.original_name, NEW.categoria),
        'document',
        'residents:' || v_struct_id
      );
    END IF;
  END LOOP;

  -- Notifica coordinatori (admin_secondary) assegnati alla struttura
  FOR v_manager_id IN
    SELECT us.user_id
    FROM   public.user_structures us
    JOIN   public.profiles p ON p.id = us.user_id
    WHERE  us.structure_id = v_struct_id
      AND  us.is_active    = true
      AND  p.role          = 'admin_secondary'
  LOOP
    IF v_manager_id IS DISTINCT FROM NEW.uploaded_by THEN
      INSERT INTO public.notifications(user_id, title, message, type, link)
      VALUES (
        v_manager_id,
        'Nuovo documento — ' || coalesce(v_resident_name, 'Residente'),
        coalesce(v_uploader_name, 'Un operatore') || ' ha caricato: '
          || coalesce(NEW.original_name, NEW.categoria),
        'document',
        'residents:' || v_struct_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ─── check_expiring_document_notifications (chiamata dal client) ───────────────

CREATE OR REPLACE FUNCTION public.check_expiring_document_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec          record;
  v_manager_id uuid;
  v_days_left  int;
BEGIN
  FOR rec IN
    SELECT
      rd.id,
      rd.original_name,
      rd.categoria,
      rd.data_scadenza,
      r.nome || ' ' || r.cognome AS resident_name,
      r.structure_id
    FROM   public.resident_documents rd
    JOIN   public.residents r ON r.id = rd.resident_id
    WHERE  rd.data_scadenza IS NOT NULL
      AND  rd.data_scadenza <= current_date + interval '30 days'
      AND  rd.data_scadenza >= current_date
      AND  r.is_archived = false
  LOOP
    v_days_left := rec.data_scadenza - current_date;

    FOR v_manager_id IN
      SELECT get_structure_manager_ids(rec.structure_id)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE  user_id = v_manager_id
          AND  type    = 'expiry'
          AND  link    = 'residents:' || rec.structure_id
          AND  message LIKE '%' || coalesce(rec.original_name, rec.categoria) || '%'
          AND  created_at > now() - interval '24 hours'
      ) THEN
        INSERT INTO public.notifications(user_id, title, message, type, link)
        VALUES (
          v_manager_id,
          'Scadenza imminente — ' || coalesce(rec.resident_name, 'Residente'),
          coalesce(rec.original_name, rec.categoria) || ' scade in ' || v_days_left
            || ' giorn' || CASE WHEN v_days_left = 1 THEN 'o' ELSE 'i' END || '.',
          'expiry',
          'residents:' || rec.structure_id
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
