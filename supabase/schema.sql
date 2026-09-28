-- Run once in the eventchecker project's Supabase SQL Editor.
begin;

create table if not exists public.eventchecker_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.eventchecker_members enable row level security;
drop policy if exists member_read on public.eventchecker_members;
create policy member_read on public.eventchecker_members for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.eventchecker_members from anon, authenticated;
grant select on public.eventchecker_members to authenticated;

create or replace function public.eventchecker_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.eventchecker_members where user_id = auth.uid());
$$;
revoke all on function public.eventchecker_is_member() from public, anon;
grant execute on function public.eventchecker_is_member() to authenticated;

create table if not exists public.eventchecker_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  source text not null check (source in ('escape', 'scrap', 'tmc')),
  source_key text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  last_error text,
  created_at timestamptz not null default now(),
  primary key(user_id, id), unique(user_id, source, source_key)
);
alter table public.eventchecker_events drop constraint if exists eventchecker_events_source_check;
alter table public.eventchecker_events add constraint eventchecker_events_source_check check (source in ('escape', 'scrap', 'tmc'));
create table if not exists public.eventchecker_sessions (
  user_id uuid not null, event_id text not null, id text not null,
  start_at timestamptz not null, data jsonb not null, active boolean not null default true,
  primary key(user_id, event_id, id),
  foreign key(user_id, event_id) references public.eventchecker_events(user_id, id) on delete cascade
);
create table if not exists public.eventchecker_user_events (
  user_id uuid not null, event_id text not null,
  status text not null check(status in ('unpurchased', 'purchased', 'ignored')),
  primary key(user_id, event_id),
  foreign key(user_id, event_id) references public.eventchecker_events(user_id, id) on delete cascade
);
create table if not exists public.eventchecker_reservations (
  user_id uuid not null, event_id text not null, session_id text not null,
  primary key(user_id, event_id, session_id),
  foreign key(user_id, event_id, session_id) references public.eventchecker_sessions(user_id, event_id, id) on delete cascade
);
create table if not exists public.eventchecker_source_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid, expires_at timestamptz not null default now()
);
create table if not exists public.eventchecker_source_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null, attempted_at timestamptz not null default now(),
  primary key(user_id, url)
);
create index if not exists eventchecker_session_dates on public.eventchecker_sessions(user_id, start_at);

