-- Haven household database. Run this file once in Supabase SQL Editor.
-- Keep Row Level Security enabled. Do not add a service-role key to the browser app.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.households (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(trim(name)) between 1 and 60),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.household_members (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','admin','family','guest')),
 created_at timestamptz not null default now(),
 unique(household_id,user_id)
);
create table if not exists public.rooms (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 50),
 icon text not null default 'other',
 created_at timestamptz not null default now()
);
create table if not exists public.devices (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 room_id uuid references public.rooms(id) on delete set null,
 name text not null check(char_length(trim(name)) between 1 and 70),
 kind text not null default 'other',
 manufacturer text not null default '',
 integration text not null default 'manual',
 connection_state text not null default 'not_connected' check(connection_state in ('not_connected','connected','unavailable','unknown')),
 external_id text,
 created_at timestamptz not null default now()
);
create table if not exists public.automation_drafts (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 70),
 trigger_description text not null check(char_length(trim(trigger_description)) between 1 and 500),
 action_description text not null check(char_length(trim(action_description)) between 1 and 500),
 enabled boolean not null default false check(enabled=false),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.energy_readings (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 source_name text not null,
 energy_kwh numeric(12,4) not null check(energy_kwh>=0),
 measured_at timestamptz not null
);
create table if not exists public.activity_events (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 event_type text not null,
 description text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.household_invites (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 token_hash text not null unique,
 role text not null check(role in ('admin','family','guest')),
 created_by uuid not null references auth.users(id),
 expires_at timestamptz not null default now()+interval '7 days',
 created_at timestamptz not null default now()
);
create index if not exists household_members_user_idx on public.household_members(user_id);
create index if not exists rooms_household_idx on public.rooms(household_id);
create index if not exists devices_household_idx on public.devices(household_id);
create index if not exists automations_household_idx on public.automation_drafts(household_id);
create index if not exists activity_household_created_idx on public.activity_events(household_id,created_at desc);
create index if not exists energy_household_measured_idx on public.energy_readings(household_id,measured_at desc);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.household_members m where m.household_id=target_household and m.user_id=auth.uid());
$$;
create or replace function public.can_view_household_details(target_household uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.household_members m where m.household_id=target_household and m.user_id=auth.uid() and m.role in ('owner','admin','family'));
$$;
create or replace function public.can_manage_household(target_household uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.household_members m where m.household_id=target_household and m.user_id=auth.uid() and m.role in ('owner','admin'));
$$;
create or replace function public.is_household_owner(target_household uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.household_members m where m.household_id=target_household and m.user_id=auth.uid() and m.role='owner');
$$;

create or replace function public.create_household(p_name text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'Je moet ingelogd zijn.'; end if;
 if exists(select 1 from public.household_members where user_id=auth.uid() and role='owner') then raise exception 'Je account heeft al een huishouden aangemaakt.'; end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 60 then raise exception 'Vul een naam van 1 tot 60 tekens in.'; end if;
 insert into public.households(name,created_by) values(trim(p_name),auth.uid()) returning id into new_id;
 insert into public.household_members(household_id,user_id,role) values(new_id,auth.uid(),'owner');
 insert into public.activity_events(household_id,actor_id,event_type,description) values(new_id,auth.uid(),'household.created','Huishouden aangemaakt');
 return new_id;
end;
$$;
create or replace function public.create_household_invite(p_household uuid,p_role text default 'family')
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare raw_token text;
begin
 if not public.can_manage_household(p_household) then raise exception 'Geen toestemming om gezinsleden uit te nodigen.'; end if;
 if p_role not in ('admin','family','guest') then raise exception 'Ongeldige rol.'; end if;
 if p_role='admin' and not public.is_household_owner(p_household) then raise exception 'Alleen de eigenaar kan een beheerder uitnodigen.'; end if;
 raw_token:=encode(gen_random_bytes(24),'hex');
 insert into public.household_invites(household_id,token_hash,role,created_by) values(p_household,encode(digest(raw_token,'sha256'),'hex'),p_role,auth.uid());
 return raw_token;
end;
$$;
create or replace function public.accept_household_invite(p_token text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invite_row public.household_invites%rowtype;
begin
 if auth.uid() is null then raise exception 'Log eerst in.'; end if;
 if p_token is null or char_length(p_token)<20 then raise exception 'Ongeldige uitnodigingscode.'; end if;
 select * into invite_row from public.household_invites where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now() for update;
 if not found then raise exception 'Deze uitnodiging bestaat niet meer of is verlopen.'; end if;
 insert into public.household_members(household_id,user_id,role) values(invite_row.household_id,auth.uid(),invite_row.role) on conflict(household_id,user_id) do nothing;
 delete from public.household_invites where id=invite_row.id;
 insert into public.activity_events(household_id,actor_id,event_type,description) values(invite_row.household_id,auth.uid(),'member.joined','Een gezinslid is toegevoegd');
 return invite_row.household_id;
end;
$$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.profiles(id,full_name) values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(coalesce(new.email,''),'@',1))) on conflict(id) do nothing;
 return new;
