-- Migrazione categorie documenti "Percorso Educativo"
-- Le vecchie categorie vengono mappate alle nuove secondo questa logica:
--   PEI                        → Relazioni e PEI
--   Relazioni Assistente Sociale → Relazioni e PEI
--   Relazioni Psicologa          → Relazioni e PEI
--   Storico Medico               → Area sanitaria
--   Altro                        → Varie
--
-- Eseguire una sola volta su Supabase SQL Editor.

update public.resident_documents
set categoria = 'Relazioni e PEI'
where categoria in ('PEI', 'Relazioni Assistente Sociale', 'Relazioni SS', 'Relazioni Psicologa');

update public.resident_documents
set categoria = 'Area sanitaria'
where categoria = 'Storico Medico';

update public.resident_documents
set categoria = 'Varie'
where categoria = 'Altro';