do $$
declare table_name text;
begin
  foreach table_name in array array['eventchecker_events', 'eventchecker_sessions', 'eventchecker_user_events', 'eventchecker_reservations', 'eventchecker_source_locks', 'eventchecker_source_attempts'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists owner_access on public.%I', table_name);
    execute format('create policy owner_access on public.%I for all to authenticated using (user_id = (select auth.uid()) and (select public.eventchecker_is_member())) with check (user_id = (select auth.uid()) and (select public.eventchecker_is_member()))', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

-- Each RPC runs in one transaction. RLS applies to the authenticated caller.
create or replace function public.eventchecker_command(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  eid text := p_payload->>'id';
  slot jsonb;
  result jsonb;
  is_active boolean;
  lease public.eventchecker_source_locks%rowtype;
begin
  if uid is null or not public.eventchecker_is_member() then
    raise exception 'このアカウントには利用権限がありません。';
  end if;

  if p_action = 'list' then
    select coalesce(jsonb_agg(item order by created_at desc, id), '[]'::jsonb) into result from (
      select e.created_at, e.id, e.data || jsonb_build_object(
        'id', e.id, 'status', coalesce(u.status, 'unpurchased'),
        'warning', coalesce(to_jsonb(e.last_error), e.data->'warning'),
        'sessions', coalesce((select jsonb_agg(s.data || jsonb_build_object('active', s.active, 'reserved', r.session_id is not null) order by s.start_at, s.id)
          from public.eventchecker_sessions s left join public.eventchecker_reservations r
            on r.user_id=s.user_id and r.event_id=s.event_id and r.session_id=s.id
          where s.user_id=uid and s.event_id=e.id), '[]'::jsonb)
      ) as item from public.eventchecker_events e left join public.eventchecker_user_events u
        on u.user_id=e.user_id and u.event_id=e.id where e.user_id=uid
    ) items;
    return result;
  end if;

  if p_action = 'acquire' then
    insert into public.eventchecker_source_locks(user_id) values(uid) on conflict do nothing;
    select * into lease from public.eventchecker_source_locks where user_id=uid for update;
    if lease.token is not null and lease.expires_at > now() then
      raise exception '別の公演を取得中です。完了後にお試しください。';
    end if;
    if exists(select 1 from public.eventchecker_source_attempts where user_id=uid and url=p_payload->>'url' and attempted_at > now() - interval '1 minute') then
      raise exception '同じ公演の再取得は1分ほど間隔をあけてください。';
    end if;
    update public.eventchecker_source_locks set token=(p_payload->>'token')::uuid, expires_at=now()+interval '330 seconds' where user_id=uid;
    insert into public.eventchecker_source_attempts(user_id,url) values(uid,p_payload->>'url')
      on conflict(user_id,url) do update set attempted_at=now();
    return 'null'::jsonb;
  elsif p_action = 'release' then
    update public.eventchecker_source_locks set token=null, expires_at=now() where user_id=uid and token=(p_payload->>'token')::uuid;
    return 'null'::jsonb;
  end if;

  if eid is null or length(eid) > 100 then raise exception '公演IDが不正です。'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || eid, 0));
  if p_action in ('save', 'restore') then
    if p_action='restore' and exists(select 1 from public.eventchecker_events where user_id=uid and id=eid) then
      return to_jsonb(eid);
    end if;
    if jsonb_typeof(p_payload->'sessions') is distinct from 'array' then raise exception '開催回が不正です。'; end if;
    insert into public.eventchecker_events(user_id,id,source,source_key,data)
      values(uid,eid,p_payload->>'source',p_payload->>'sourceKey',p_payload-array['id','sessions','status','complete','coverageFrom','coverageTo'])
      on conflict(user_id,id) do update set data=excluded.data,last_error=null;
    if p_action='save' and (p_payload->>'complete')::boolean then
      update public.eventchecker_sessions set active=false where user_id=uid and event_id=eid
        and start_at >= ((p_payload->>'coverageFrom') || 'T00:00:00+09:00')::timestamptz
        and start_at < ((p_payload->>'coverageTo') || 'T00:00:00+09:00')::timestamptz + interval '1 day';
    end if;
    for slot in select value from jsonb_array_elements(p_payload->'sessions') loop
      insert into public.eventchecker_sessions(user_id,event_id,id,start_at,data,active)
        values(uid,eid,slot->>'id',(slot->>'start')::timestamptz,slot,
          case when p_action='restore' then coalesce((slot->>'active')::boolean,true) else true end)
        on conflict(user_id,event_id,id) do update set start_at=excluded.start_at,data=excluded.data,active=excluded.active;
      if p_action='restore' and coalesce((slot->>'reserved')::boolean,false) then
        insert into public.eventchecker_reservations values(uid,eid,slot->>'id') on conflict do nothing;
      end if;
    end loop;
    if p_action='restore' then
      insert into public.eventchecker_user_events values(uid,eid,
        case when exists(select 1 from public.eventchecker_reservations where user_id=uid and event_id=eid) then 'purchased' else coalesce(p_payload->>'status','unpurchased') end);
    end if;
    return to_jsonb(eid);
  end if;

  if not exists(select 1 from public.eventchecker_events where user_id=uid and id=eid) then raise exception '公演が見つかりません。'; end if;
  if p_action='status' then
    if p_payload->>'status' <> 'purchased' and exists(select 1 from public.eventchecker_reservations where user_id=uid and event_id=eid) then
      raise exception '購入済みの開催回を解除してから、状態を変更してください。';
    end if;
    insert into public.eventchecker_user_events values(uid,eid,p_payload->>'status')
      on conflict(user_id,event_id) do update set status=excluded.status;
  elsif p_action='reserve' then
    select active into is_active from public.eventchecker_sessions where user_id=uid and event_id=eid and id=p_payload->>'sessionId';
    if not found or ((p_payload->>'value')::boolean and not is_active) then raise exception 'この開催回は現在掲載されていません。'; end if;
    if (p_payload->>'value')::boolean then
      insert into public.eventchecker_reservations values(uid,eid,p_payload->>'sessionId') on conflict do nothing;
      insert into public.eventchecker_user_events values(uid,eid,'purchased') on conflict(user_id,event_id) do update set status='purchased';
    else
      delete from public.eventchecker_reservations where user_id=uid and event_id=eid and session_id=p_payload->>'sessionId';
      if not exists(select 1 from public.eventchecker_reservations where user_id=uid and event_id=eid) then
        insert into public.eventchecker_user_events values(uid,eid,'unpurchased') on conflict(user_id,event_id) do update set status='unpurchased';
      end if;
    end if;
  elsif p_action='delete' then
    delete from public.eventchecker_events where user_id=uid and id=eid;
  elsif p_action='error' then
    update public.eventchecker_events set last_error='更新に失敗しました。前回の情報を表示しています。' || coalesce(p_payload->>'message','') where user_id=uid and id=eid;
  else raise exception '未対応の操作です。';
  end if;
  return 'null'::jsonb;
end $$;
revoke all on function public.eventchecker_command(text,jsonb) from public, anon;
grant execute on function public.eventchecker_command(text,jsonb) to authenticated;
commit;