end;
$$;
drop trigger if exists on_auth_user_created_haven on auth.users;
create trigger on_auth_user_created_haven after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.rooms enable row level security;
alter table public.devices enable row level security;
alter table public.automation_drafts enable row level security;
alter table public.energy_readings enable row level security;
alter table public.activity_events enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists "profiles readable by household" on public.profiles;
create policy "profiles readable by household" on public.profiles for select using(id=auth.uid() or exists(
 select 1 from public.household_members mine join public.household_members theirs on theirs.household_id=mine.household_id
 where mine.user_id=auth.uid() and theirs.user_id=profiles.id
));
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());

drop policy if exists "household member read" on public.households;
create policy "household member read" on public.households for select using(public.is_household_member(id));
drop policy if exists "household owner update" on public.households;
create policy "household owner update" on public.households for update using(public.is_household_owner(id)) with check(public.is_household_owner(id));

drop policy if exists "members read household" on public.household_members;
create policy "members read household" on public.household_members for select using(public.is_household_member(household_id));
drop policy if exists "admins update member roles" on public.household_members;
create policy "admins update member roles" on public.household_members for update using(public.can_manage_household(household_id) and role<>'owner') with check(public.can_manage_household(household_id) and role<>'owner');

drop policy if exists "rooms member read" on public.rooms;
create policy "rooms member read" on public.rooms for select using(public.is_household_member(household_id));
drop policy if exists "rooms manager insert" on public.rooms;
create policy "rooms manager insert" on public.rooms for insert with check(public.can_manage_household(household_id));
drop policy if exists "rooms manager update" on public.rooms;
create policy "rooms manager update" on public.rooms for update using(public.can_manage_household(household_id)) with check(public.can_manage_household(household_id));
drop policy if exists "rooms manager delete" on public.rooms;
create policy "rooms manager delete" on public.rooms for delete using(public.can_manage_household(household_id));

drop policy if exists "devices member read" on public.devices;
create policy "devices member read" on public.devices for select using(public.is_household_member(household_id));
drop policy if exists "devices manager insert" on public.devices;
create policy "devices manager insert" on public.devices for insert with check(public.can_manage_household(household_id));
drop policy if exists "devices manager update" on public.devices;
create policy "devices manager update" on public.devices for update using(public.can_manage_household(household_id)) with check(public.can_manage_household(household_id));
drop policy if exists "devices manager delete" on public.devices;
create policy "devices manager delete" on public.devices for delete using(public.can_manage_household(household_id));

drop policy if exists "automation member read" on public.automation_drafts;
create policy "automation member read" on public.automation_drafts for select using(public.can_view_household_details(household_id));
drop policy if exists "automation manager insert" on public.automation_drafts;
create policy "automation manager insert" on public.automation_drafts for insert with check(public.can_manage_household(household_id) and created_by=auth.uid() and enabled=false);
drop policy if exists "automation manager update" on public.automation_drafts;
create policy "automation manager update" on public.automation_drafts for update using(public.can_manage_household(household_id)) with check(public.can_manage_household(household_id) and enabled=false);
drop policy if exists "automation manager delete" on public.automation_drafts;
create policy "automation manager delete" on public.automation_drafts for delete using(public.can_manage_household(household_id));

drop policy if exists "energy member read" on public.energy_readings;
create policy "energy member read" on public.energy_readings for select using(public.can_view_household_details(household_id));
drop policy if exists "energy manager insert" on public.energy_readings;
create policy "energy manager insert" on public.energy_readings for insert with check(public.can_manage_household(household_id));

drop policy if exists "activity member read" on public.activity_events;
create policy "activity member read" on public.activity_events for select using(public.can_view_household_details(household_id));
drop policy if exists "activity manager insert" on public.activity_events;
create policy "activity manager insert" on public.activity_events for insert with check(public.can_manage_household(household_id));

