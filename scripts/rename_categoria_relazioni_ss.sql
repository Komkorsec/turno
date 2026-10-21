-- ════════════════════════════════════════════════════════════════════
--  Rinomina categoria documenti: 'Relazioni SS' → 'Relazioni Assistente Sociale'
--  I documenti già salvati con il vecchio valore diventerebbero invisibili
--  nei filtri del Percorso Educativo senza questa migrazione.
--  Esegui nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

UPDATE public.resident_documents
   SET categoria = 'Relazioni Assistente Sociale'
 WHERE categoria = 'Relazioni SS';
