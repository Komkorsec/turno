-- Permette solo all'admin di inserire nuovi codici invito
-- La lettura rimane pubblica (già configurata)
create policy "codes_insert_admin" on public.invitation_codes
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'email') = 'umberto.vignati05@gmail.com'
  );
