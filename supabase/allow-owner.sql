-- Replace owner@example.com with your email, then create that user in Authentication > Users > Add user.
-- Choose a password in the Supabase dashboard; do not put it in this file.
do $$
declare owner_id uuid;
begin
  select id into owner_id from auth.users where lower(email) = 'owner@example.com';
  if owner_id is null then raise exception '先にAuthentication > Usersで指定したメールアドレスのユーザーを作成してください。'; end if;
  insert into public.eventchecker_members(user_id) values(owner_id) on conflict do nothing;
end $$;
