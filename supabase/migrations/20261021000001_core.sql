-- CollabVerse core schema: profiles, workspaces, membership, invitations, modules.
--
-- Conventions
--   * Every table holding private data has RLS enabled. Policies apply to the
--     `authenticated` role only; `anon` gets nothing.
--   * Membership changes go exclusively through SECURITY DEFINER functions that
--     re-derive the caller from auth.uid() and check roles explicitly.
--   * Helper functions are SECURITY DEFINER with an empty search_path so that
--     policies can call them without recursing into RLS.

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Never trust a client-supplied author: when called through the API, the
-- creator is always the authenticated user.
create or replace function public.force_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

-- Rows may not migrate between workspaces.
create or replace function public.prevent_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_color text not null default 'iris'
    check (avatar_color in ('iris','teal','amber','rose','sky','lime','violet','slate')),
  onboarded_at timestamptz,
  last_workspace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  insert into public.profiles (id, display_name, avatar_color)
  values (
    new.id,
    left(coalesce(v_name, ''), 60),
    (array['iris','teal','amber','rose','sky','lime','violet','slate'])[1 + floor(random() * 8)::int]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Workspaces and membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 280),
  icon text not null default '✦' check (char_length(icon) between 1 and 8),
  color text not null default 'iris'
    check (color in ('iris','teal','amber','rose','sky','lime','violet','slate')),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_idx on public.workspaces (owner_id);

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

alter table public.profiles
  add constraint profiles_last_workspace_fk
  foreign key (last_workspace_id) references public.workspaces (id) on delete set null;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);
-- Exactly one owner row per workspace.
create unique index workspace_members_one_owner on public.workspace_members (workspace_id)
  where role = 'owner';

create trigger workspace_members_updated_at before update on public.workspace_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers (used by every policy)
-- ---------------------------------------------------------------------------

create or replace function public.workspace_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = (select auth.uid());
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin','member')
  );
$$;

create or replace function public.can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  );
$$;

create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

create or replace function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254 and email like '%_@_%'),
  role text not null check (role in ('admin','member','viewer')),
  -- SHA-256 of the random token; the token itself is shown once and never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index invitations_workspace_idx on public.invitations (workspace_id);
create index invitations_email_idx on public.invitations (email) where accepted_at is null and revoked_at is null;
-- One open invitation per address per workspace.
create unique index invitations_one_open on public.invitations (workspace_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Modules and dashboard layout
-- ---------------------------------------------------------------------------

create table public.workspace_modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  module_type text not null
    check (module_type in ('docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping')),
  enabled boolean not null default true,
  position integer not null default 0 check (position between 0 and 1000),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, module_type)
);

create trigger workspace_modules_updated_at before update on public.workspace_modules
  for each row execute function public.set_updated_at();
create trigger workspace_modules_ws_immutable before update on public.workspace_modules
  for each row execute function public.prevent_workspace_change();

create table public.dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Array of { "module": <type>, "size": "sm" | "md" | "lg" }, validated by the app.
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create trigger dashboard_layouts_updated_at before update on public.dashboard_layouts
  for each row execute function public.set_updated_at();

create or replace function public.dashboard_layout_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger dashboard_layouts_owner before insert or update on public.dashboard_layouts
  for each row execute function public.dashboard_layout_owner();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.workspace_modules enable row level security;
alter table public.dashboard_layouts enable row level security;

create policy "profiles: read self and co-members" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.shares_workspace_with(id)));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "workspaces: members read" on public.workspaces
  for select to authenticated using ((select public.is_workspace_member(id)));
create policy "workspaces: managers update" on public.workspaces
  for update to authenticated
  using ((select public.can_manage_workspace(id)))
  with check ((select public.can_manage_workspace(id)));
-- Insert and delete go through create_workspace() / delete_workspace().

create policy "members: members read" on public.workspace_members
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
-- All writes go through membership functions below.

create policy "invitations: managers read" on public.invitations
  for select to authenticated using ((select public.can_manage_workspace(workspace_id)));
-- Writes go through create_invitation() / revoke_invitation() / accept_*().

create policy "modules: members read" on public.workspace_modules
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy "modules: managers insert" on public.workspace_modules
  for insert to authenticated with check ((select public.can_manage_workspace(workspace_id)));
create policy "modules: managers update" on public.workspace_modules
  for update to authenticated
  using ((select public.can_manage_workspace(workspace_id)))
  with check ((select public.can_manage_workspace(workspace_id)));
create policy "modules: managers delete" on public.workspace_modules
  for delete to authenticated using ((select public.can_manage_workspace(workspace_id)));

