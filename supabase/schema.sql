-- =====================================================================
-- Lumo – Datenbank-Schema für Supabase
-- Einmal komplett im Supabase SQL-Editor ausführen (Run).
-- Kann gefahrlos erneut ausgeführt werden.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.]{2,32}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 300),
  status text not null default 'online' check (status in ('online','idle','dnd','invisible')),
  custom_status text not null default '' check (char_length(custom_status) <= 80),
  accent text not null default '#6c5ce7',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists banner_url text;

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  icon_url text,
  color text not null default '#6c5ce7',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null default 'text' check (kind in ('text','voice')),
  topic text not null default '' check (char_length(topic) <= 200),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 4000),
  reply_to uuid references public.messages(id) on delete set null,
  attachments jsonb not null default '[]'::jsonb,
  poll jsonb,
  pinned boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  check ((channel_id is null) <> (conversation_id is null))
);
create index if not exists messages_channel_idx on public.messages (channel_id, created_at desc);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at desc);

create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.poll_votes (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option int not null check (option between 0 and 9),
  primary key (message_id, user_id)
);

create table if not exists public.friendships (
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

create table if not exists public.read_states (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, target_id)
);

-- ------------------------------------------------------------- helpers
create or replace function public.server_role(sid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from server_members where server_id = sid and user_id = auth.uid()
$$;

create or replace function public.is_conv_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from conversation_members where conversation_id = cid and user_id = auth.uid())
$$;

create or replace function public.can_read_message(m public.messages) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when m.channel_id is not null then exists(
      select 1 from channels c join server_members sm on sm.server_id = c.server_id
      where c.id = m.channel_id and sm.user_id = auth.uid())
    else exists(select 1 from conversation_members where conversation_id = m.conversation_id and user_id = auth.uid())
  end
$$;

create or replace function public.message_visible(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_read_message(m) from messages m where m.id = mid), false)
$$;

-- new user -> profile (username from sign-up metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 0;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)), '[^a-zA-Z0-9_.]', '', 'g'));
  if char_length(base) < 2 then base := 'user' || base; end if;
  base := left(base, 28);
  candidate := base;
  while exists(select 1 from profiles where username = candidate) loop
    n := n + 1; candidate := base || n::text;
  end loop;
  insert into profiles (id, username, display_name)
  values (new.id, candidate, left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), candidate), 40));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- new server -> owner membership + default channels
