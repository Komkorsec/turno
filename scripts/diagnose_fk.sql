-- Mostra i vincoli FK che puntano a structures e come gestiscono il DELETE
select
  tc.table_name,
  kcu.column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema   = kcu.table_schema
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
  and tc.table_schema   = rc.constraint_schema
join information_schema.key_column_usage ccu
  on rc.unique_constraint_name = ccu.constraint_name
  and rc.unique_constraint_schema = ccu.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and ccu.table_name = 'structures'
order by tc.table_name;
