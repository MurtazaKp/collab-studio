-- Platform administration, plans and per-workspace subscriptions.
--
--   * `platform_admins` lists CollabVerse staff. Rows are granted only from the
--     database (SQL editor / service role); no client can write it. See
--     docs/ADMIN.md for granting the first admin.
--   * `plans` mirrors the marketing plans (apps/web/src/components/marketing/plans.ts)
--     and holds the limits enforced below. `workspace_subscriptions` assigns
--     each workspace a plan and a status; every workspace defaults to Free.
--   * Limits are enforced here, in triggers and SECURITY DEFINER functions, so
--     no client can skip them. The web app only mirrors them for UX.
--   * The admin console never uses the service-role key: every admin read and
--     write is an RPC that checks is_platform_admin() first and records the
--     change in `admin_audit_log`.
--
-- Errors raised for plan limits use SQLSTATE PT402 (PostgREST answers 402) and
-- read-only workspaces PT403, with a machine-readable HINT (`plan_*`) that the
-- web app maps to an "Upgrade" toast.

-- ---------------------------------------------------------------------------
-- Platform admins
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  granted_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
-- No policies: only the database owner and the service role can read or write it.
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.require_platform_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = v_uid) then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (char_length(trim(name)) between 1 and 40),
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  annual_price_cents integer check (annual_price_cents >= 0),
  -- NULL means unlimited.
  max_members integer check (max_members > 0),
  max_items_per_module integer check (max_items_per_module > 0),
  storage_mb integer not null check (storage_mb > 0),
  modules text[] not null
    check (cardinality(modules) between 1 and 8
      and modules <@ array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping']),
  audit_log boolean not null default false,
  priority_support boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

-- Derived from the pricing page. Free does not include "All 8 tools", so it
-- gets the four core tools; it also caps items per module (the pricing page
-- names no item limits for paid plans, so they are unlimited). Storage:
-- 100 MB / 10 GB / 50 GB. Documented in docs/ADMIN.md.
insert into public.plans
  (id, name, monthly_price_cents, annual_price_cents, max_members, max_items_per_module, storage_mb, modules, audit_log, priority_support, sort_order)
values
  ('free', 'Free', 0, null, 3, 25, 100, array['docs','kanban','chat','shopping'], false, false, 0),
  ('team', 'Team', 2900, 29000, 15, null, 10240,
    array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping'], false, false, 1),
  ('business', 'Business', 7900, 79000, 50, null, 51200,
    array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping'], true, true, 2);

alter table public.plans enable row level security;
create policy "plans: signed-in read" on public.plans
  for select to authenticated using (true);
revoke insert, update, delete on public.plans from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Subscriptions (one per workspace)
-- ---------------------------------------------------------------------------

create table public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  plan_id text not null default 'free' references public.plans (id) on delete restrict,
  status text not null default 'active'
    check (status in ('trialing','active','past_due','canceled','suspended')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  notes text not null default '' check (char_length(notes) <= 2000),
  -- ===================================================================
  -- BILLING PROVIDER SEAM. Nothing writes these yet. A future Stripe
  -- webhook handler (running server-side with the service role, never in
  -- the web app) stores its ids here and calls
  -- public.billing_apply_provider_update() below to set plan/status.
  -- ===================================================================
  billing_customer_id text check (char_length(billing_customer_id) <= 255),
  billing_subscription_id text check (char_length(billing_subscription_id) <= 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'trialing' or trial_ends_at is not null)
);

create index workspace_subscriptions_plan_idx on public.workspace_subscriptions (plan_id);
create index workspace_subscriptions_status_idx on public.workspace_subscriptions (status);

create trigger workspace_subscriptions_updated_at before update on public.workspace_subscriptions
  for each row execute function public.set_updated_at();

alter table public.workspace_subscriptions enable row level security;
-- No client policies: rows hold internal admin notes and billing ids. Members
-- see their plan through workspace_usage(); writes go through the admin RPCs
-- (or the billing seam) only.
revoke all on public.workspace_subscriptions from anon, authenticated;

create or replace function public.create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_subscriptions (workspace_id, plan_id, status)
  values (new.id, 'free', 'active')
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

create trigger workspaces_default_subscription after insert on public.workspaces
  for each row execute function public.create_default_subscription();

-- Backfill: every existing workspace starts on Free.
insert into public.workspace_subscriptions (workspace_id, plan_id, status)
select w.id, 'free', 'active' from public.workspaces w
on conflict (workspace_id) do nothing;


-- ---------------------------------------------------------------------------
-- Entitlements: what a workspace may do right now
-- ---------------------------------------------------------------------------

-- The effective plan. A lapsed trial falls back to Free (not read-only), and a
-- workspace without a subscription row (only possible mid-creation) is Free.
-- `trialing`, `active` and `past_due` (a grace period for failed payments)
-- are writable; `canceled` and `suspended` are read-only.
create or replace function public.workspace_entitlements(p_workspace_id uuid)
returns table (
  plan_id text,
  plan_name text,
  status text,
  trial_expired boolean,
  writable boolean,
  max_members integer,
  max_items_per_module integer,
  storage_mb integer,
  modules text[],
  monthly_price_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with sub as (
    select coalesce(s.plan_id, 'free') as plan_id,
           coalesce(s.status, 'active') as status,
           coalesce(s.status = 'trialing' and s.trial_ends_at <= now(), false) as trial_expired
    from (select 1) one
    left join public.workspace_subscriptions s on s.workspace_id = p_workspace_id
  )
  select p.id, p.name, sub.status, sub.trial_expired, sub.status in ('trialing','active','past_due'),
         p.max_members, p.max_items_per_module, p.storage_mb, p.modules, p.monthly_price_cents
  from sub
  join public.plans p on p.id = case when sub.trial_expired then 'free' else sub.plan_id end;
$$;

create or replace function public.module_label(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'docs' then 'Docs' when 'whiteboard' then 'Whiteboard' when 'kanban' then 'Kanban'
    when 'chat' then 'Chat' when 'mindmap' then 'Mindmap' when 'code' then 'Code'
    when 'playlist' then 'Playlist' when 'shopping' then 'TODO List' else p_module end;
$$;

create or replace function public.module_items_label(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'docs' then 'documents' when 'whiteboard' then 'whiteboards' when 'kanban' then 'boards'
    when 'chat' then 'channels' when 'mindmap' then 'mindmaps' when 'code' then 'code projects'
    when 'playlist' then 'playlists' when 'shopping' then 'to-do lists' else 'items' end;
$$;

create or replace function public.format_storage(p_mb integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_mb >= 1024 and p_mb % 1024 = 0 then (p_mb / 1024)::text || ' GB' else p_mb::text || ' MB' end;
$$;

create or replace function public.assert_workspace_writable(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_writable boolean;
begin
  select e.status, e.writable into v_status, v_writable from public.workspace_entitlements(p_workspace_id) e;
  if v_writable then
    return;
  end if;
  if v_status = 'suspended' then
    raise exception 'This workspace is suspended, so it''s read-only. Contact support to reactivate it.'
      using errcode = 'PT403', hint = 'plan_inactive';
  end if;
  raise exception 'This workspace''s subscription is canceled, so it''s read-only. Choose a plan to reactivate it.'
    using errcode = 'PT403', hint = 'plan_inactive';
end;
$$;

-- Called with the subscription row locked, so concurrent accepts can't overshoot.
create or replace function public.assert_member_capacity(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_members integer;
begin
  perform public.assert_workspace_writable(p_workspace_id);
  perform 1 from public.workspace_subscriptions where workspace_id = p_workspace_id for update;
  select * into e from public.workspace_entitlements(p_workspace_id);
  if e.max_members is null then
    return;
  end if;
  select count(*) into v_members from public.workspace_members where workspace_id = p_workspace_id;
  if v_members >= e.max_members then
    raise exception 'This workspace''s % plan allows up to % people. Upgrade to add more.', e.plan_name, e.max_members
      using errcode = 'PT402', hint = 'plan_member_limit';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enforcement triggers
-- ---------------------------------------------------------------------------

-- Guards every write to workspace content.
--   tg_argv[0]  module the table belongs to ('' for none): writes are refused
--               when the plan doesn't include it (deletes stay allowed so a
--               downgraded workspace can tidy up).
--   tg_argv[1]  'items' on the top-level item tables: inserts count against
--               the plan's max_items_per_module.
-- Only client requests are checked. Requests without a user (the collaboration
-- server, service-role jobs) and nested trigger work such as cascades or reply
-- counters (whose outer statement was already checked) pass through.
create or replace function public.enforce_workspace_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_module text := nullif(coalesce(tg_argv[0], ''), '');
  v_meter boolean := coalesce(tg_argv[1], '') = 'items';
  v_ws uuid;
  v_count integer;
  e record;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_ws := case when tg_table_name = 'workspaces' then (v_row ->> 'id')::uuid else (v_row ->> 'workspace_id')::uuid end;
  perform public.assert_workspace_writable(v_ws);
  select * into e from public.workspace_entitlements(v_ws);

  if v_module is not null and tg_op <> 'DELETE' and not (v_module = any (e.modules)) then
    raise exception '% isn''t included in the % plan. Upgrade to use it.', public.module_label(v_module), e.plan_name
      using errcode = 'PT402', hint = 'plan_module';
  end if;

  if v_meter and tg_op = 'INSERT' and e.max_items_per_module is not null then
    -- Serialise inserts per workspace so concurrent creates can't overshoot.
    perform 1 from public.workspace_subscriptions where workspace_id = v_ws for update;
    execute format('select count(*) from public.%I where workspace_id = $1', tg_table_name) into v_count using v_ws;
    if v_count >= e.max_items_per_module then
      raise exception 'This workspace''s % plan allows up to % %. Upgrade to add more.',
        e.plan_name, e.max_items_per_module, public.module_items_label(v_module)
        using errcode = 'PT402', hint = 'plan_item_limit';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Modules outside the plan can't be switched on. New workspaces are created
-- with every module requested, so on insert those are quietly turned off
-- instead (the settings page shows them as part of a paid plan).
create or replace function public.enforce_module_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if not new.enabled or (tg_op = 'UPDATE' and old.enabled) then
    return new;
  end if;
  select * into e from public.workspace_entitlements(new.workspace_id);
  if new.module_type = any (e.modules) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.enabled := false;
    return new;
  end if;
  raise exception '% isn''t included in the % plan. Upgrade to use it.', public.module_label(new.module_type), e.plan_name
    using errcode = 'PT402', hint = 'plan_module';
end;
$$;

-- File storage quota, checked when attachment metadata is recorded.
create or replace function public.enforce_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_used bigint;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  select * into e from public.workspace_entitlements(new.workspace_id);
  perform 1 from public.workspace_subscriptions where workspace_id = new.workspace_id for update;
  select coalesce(sum(size_bytes), 0) into v_used from public.attachments where workspace_id = new.workspace_id;
  if v_used + new.size_bytes > e.storage_mb::bigint * 1024 * 1024 then
    raise exception 'This workspace has used its % of file storage. Upgrade for more space.', public.format_storage(e.storage_mb)
      using errcode = 'PT402', hint = 'plan_storage';
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  -- Top-level items: module access, item limits and read-only.
  for r in select * from (values
    ('documents', 'docs'), ('whiteboards', 'whiteboard'), ('mindmaps', 'mindmap'), ('code_projects', 'code'),
    ('boards', 'kanban'), ('channels', 'chat'), ('playlists', 'playlist'), ('shopping_lists', 'shopping')
  ) as t(tbl, module) loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_workspace_plan(%L, %L)',
      r.tbl || '_plan', r.tbl, r.module, 'items');
  end loop;

  -- Content inside items: module access and read-only.
  for r in select * from (values
    ('board_columns', 'kanban'), ('tasks', 'kanban'), ('comments', 'kanban'),
    ('messages', 'chat'), ('message_reactions', 'chat'),
    ('playlist_items', 'playlist'), ('shopping_items', 'shopping'),
    ('attachments', ''), ('workspace_modules', '')
  ) as t(tbl, module) loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_workspace_plan(%L)',
      r.tbl || '_plan', r.tbl, r.module);
  end loop;
end;
$$;

-- Settings (name, icon, ownership) are frozen too; deleting a workspace is not.
create trigger workspaces_plan before update on public.workspaces
  for each row execute function public.enforce_workspace_plan('');

create trigger workspace_modules_module_plan before insert or update on public.workspace_modules
  for each row execute function public.enforce_module_plan();

create trigger attachments_storage_quota before insert on public.attachments
  for each row execute function public.enforce_storage_quota();

-- ---------------------------------------------------------------------------
-- Member limit on invitations (same bodies as 20261021000001, plus capacity)
-- ---------------------------------------------------------------------------

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
  -- A full workspace can't send invitations that could never be accepted.
  perform public.assert_member_capacity(p_workspace_id);

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
  if not exists (select 1 from public.workspace_members where workspace_id = v_inv.workspace_id and user_id = v_uid) then
    perform public.assert_member_capacity(v_inv.workspace_id);
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

-- ---------------------------------------------------------------------------
-- Collaboration server: read-only rooms when the workspace is read-only or the
-- plan no longer includes the module (same body as 20261021000005, but the
-- role is lowered to viewer; the server enforces readOnly for viewers and
-- re-checks open sessions, so suspension applies to live editors too).
-- ---------------------------------------------------------------------------

create or replace function collab.room_access(p_room_name text, p_user_id uuid)
returns table (
  room_id uuid,
  workspace_id uuid,
  kind text,
  entity_id uuid,
  title text,
  role text,
  module_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.workspace_id,
    r.kind,
    coalesce(r.document_id, r.whiteboard_id, r.mindmap_id, r.code_project_id),
    coalesce(d.title, wb.title, mm.title, cp.title, ''),
    case when e.writable and (case r.kind when 'document' then 'docs' else r.kind end) = any (e.modules)
         then m.role else 'viewer' end,
    coalesce(wm.enabled, false)
  from public.collaboration_rooms r
  join public.workspace_members m on m.workspace_id = r.workspace_id and m.user_id = p_user_id
  cross join lateral public.workspace_entitlements(r.workspace_id) e
  left join public.documents d on d.id = r.document_id
  left join public.whiteboards wb on wb.id = r.whiteboard_id
  left join public.mindmaps mm on mm.id = r.mindmap_id
  left join public.code_projects cp on cp.id = r.code_project_id
  left join public.workspace_modules wm
    on wm.workspace_id = r.workspace_id
   and wm.module_type = case r.kind when 'document' then 'docs' else r.kind end
  where r.name = p_room_name;
$$;

-- ---------------------------------------------------------------------------
-- Usage, for the workspace settings page (any member)
-- ---------------------------------------------------------------------------

create or replace function public.workspace_item_counts(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'docs', (select count(*) from public.documents where workspace_id = p_workspace_id),
    'whiteboard', (select count(*) from public.whiteboards where workspace_id = p_workspace_id),
    'kanban', (select count(*) from public.boards where workspace_id = p_workspace_id),
    'chat', (select count(*) from public.channels where workspace_id = p_workspace_id),
    'mindmap', (select count(*) from public.mindmaps where workspace_id = p_workspace_id),
    'code', (select count(*) from public.code_projects where workspace_id = p_workspace_id),
    'playlist', (select count(*) from public.playlists where workspace_id = p_workspace_id),
    'shopping', (select count(*) from public.shopping_lists where workspace_id = p_workspace_id)
  );
$$;

create or replace function public.workspace_usage(p_workspace_id uuid)
returns table (
  plan_id text,
  plan_name text,
  subscribed_plan_id text,
  status text,
  trial_ends_at timestamptz,
  trial_expired boolean,
  current_period_end timestamptz,
  writable boolean,
  monthly_price_cents integer,
  max_members integer,
  member_count integer,
  max_items_per_module integer,
  storage_mb integer,
  storage_bytes bigint,
  modules text[],
  usage jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_user();
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  return query
    select e.plan_id, e.plan_name, coalesce(s.plan_id, 'free'), e.status, s.trial_ends_at, e.trial_expired,
           s.current_period_end, e.writable, e.monthly_price_cents, e.max_members,
           (select count(*)::int from public.workspace_members m where m.workspace_id = p_workspace_id),
           e.max_items_per_module, e.storage_mb,
           (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a where a.workspace_id = p_workspace_id),
           e.modules, public.workspace_item_counts(p_workspace_id)
    from public.workspace_entitlements(p_workspace_id) e
    left join public.workspace_subscriptions s on s.workspace_id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- NULL actor: the database itself (SQL editor grants, billing webhooks).
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text not null default '',
  action text not null check (action in (
    'plan_changed','status_changed','trial_extended','notes_updated',
    'admin_granted','admin_revoked','billing_synced')),
  -- Kept (as a name snapshot) after the workspace is deleted.
  workspace_id uuid references public.workspaces (id) on delete set null,
  workspace_name text not null default '',
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192),
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_workspace_idx on public.admin_audit_log (workspace_id, created_at desc) where workspace_id is not null;
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id) where actor_id is not null;

alter table public.admin_audit_log enable row level security;
-- Append-only and only reachable through admin_list_audit_log().
revoke all on public.admin_audit_log from anon, authenticated;

create or replace function public.log_admin_action(p_action text, p_workspace_id uuid, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (actor_id, actor_email, action, workspace_id, workspace_name, details)
  values (
    (select auth.uid()),
    coalesce((select u.email from auth.users u where u.id = (select auth.uid())), ''),
    p_action,
    p_workspace_id,
    coalesce((select w.name from public.workspaces w where w.id = p_workspace_id), ''),
    coalesce(p_details, '{}'::jsonb)
  );
$$;

create or replace function public.audit_platform_admins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  perform public.log_admin_action(
    case when tg_op = 'DELETE' then 'admin_revoked' else 'admin_granted' end,
    null,
    jsonb_build_object('user_id', v_user,
      'email', coalesce((select u.email from auth.users u where u.id = v_user), '')));
  return null;
end;
$$;

create trigger platform_admins_audit after insert or delete on public.platform_admins
  for each row execute function public.audit_platform_admins();

-- ---------------------------------------------------------------------------
-- Admin RPCs. Each one calls require_platform_admin() before anything else.
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview()
returns table (
  total_workspaces bigint,
  total_users bigint,
  new_workspaces_30d bigint,
  active_trials bigint,
  mrr_cents bigint,
  by_plan jsonb,
  by_status jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    with subs as (
      select w.id, w.created_at, coalesce(s.plan_id, 'free') as plan_id, coalesce(s.status, 'active') as status,
             coalesce(s.status = 'trialing' and s.trial_ends_at <= now(), false) as trial_expired
      from public.workspaces w
      left join public.workspace_subscriptions s on s.workspace_id = w.id
    )
    select
      (select count(*) from subs),
      (select count(*) from public.profiles),
      (select count(*) from subs where created_at > now() - interval '30 days'),
      (select count(*) from subs where status = 'trialing' and not trial_expired),
      -- Estimated MRR: list price of every paying workspace (active or in the
      -- past_due grace period). Trials, canceled and suspended pay nothing.
      (select coalesce(sum(p.monthly_price_cents), 0)::bigint
         from subs join public.plans p on p.id = subs.plan_id
        where subs.status in ('active','past_due')),
      (select coalesce(jsonb_agg(jsonb_build_object(
                'plan_id', p.id, 'name', p.name, 'monthly_price_cents', p.monthly_price_cents,
                'workspaces', (select count(*) from subs where subs.plan_id = p.id),
                'paying', (select count(*) from subs where subs.plan_id = p.id and subs.status in ('active','past_due'))
              ) order by p.sort_order), '[]'::jsonb)
         from public.plans p),
      (select jsonb_object_agg(st, (select count(*) from subs where subs.status = st))
         from unnest(array['trialing','active','past_due','canceled','suspended']) st);
end;
$$;

create or replace function public.admin_list_workspaces(
  p_search text default '',
  p_plan_id text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  workspace_id uuid,
  name text,
  icon text,
  color text,
  created_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_email text,
  plan_id text,
  plan_name text,
  status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  member_count integer,
  item_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_pattern text;
begin
  perform public.require_platform_admin();
  if v_q is not null then
    v_pattern := '%' || replace(replace(replace(left(v_q, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select w.id, w.name, w.icon, w.color, w.created_at, w.owner_id,
           coalesce(p.display_name, ''), coalesce(u.email, '')::text,
           coalesce(s.plan_id, 'free'), coalesce(pl.name, 'Free'), coalesce(s.status, 'active'),
           s.trial_ends_at, s.current_period_end,
           (select count(*)::int from public.workspace_members m where m.workspace_id = w.id),
           (select coalesce(sum(c.value::int), 0)::int from jsonb_each_text(public.workspace_item_counts(w.id)) c),
           count(*) over ()
    from public.workspaces w
    left join public.workspace_subscriptions s on s.workspace_id = w.id
    left join public.plans pl on pl.id = s.plan_id
    left join public.profiles p on p.id = w.owner_id
    left join auth.users u on u.id = w.owner_id
    where (v_q is null or w.name ilike v_pattern or u.email ilike v_pattern or w.id::text = lower(v_q))
      and (p_plan_id is null or coalesce(s.plan_id, 'free') = p_plan_id)
      and (p_status is null or coalesce(s.status, 'active') = p_status)
    order by w.created_at desc, w.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_get_workspace(p_workspace_id uuid)
returns table (
  workspace_id uuid,
  name text,
  description text,
  icon text,
  color text,
  created_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_email text,
  plan_id text,
  effective_plan_id text,
  status text,
  trial_ends_at timestamptz,
  trial_expired boolean,
  current_period_end timestamptz,
  notes text,
  billing_customer_id text,
  billing_subscription_id text,
  subscription_updated_at timestamptz,
  max_members integer,
  max_items_per_module integer,
  storage_mb integer,
  modules text[],
  member_count integer,
  pending_invitations integer,
  storage_bytes bigint,
  usage jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  return query
    select w.id, w.name, w.description, w.icon, w.color, w.created_at, w.owner_id,
           coalesce(p.display_name, ''), coalesce(u.email, '')::text,
           coalesce(s.plan_id, 'free'), e.plan_id, e.status, s.trial_ends_at, e.trial_expired, s.current_period_end,
           coalesce(s.notes, ''), s.billing_customer_id, s.billing_subscription_id, s.updated_at,
           e.max_members, e.max_items_per_module, e.storage_mb, e.modules,
           (select count(*)::int from public.workspace_members m where m.workspace_id = w.id),
           (select count(*)::int from public.invitations i
             where i.workspace_id = w.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
           (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a where a.workspace_id = w.id),
           public.workspace_item_counts(w.id)
    from public.workspaces w
    cross join lateral public.workspace_entitlements(w.id) e
    left join public.workspace_subscriptions s on s.workspace_id = w.id
    left join public.profiles p on p.id = w.owner_id
    left join auth.users u on u.id = w.owner_id
    where w.id = p_workspace_id;
end;
$$;

create or replace function public.admin_workspace_members(p_workspace_id uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    select m.user_id, coalesce(p.display_name, ''), coalesce(u.email, '')::text, m.role, m.joined_at
    from public.workspace_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, m.joined_at;
end;
$$;

create or replace function public.admin_list_audit_log(p_workspace_id uuid default null, p_limit int default 50)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_email text,
  workspace_id uuid,
  workspace_name text,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    select l.id, l.created_at, l.action, l.actor_id, l.actor_email, l.workspace_id,
           coalesce(w.name, l.workspace_name), l.details
    from public.admin_audit_log l
    left join public.workspaces w on w.id = l.workspace_id
    where p_workspace_id is null or l.workspace_id = p_workspace_id
    order by l.created_at desc, l.id
    limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

-- Locks and returns the subscription, creating it if a workspace predates it.
create or replace function public.lock_subscription(p_workspace_id uuid)
returns public.workspace_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.workspace_subscriptions;
begin
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  insert into public.workspace_subscriptions (workspace_id) values (p_workspace_id) on conflict (workspace_id) do nothing;
  select * into v_sub from public.workspace_subscriptions where workspace_id = p_workspace_id for update;
  return v_sub;
end;
$$;

create or replace function public.admin_set_plan(p_workspace_id uuid, p_plan_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.workspace_subscriptions;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  v_sub := public.lock_subscription(p_workspace_id);
  if v_sub.plan_id = p_plan_id then
    return;
  end if;
  -- There is nothing to trial on Free, so a trial ends when moving there.
  update public.workspace_subscriptions
     set plan_id = p_plan_id,
         status = case when p_plan_id = 'free' and status = 'trialing' then 'active' else status end,
         trial_ends_at = case when p_plan_id = 'free' and status = 'trialing' then null else trial_ends_at end
   where workspace_id = p_workspace_id;
  perform public.log_admin_action('plan_changed', p_workspace_id,
    jsonb_build_object('from', v_sub.plan_id, 'to', p_plan_id));
end;
$$;

create or replace function public.admin_set_status(p_workspace_id uuid, p_status text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.workspace_subscriptions;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  perform public.require_platform_admin();
  -- Trials are started with admin_extend_trial(), which also sets the end date.
  if p_status is null or p_status not in ('active','past_due','canceled','suspended') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  v_sub := public.lock_subscription(p_workspace_id);
  if v_sub.status = p_status then
    return;
  end if;
  update public.workspace_subscriptions
     set status = p_status, trial_ends_at = null
   where workspace_id = p_workspace_id;
  perform public.log_admin_action('status_changed', p_workspace_id,
    jsonb_build_object('from', v_sub.status, 'to', p_status, 'reason', v_reason));
end;
$$;

create or replace function public.admin_extend_trial(p_workspace_id uuid, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.workspace_subscriptions;
  v_plan text;
  v_ends timestamptz;
begin
  perform public.require_platform_admin();
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Trial extensions must be 1 to 90 days' using errcode = '22023';
  end if;
  v_sub := public.lock_subscription(p_workspace_id);
  -- The marketed trial is a Team trial; paid plans keep their own plan.
  v_plan := case when v_sub.plan_id = 'free' then 'team' else v_sub.plan_id end;
  v_ends := greatest(coalesce(case when v_sub.status = 'trialing' then v_sub.trial_ends_at end, now()), now())
            + make_interval(days => p_days);
  update public.workspace_subscriptions
     set plan_id = v_plan, status = 'trialing', trial_ends_at = v_ends
   where workspace_id = p_workspace_id;
  perform public.log_admin_action('trial_extended', p_workspace_id,
    jsonb_build_object('days', p_days, 'plan_from', v_sub.plan_id, 'plan_to', v_plan,
      'status_from', v_sub.status, 'trial_ends_from', v_sub.trial_ends_at, 'trial_ends_to', v_ends));
  return v_ends;
end;
$$;

create or replace function public.admin_set_notes(p_workspace_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.workspace_subscriptions;
  v_notes text := trim(coalesce(p_notes, ''));
begin
  perform public.require_platform_admin();
  if char_length(v_notes) > 2000 then
    raise exception 'Notes can be at most 2000 characters' using errcode = '22023';
  end if;
  v_sub := public.lock_subscription(p_workspace_id);
  if v_sub.notes = v_notes then
    return;
  end if;
  update public.workspace_subscriptions set notes = v_notes where workspace_id = p_workspace_id;
  perform public.log_admin_action('notes_updated', p_workspace_id,
    jsonb_build_object('before', left(v_sub.notes, 500), 'after', left(v_notes, 500)));
end;
$$;

-- ===========================================================================
-- BILLING PROVIDER SEAM (not wired up).
-- A future Stripe webhook handler, running with the service role outside the
-- web app (e.g. a Supabase Edge Function that verifies the Stripe signature),
-- maps checkout.session.completed / customer.subscription.updated / .deleted
-- and invoice.payment_failed to a plan and status and calls this function.
-- Until then plans and statuses are changed by platform admins only.
-- ===========================================================================
create or replace function public.billing_apply_provider_update(
  p_workspace_id uuid,
  p_plan_id text,
  p_status text,
  p_current_period_end timestamptz default null,
  p_customer_id text default null,
  p_subscription_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.workspace_subscriptions;
begin
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active','past_due','canceled') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  v_sub := public.lock_subscription(p_workspace_id);
  -- A suspension is a platform decision; billing events never lift it.
  update public.workspace_subscriptions
     set plan_id = p_plan_id,
         status = case when status = 'suspended' then status else p_status end,
         trial_ends_at = null,
         current_period_end = p_current_period_end,
         billing_customer_id = coalesce(p_customer_id, billing_customer_id),
         billing_subscription_id = coalesce(p_subscription_id, billing_subscription_id)
   where workspace_id = p_workspace_id;
  perform public.log_admin_action('billing_synced', p_workspace_id,
    jsonb_build_object('plan_from', v_sub.plan_id, 'plan_to', p_plan_id, 'status_from', v_sub.status, 'status_to', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

-- Internal helpers: triggers and other definer functions only.
revoke execute on function public.require_platform_admin() from public, anon, authenticated;
revoke execute on function public.create_default_subscription() from public, anon, authenticated;
revoke execute on function public.workspace_entitlements(uuid) from public, anon, authenticated;
revoke execute on function public.module_label(text) from public, anon, authenticated;
revoke execute on function public.module_items_label(text) from public, anon, authenticated;
revoke execute on function public.format_storage(integer) from public, anon, authenticated;
revoke execute on function public.assert_workspace_writable(uuid) from public, anon, authenticated;
revoke execute on function public.assert_member_capacity(uuid) from public, anon, authenticated;
revoke execute on function public.enforce_workspace_plan() from public, anon, authenticated;
revoke execute on function public.enforce_module_plan() from public, anon, authenticated;
revoke execute on function public.enforce_storage_quota() from public, anon, authenticated;
revoke execute on function public.workspace_item_counts(uuid) from public, anon, authenticated;
revoke execute on function public.log_admin_action(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_platform_admins() from public, anon, authenticated;
revoke execute on function public.lock_subscription(uuid) from public, anon, authenticated;
revoke execute on function public.billing_apply_provider_update(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;

-- Callable by signed-in users; the admin ones re-check is_platform_admin().
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.workspace_usage(uuid) from public, anon;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_list_workspaces(text, text, text, int, int) from public, anon;
revoke execute on function public.admin_get_workspace(uuid) from public, anon;
revoke execute on function public.admin_workspace_members(uuid) from public, anon;
revoke execute on function public.admin_list_audit_log(uuid, int) from public, anon;
revoke execute on function public.admin_set_plan(uuid, text) from public, anon;
revoke execute on function public.admin_set_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_extend_trial(uuid, int) from public, anon;
revoke execute on function public.admin_set_notes(uuid, text) from public, anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.workspace_usage(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_workspaces(text, text, text, int, int) to authenticated;
grant execute on function public.admin_get_workspace(uuid) to authenticated;
grant execute on function public.admin_workspace_members(uuid) to authenticated;
grant execute on function public.admin_list_audit_log(uuid, int) to authenticated;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;
grant execute on function public.admin_set_status(uuid, text, text) to authenticated;
grant execute on function public.admin_extend_trial(uuid, int) to authenticated;
grant execute on function public.admin_set_notes(uuid, text) to authenticated;

-- The billing seam is for the service role only.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.billing_apply_provider_update(uuid, text, text, timestamptz, text, text) to service_role;
  end if;
end;
$$;
