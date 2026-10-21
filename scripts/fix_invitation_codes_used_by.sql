-- Fix: invitation_codes.used_by → SET NULL quando il profilo viene eliminato
alter table public.invitation_codes
  drop constraint if exists invitation_codes_used_by_fkey;

alter table public.invitation_codes
  add constraint invitation_codes_used_by_fkey
    foreign key (used_by)
    references public.profiles(id)
    on delete set null;