create or replace function public.handle_new_server() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into server_members (server_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into channels (server_id, name, kind, position) values
    (new.id, 'allgemein', 'text', 0), (new.id, 'medien', 'text', 1), (new.id, 'Lounge', 'voice', 2);
  return new;
end $$;
drop trigger if exists on_server_created on public.servers;
create trigger on_server_created after insert on public.servers for each row execute function public.handle_new_server();

-- create a server (owner membership + default channels via trigger)
create or replace function public.create_server(p_name text, p_color text default '#6c5ce7', p_icon text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into servers (name, color, icon_url, owner_id) values (trim(p_name), coalesce(p_color, '#6c5ce7'), p_icon, auth.uid()) returning id into sid;
  return sid;
end $$;

-- join a server by invite code
create or replace function public.join_server(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into sid from servers where invite_code = trim(code);
  if sid is null then raise exception 'Einladung ungültig'; end if;
  insert into server_members (server_id, user_id) values (sid, auth.uid()) on conflict do nothing;
  return sid;
end $$;

-- username check during sign-up (callable before login)
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists(select 1 from profiles where username = lower(trim(u)))
$$;

-- log in with a username: returns the account's private placeholder e-mail (only that kind of address)
create or replace function public.login_email(u text) returns text
language sql stable security definer set search_path = public, auth as $$
  select au.email from auth.users au join public.profiles p on p.id = au.id
  where p.username = lower(trim(u)) and au.email like '%@lumoapp.vercel.app'
$$;

-- preview a server before joining
create or replace function public.invite_info(code text) returns table (id uuid, name text, icon_url text, color text, members bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.icon_url, s.color, (select count(*) from server_members where server_id = s.id)
  from servers s where s.invite_code = trim(code)
$$;

-- new invite code (owner/admin)
create or replace function public.reset_invite(sid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  if public.server_role(sid) not in ('owner','admin') then raise exception 'keine Berechtigung'; end if;
  update servers set invite_code = code where id = sid;
  return code;
end $$;

-- open (or reuse) a direct-message conversation
create or replace function public.open_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if other = auth.uid() then raise exception 'not with yourself'; end if;
  select a.conversation_id into cid from conversation_members a
    join conversation_members b on b.conversation_id = a.conversation_id
    where a.user_id = auth.uid() and b.user_id = other
      and (select count(*) from conversation_members c where c.conversation_id = a.conversation_id) = 2
    limit 1;
  if cid is null then
    insert into conversations default values returning id into cid;
    insert into conversation_members values (cid, auth.uid()), (cid, other);
  end if;
  return cid;
end $$;

-- pin / unpin (server admins, or any DM participant)
create or replace function public.toggle_pin(mid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare m messages; allowed boolean; val boolean;
begin
  select * into m from messages where id = mid;
  if m.id is null then raise exception 'not found'; end if;
  if m.channel_id is not null then
    allowed := public.server_role((select server_id from channels where id = m.channel_id)) in ('owner','admin');
  else
    allowed := public.is_conv_member(m.conversation_id);
  end if;
  if not allowed then raise exception 'keine Berechtigung'; end if;
  update messages set pinned = not pinned where id = mid returning pinned into val;
  return val;
end $$;

-- ------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.poll_votes enable row level security;
alter table public.friendships enable row level security;
alter table public.read_states enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- servers
create policy "servers read" on public.servers for select to authenticated using (public.server_role(id) is not null);
create policy "servers create" on public.servers for insert to authenticated with check (owner_id = auth.uid());
create policy "servers update" on public.servers for update to authenticated using (public.server_role(id) in ('owner','admin')) with check (public.server_role(id) in ('owner','admin'));
create policy "servers delete" on public.servers for delete to authenticated using (owner_id = auth.uid());

-- members
create policy "members read" on public.server_members for select to authenticated using (public.server_role(server_id) is not null);
create policy "members leave or kick" on public.server_members for delete to authenticated using (
  (user_id = auth.uid() and role <> 'owner')
  or (public.server_role(server_id) = 'owner' and role <> 'owner')
  or (public.server_role(server_id) = 'admin' and role = 'member'));
create policy "members role" on public.server_members for update to authenticated
  using (public.server_role(server_id) = 'owner' and role <> 'owner') with check (role in ('admin','member'));

-- channels
create policy "channels read" on public.channels for select to authenticated using (public.server_role(server_id) is not null);
create policy "channels write" on public.channels for all to authenticated
  using (public.server_role(server_id) in ('owner','admin')) with check (public.server_role(server_id) in ('owner','admin'));

-- conversations
create policy "conversations read" on public.conversations for select to authenticated using (public.is_conv_member(id));
create policy "conversation members read" on public.conversation_members for select to authenticated using (public.is_conv_member(conversation_id));

-- messages
create policy "messages read" on public.messages for select to authenticated using (public.can_read_message(messages));
create policy "messages send" on public.messages for insert to authenticated with check (author_id = auth.uid() and public.can_read_message(messages) and pinned = false);
create policy "messages edit own" on public.messages for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "messages delete" on public.messages for delete to authenticated using (
  author_id = auth.uid()
  or (channel_id is not null and public.server_role((select server_id from public.channels c where c.id = channel_id)) in ('owner','admin')));

-- reactions & votes
create policy "reactions read" on public.reactions for select to authenticated using (public.message_visible(message_id));
create policy "reactions add" on public.reactions for insert to authenticated with check (user_id = auth.uid() and public.message_visible(message_id));
create policy "reactions remove" on public.reactions for delete to authenticated using (user_id = auth.uid());
create policy "votes read" on public.poll_votes for select to authenticated using (public.message_visible(message_id));
create policy "votes add" on public.poll_votes for insert to authenticated with check (user_id = auth.uid() and public.message_visible(message_id));
create policy "votes change" on public.poll_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "votes remove" on public.poll_votes for delete to authenticated using (user_id = auth.uid());

-- friendships
create policy "friends read" on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
create policy "friends request" on public.friendships for insert to authenticated with check (requester = auth.uid() and status = 'pending');
create policy "friends accept" on public.friendships for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
create policy "friends remove" on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

-- read states
create policy "read states own" on public.read_states for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------- column protection
-- users may only change the text of their own messages, not move or pin them
create or replace function public.guard_message_update() returns trigger
language plpgsql as $$
begin
  -- direct client updates run as "authenticated"; security-definer functions (toggle_pin) do not
  if current_user = 'authenticated' and (
     new.channel_id is distinct from old.channel_id or new.conversation_id is distinct from old.conversation_id
     or new.author_id <> old.author_id or new.created_at <> old.created_at or new.pinned <> old.pinned) then
    raise exception 'unzulässige Änderung';
  end if;
  return new;
end $$;
drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update before update on public.messages for each row execute function public.guard_message_update();

create or replace function public.guard_server_update() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and (new.owner_id <> old.owner_id or new.invite_code <> old.invite_code) then
    raise exception 'unzulässige Änderung';
  end if;
  return new;
end $$;
drop trigger if exists guard_server_update on public.servers;
create trigger guard_server_update before update on public.servers for each row execute function public.guard_server_update();

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', true)
on conflict (id) do update set public = true;

drop policy if exists "uploads read" on storage.objects;
drop policy if exists "uploads write own" on storage.objects;
drop policy if exists "uploads delete own" on storage.objects;
create policy "uploads read" on storage.objects for select using (bucket_id = 'uploads');
create policy "uploads write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- --------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['messages','reactions','poll_votes','server_members','channels','servers','friendships','profiles','conversation_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.messages replica identity full;
alter table public.reactions replica identity full;
alter table public.poll_votes replica identity full;
alter table public.server_members replica identity full;
alter table public.friendships replica identity full;

-- ---------------------------------------------------------------- grants
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.username_available(text) to anon;
grant execute on function public.login_email(text) to anon;
revoke execute on function public.login_email(text) from public;

-- ------------------------------------------------- username-only accounts
-- Accounts use a placeholder e-mail on @lumoapp.vercel.app (no mailbox). They never need confirming:
-- confirm them on creation and unlock any created before this ran.
create or replace function public.autoconfirm_placeholder() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.email like '%@lumoapp.vercel.app' and new.email_confirmed_at is null then new.email_confirmed_at := now(); end if;
  return new;
end $$;
drop trigger if exists autoconfirm_placeholder on auth.users;
create trigger autoconfirm_placeholder before insert on auth.users for each row execute function public.autoconfirm_placeholder();
update auth.users set email_confirmed_at = now() where email like '%@lumoapp.vercel.app' and email_confirmed_at is null;
