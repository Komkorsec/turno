-- Mostra tutte le policy RLS su structures e invitation_codes
select
  tablename,
  policyname,
  cmd,
  qual
from pg_policies
where schemaname = 'public'
  and tablename in ('structures', 'invitation_codes', 'organizations')
order by tablename, cmd;
