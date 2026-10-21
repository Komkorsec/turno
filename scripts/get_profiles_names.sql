-- RPC SECURITY DEFINER per risolvere i full_name di una lista di user ID
-- Usata da DiaryComments per mostrare il nome del mittente indipendentemente da RLS

CREATE OR REPLACE FUNCTION public.get_profiles_names(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, full_name
  FROM public.profiles
  WHERE id = ANY(p_ids);
$$;
