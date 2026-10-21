-- Mostra tutto ciò che è collegato a ogni struttura
select
  s.id,
  s.name,
  s.organization_id,
  (select count(*) from diaries          where structure_id   = s.id) as diaries,
  (select count(*) from invitation_codes where structure_id   = s.id) as inv_codes,
  (select count(*) from profiles         where structure_id   = s.id) as profiles,
  (select count(*) from user_structures  where structure_id   = s.id) as user_structs
from public.structures s
order by s.id;