drop policy if exists "invite manager read" on public.household_invites;
create policy "invite manager read" on public.household_invites for select using(public.can_manage_household(household_id));
revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;
revoke all on function public.create_household_invite(uuid,text) from public;
grant execute on function public.create_household_invite(uuid,text) to authenticated;
revoke all on function public.accept_household_invite(text) from public;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.can_view_household_details(uuid) to authenticated;
grant execute on function public.can_manage_household(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

 
-- ============================================================
-- Haven phase 2: presence, private authorization helpers, sync
-- This block is deliberately idempotent and runs after the core schema.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'household_members_profile_id_fkey'
      and conrelid = 'public.household_members'::regclass
  ) then
    alter table public.household_members
      add constraint household_members_profile_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_household_member(target_household uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (select 1 from public.household_members m
    where m.household_id=target_household and m.user_id=(select auth.uid()));
$$;
create or replace function private.can_view_household_details(target_household uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (select 1 from public.household_members m
    where m.household_id=target_household and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','family'));
$$;
create or replace function private.can_manage_household(target_household uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (select 1 from public.household_members m
    where m.household_id=target_household and m.user_id=(select auth.uid())
      and m.role in ('owner','admin'));
$$;
create or replace function private.is_household_owner(target_household uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (select 1 from public.household_members m
    where m.household_id=target_household and m.user_id=(select auth.uid())
      and m.role='owner');
$$;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.can_view_household_details(uuid) to authenticated;
grant execute on function private.can_manage_household(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;

create table if not exists public.member_presence (
  household_id uuid not null,
  user_id uuid not null,
  presence text not null default 'unknown' check(presence in ('home','away','unknown')),
  updated_at timestamptz not null default now(),
  primary key(household_id,user_id),
  constraint member_presence_member_fkey foreign key(household_id,user_id)
    references public.household_members(household_id,user_id) on delete cascade
);
insert into public.member_presence(household_id,user_id,presence)
select household_id,user_id,'unknown' from public.household_members
on conflict(household_id,user_id) do nothing;

create or replace function private.initialize_household_presence()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  insert into public.member_presence(household_id,user_id,presence)
  values(new.household_id,new.user_id,'unknown')
  on conflict(household_id,user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.initialize_household_presence() from public, anon, authenticated;
drop trigger if exists on_household_member_presence_created on public.household_members;
create trigger on_household_member_presence_created
after insert on public.household_members
for each row execute function private.initialize_household_presence();

alter table public.member_presence enable row level security;
grant select, insert, update, delete on public.member_presence to authenticated;

drop policy if exists "presence household read" on public.member_presence;
drop policy if exists "presence own insert" on public.member_presence;
drop policy if exists "presence own update" on public.member_presence;
create policy "presence household read" on public.member_presence
for select to authenticated using((select private.is_household_member(household_id)));
create policy "presence own insert" on public.member_presence
for insert to authenticated with check(user_id=(select auth.uid()) and (select private.is_household_member(household_id)));
create policy "presence own update" on public.member_presence
for update to authenticated
using(user_id=(select auth.uid()) or (select private.can_manage_household(household_id)))
with check(user_id=(select auth.uid()) or (select private.can_manage_household(household_id)));

-- Rebuild household policies to use internal, non-exposed helper functions.
drop policy if exists "household member read" on public.households;
drop policy if exists "household owner update" on public.households;
create policy "household member read" on public.households
for select to authenticated using((select private.is_household_member(id)));
create policy "household owner update" on public.households
for update to authenticated using((select private.is_household_owner(id)))
with check((select private.is_household_owner(id)));

drop policy if exists "members read household" on public.household_members;
drop policy if exists "admins update member roles" on public.household_members;
drop policy if exists "owner update member roles" on public.household_members;
create policy "members read household" on public.household_members
for select to authenticated using((select private.is_household_member(household_id)));
create policy "owner update member roles" on public.household_members
for update to authenticated
using((select private.is_household_owner(household_id)) and role<>'owner')
with check((select private.is_household_owner(household_id)) and role in ('admin','family','guest'));

drop policy if exists "rooms member read" on public.rooms;
drop policy if exists "rooms manager insert" on public.rooms;
drop policy if exists "rooms manager update" on public.rooms;
drop policy if exists "rooms manager delete" on public.rooms;
create policy "rooms member read" on public.rooms
for select to authenticated using((select private.is_household_member(household_id)));
create policy "rooms manager insert" on public.rooms
for insert to authenticated with check((select private.can_manage_household(household_id)));
create policy "rooms manager update" on public.rooms
for update to authenticated using((select private.can_manage_household(household_id)))
with check((select private.can_manage_household(household_id)));
create policy "rooms manager delete" on public.rooms
for delete to authenticated using((select private.can_manage_household(household_id)));

drop policy if exists "devices member read" on public.devices;
drop policy if exists "devices manager insert" on public.devices;
drop policy if exists "devices manager update" on public.devices;
drop policy if exists "devices manager delete" on public.devices;
create policy "devices member read" on public.devices
for select to authenticated using((select private.is_household_member(household_id)));
create policy "devices manager insert" on public.devices
for insert to authenticated with check((select private.can_manage_household(household_id)));
create policy "devices manager update" on public.devices
for update to authenticated using((select private.can_manage_household(household_id)))
with check((select private.can_manage_household(household_id)));
create policy "devices manager delete" on public.devices
for delete to authenticated using((select private.can_manage_household(household_id)));

drop policy if exists "automation member read" on public.automation_drafts;
drop policy if exists "automation manager insert" on public.automation_drafts;
drop policy if exists "automation manager update" on public.automation_drafts;
drop policy if exists "automation manager delete" on public.automation_drafts;
create policy "automation member read" on public.automation_drafts
for select to authenticated using((select private.can_view_household_details(household_id)));
create policy "automation manager insert" on public.automation_drafts
for insert to authenticated with check((select private.can_manage_household(household_id)) and created_by=(select auth.uid()) and enabled=false);
create policy "automation manager update" on public.automation_drafts
for update to authenticated using((select private.can_manage_household(household_id)))
with check((select private.can_manage_household(household_id)) and enabled=false);
create policy "automation manager delete" on public.automation_drafts
for delete to authenticated using((select private.can_manage_household(household_id)));

drop policy if exists "energy member read" on public.energy_readings;
drop policy if exists "energy manager insert" on public.energy_readings;
create policy "energy member read" on public.energy_readings
for select to authenticated using((select private.can_view_household_details(household_id)));
create policy "energy manager insert" on public.energy_readings
for insert to authenticated with check((select private.can_manage_household(household_id)));

drop policy if exists "activity member read" on public.activity_events;
drop policy if exists "activity manager insert" on public.activity_events;
create policy "activity member read" on public.activity_events
for select to authenticated using((select private.can_view_household_details(household_id)));
create policy "activity manager insert" on public.activity_events
for insert to authenticated with check((select private.can_manage_household(household_id)));

drop policy if exists "invite manager read" on public.household_invites;
create policy "invite manager read" on public.household_invites
for select to authenticated using((select private.can_manage_household(household_id)));

revoke all on function public.is_household_member(uuid) from public, anon, authenticated;
revoke all on function public.can_view_household_details(uuid) from public, anon, authenticated;
revoke all on function public.can_manage_household(uuid) from public, anon, authenticated;
revoke all on function public.is_household_owner(uuid) from public, anon, authenticated;
drop function if exists public.is_household_member(uuid);
drop function if exists public.can_view_household_details(uuid);
drop function if exists public.can_manage_household(uuid);
drop function if exists public.is_household_owner(uuid);

-- Exposed tables are reachable only to signed-in users; RLS remains mandatory.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on function public.create_household(text) from public, anon;
revoke all on function public.create_household_invite(uuid,text) from public, anon;
revoke all on function public.accept_household_invite(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_household_invite(uuid,text) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;

create index if not exists households_created_by_idx on public.households(created_by);
create index if not exists devices_room_id_idx on public.devices(room_id);
create index if not exists automation_drafts_created_by_idx on public.automation_drafts(created_by);
create index if not exists activity_events_actor_id_idx on public.activity_events(actor_id);
create index if not exists household_invites_household_id_idx on public.household_invites(household_id);
create index if not exists household_invites_created_by_idx on public.household_invites(created_by);
create index if not exists member_presence_user_idx on public.member_presence(user_id);

do $$
declare table_name text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach table_name in array array['rooms','devices','automation_drafts','activity_events','household_members','member_presence'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
    execute format('alter publication supabase_realtime add table public.%I',table_name);
   end if;
  end loop;
 end if;
end $$;
