-- Minimal stand-in for the parts of a Supabase database our migrations and
-- policies depend on: API roles, auth.users/auth.uid(), storage and realtime.
-- Used ONLY by automated tests on PGlite; never applied to a real project.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

create table auth.users (
  id uuid primary key,
  email text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true),
             (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
    '')::uuid
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- Supabase grants table privileges broadly and relies on RLS; mirror that so
-- tests prove the policies (not missing grants) are what deny access.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner_id text,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant all on storage.buckets to anon, authenticated, service_role;

create schema if not exists realtime;
create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null default 'broadcast',
  payload jsonb,
  inserted_at timestamptz default now()
);
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated, service_role;
grant all on realtime.messages to anon, authenticated, service_role;
grant execute on function realtime.topic() to anon, authenticated, service_role;

create publication supabase_realtime;
