alter table public.diary_comments
  add column if not exists reply_to_id bigint references public.diary_comments(id) on delete set null;