create policy "layouts: own read" on public.dashboard_layouts
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));
create policy "layouts: own insert" on public.dashboard_layouts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));
create policy "layouts: own update" on public.dashboard_layouts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));
create policy "layouts: own delete" on public.dashboard_layouts
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Workspace lifecycle functions (each runs in a single transaction)
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  p_name text,
  p_description text default '',
  p_icon text default '✦',
  p_color text default 'iris',
  p_modules text[] default array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping']
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_ws uuid;
  v_all text[] := array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping'];
  v_type text;
  v_pos int := 0;
  v_owned int;
begin
  select count(*) into v_owned from public.workspaces where owner_id = v_uid;
  if v_owned >= 20 then
    raise exception 'Workspace limit reached' using errcode = '54000';
  end if;
  if p_modules is null or not (p_modules <@ v_all) then
    raise exception 'Unknown module type' using errcode = '22023';
  end if;

  insert into public.workspaces (name, description, icon, color, owner_id)
  values (trim(p_name), coalesce(trim(p_description), ''), coalesce(nullif(trim(p_icon), ''), '✦'), coalesce(p_color, 'iris'), v_uid)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');

  foreach v_type in array v_all loop
    insert into public.workspace_modules (workspace_id, module_type, enabled, position)
    values (v_ws, v_type, v_type = any (p_modules), v_pos);
    v_pos := v_pos + 1;
  end loop;

  update public.profiles
     set last_workspace_id = v_ws, onboarded_at = coalesce(onboarded_at, now())
   where id = v_uid;

  return v_ws;
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = v_uid) then
    raise exception 'Only the owner can delete a workspace' using errcode = '42501';
  end if;
  delete from public.workspaces where id = p_workspace_id;
end;
$$;

create or replace function public.update_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_actor text;
  v_target text;
