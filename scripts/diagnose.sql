-- ════════════════════════════════════════════════════════
--  DIAGNOSTICA — esegui e condividi il risultato
-- ════════════════════════════════════════════════════════

-- Colonne di tutte le tabelle rilevanti
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('structures', 'profiles', 'diaries',
                     'invitation_codes', 'organizations',
                     'report_views', 'report_history')
order by table_name, ordinal_position;