begin
  if p_role not in ('admin','member','viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select role into v_actor from public.workspace_members where workspace_id = p_workspace_id and user_id = v_uid;
  if v_actor is null or v_actor not in ('owner','admin') then
    raise exception 'Not allowed to manage members' using errcode = '42501';
  end if;
  select role into v_target from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id
    for update;
  if v_target is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_target = 'owner' then
    raise exception 'The owner''s role can only change through ownership transfer' using errcode = '42501';
  end if;
  update public.workspace_members set role = p_role
   where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_actor text;
  v_target text;
begin
  select role into v_actor from public.workspace_members where workspace_id = p_workspace_id and user_id = v_uid;
  select role into v_target from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  if v_target is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_target = 'owner' then
    raise exception 'The owner cannot be removed' using errcode = '42501';
  end if;
  -- Members may leave; managers may remove others.
  if p_user_id <> v_uid and (v_actor is null or v_actor not in ('owner','admin')) then
    raise exception 'Not allowed to remove members' using errcode = '42501';
  end if;
  delete from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  update public.profiles set last_workspace_id = null
   where id = p_user_id and last_workspace_id = p_workspace_id;
end;
$$;

create or replace function public.transfer_ownership(p_workspace_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  perform 1 from public.workspaces where id = p_workspace_id and owner_id = v_uid for update;
  if not found then
    raise exception 'Only the owner can transfer ownership' using errcode = '42501';
  end if;
  if p_new_owner = v_uid then
    return;
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_new_owner) then
    raise exception 'New owner must already be a member' using errcode = '42501';
  end if;
  update public.workspace_members set role = 'admin' where workspace_id = p_workspace_id and user_id = v_uid;
  update public.workspace_members set role = 'owner' where workspace_id = p_workspace_id and user_id = p_new_owner;
  update public.workspaces set owner_id = p_new_owner where id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitation functions
-- ---------------------------------------------------------------------------

create or replace function public.hash_invite_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Returns the raw token exactly once. Callers build the invite link from it.
create or replace function public.create_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text,
  p_ttl_hours int default 168
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_email text := lower(trim(p_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Not allowed to invite' using errcode = '42501';
  end if;
  if p_role not in ('admin','member','viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 720 then
    raise exception 'Invalid expiry' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.workspace_members m join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id and lower(u.email) = v_email
  ) then
    raise exception 'That person is already a member' using errcode = '23505';
  end if;
  -- Re-inviting replaces any open invitation for the same address.
  update public.invitations set revoked_at = now()
   where workspace_id = p_workspace_id and email = v_email and accepted_at is null and revoked_at is null;

  -- 244 bits from pg_strong_random via two v4 UUIDs.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(hours => p_ttl_hours);

  insert into public.invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
  values (p_workspace_id, v_email, p_role, public.hash_invite_token(v_token), v_uid, v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  perform public.require_user();
  select workspace_id into v_ws from public.invitations where id = p_invitation_id;
  if v_ws is null or not public.can_manage_workspace(v_ws) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  update public.invitations set revoked_at = now()
   where id = p_invitation_id and accepted_at is null and revoked_at is null;
end;
$$;

-- Limited, non-sensitive preview for the invite landing page.
create or replace function public.get_invitation_preview(p_token text)
returns table (
  workspace_name text,
  workspace_icon text,
  workspace_color text,
  role text,
  inviter_name text,
  status text,
  email_matches boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_email text;
begin
  perform public.require_user();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  select * into v_inv from public.invitations where token_hash = public.hash_invite_token(p_token);
  if not found then
    return;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = (select auth.uid());
  return query
    select w.name, w.icon, w.color, v_inv.role, coalesce(p.display_name, 'A teammate'),
      case
        when v_inv.revoked_at is not null then 'revoked'
        when v_inv.accepted_at is not null then 'accepted'
        when v_inv.expires_at <= now() then 'expired'
        else 'pending'
      end,
      v_email = v_inv.email
    from public.workspaces w
    left join public.profiles p on p.id = v_inv.invited_by
    where w.id = v_inv.workspace_id;
end;
$$;

create or replace function public.accept_invitation_internal(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
begin
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'This invitation was revoked' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'This invitation was already used' using errcode = '42501';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired' using errcode = '42501';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;
  if v_confirmed is null then
    raise exception 'Verify your email address before accepting invitations' using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, v_uid, v_inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  update public.profiles
     set last_workspace_id = v_inv.workspace_id, onboarded_at = coalesce(onboarded_at, now())
   where id = v_uid;
  return v_inv.workspace_id;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.require_user();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  select id into v_id from public.invitations where token_hash = public.hash_invite_token(p_token);
  if v_id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  return public.accept_invitation_internal(v_id);
end;
$$;

-- Invitations addressed to the caller's verified email, for in-app acceptance.
create or replace function public.my_pending_invitations()
returns table (
  id uuid,
  workspace_id uuid,
  workspace_name text,
  workspace_icon text,
  workspace_color text,
  role text,
  inviter_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, w.id, w.name, w.icon, w.color, i.role, coalesce(p.display_name, 'A teammate'), i.expires_at
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  join auth.users u on u.id = (select auth.uid())
  left join public.profiles p on p.id = i.invited_by
  where i.email = lower(u.email)
    and u.email_confirmed_at is not null
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    and not exists (select 1 from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = u.id)
  order by i.created_at desc;
$$;

create or replace function public.accept_invitation_by_id(p_invitation_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.accept_invitation_internal(p_invitation_id);
$$;

create or replace function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.invitations i set revoked_at = now()
    from auth.users u
   where i.id = p_invitation_id and u.id = v_uid and i.email = lower(u.email)
     and i.accepted_at is null and i.revoked_at is null;
end;
$$;

-- Member list with emails visible to managers only.
create or replace function public.workspace_member_list(p_workspace_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_color text,
  role text,
  joined_at timestamptz,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean;
begin
  perform public.require_user();
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  v_manager := public.can_manage_workspace(p_workspace_id);
  return query
    select m.user_id, p.display_name, p.avatar_color, m.role, m.joined_at,
           case when v_manager or m.user_id = (select auth.uid()) then u.email::text else null end
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, p.display_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable anonymously.
-- ---------------------------------------------------------------------------

revoke execute on function public.create_workspace(text, text, text, text, text[]) from public, anon;
revoke execute on function public.delete_workspace(uuid) from public, anon;
revoke execute on function public.update_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.transfer_ownership(uuid, uuid) from public, anon;
revoke execute on function public.create_invitation(uuid, text, text, int) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.get_invitation_preview(text) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.accept_invitation_internal(uuid) from public, anon, authenticated;
revoke execute on function public.accept_invitation_by_id(uuid) from public, anon;
revoke execute on function public.my_pending_invitations() from public, anon;
revoke execute on function public.decline_invitation(uuid) from public, anon;
revoke execute on function public.workspace_member_list(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.create_workspace(text, text, text, text, text[]) to authenticated;
grant execute on function public.delete_workspace(uuid) to authenticated;
grant execute on function public.update_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.create_invitation(uuid, text, text, int) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.get_invitation_preview(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.accept_invitation_by_id(uuid) to authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
grant execute on function public.workspace_member_list(uuid) to authenticated;
