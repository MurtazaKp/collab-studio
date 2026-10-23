-- Plans belong to the customer (account), not to each workspace.
--
--   * `account_subscriptions` holds one plan and status per user. Every
--     workspace a user owns runs on its owner's plan, so a new workspace never
--     starts on Free just because it is new.
--   * `plans.max_workspaces` caps how many workspaces an account may own
--     (NULL = unlimited): Free 1, Team 3, Business 10, Custom unlimited.
--   * New `custom` plan: every limit unlimited, all tools, price agreed per
--     customer (`account_subscriptions.custom_price_cents`).
--   * `workspace_subscriptions` (20261023000009) is folded into
--     `account_subscriptions` (each owner keeps the best plan any of their
--     workspaces had) and dropped. Admin RPCs are now keyed by customer.
--   * Modules that were switched off only because a plan lacked them are
--     flagged (`workspace_modules.plan_disabled`) and switched back on when the
--     account's plan includes them.
--
-- Same error contract as before: SQLSTATE PT402 / PT403 with a `plan_*` HINT.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

alter table public.plans add column max_workspaces integer check (max_workspaces > 0);
-- NULL storage now means unlimited (Custom).
alter table public.plans alter column storage_mb drop not null;

update public.plans set max_workspaces = 1 where id = 'free';
update public.plans set max_workspaces = 3 where id = 'team';
update public.plans set max_workspaces = 10 where id = 'business';

insert into public.plans
  (id, name, monthly_price_cents, annual_price_cents, max_members, max_items_per_module, storage_mb, max_workspaces,
   modules, audit_log, priority_support, sort_order)
values
  ('custom', 'Custom', 0, null, null, null, null, null,
   array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping'], true, true, 3);

-- ---------------------------------------------------------------------------
-- Account subscriptions (one per user)
-- ---------------------------------------------------------------------------

create table public.account_subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_id text not null default 'free' references public.plans (id) on delete restrict,
  status text not null default 'active'
    check (status in ('trialing','active','past_due','canceled','suspended')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  -- Monthly price for the Custom plan; other plans use their list price.
  custom_price_cents integer check (custom_price_cents >= 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  -- ===================================================================
  -- BILLING PROVIDER SEAM. Nothing writes these yet; a future Stripe
  -- webhook (service role, outside the web app) stores its ids here and
  -- calls public.billing_apply_provider_update() below.
  -- ===================================================================
  billing_customer_id text check (char_length(billing_customer_id) <= 255),
  billing_subscription_id text check (char_length(billing_subscription_id) <= 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'trialing' or trial_ends_at is not null)
);

create index account_subscriptions_plan_idx on public.account_subscriptions (plan_id);
create index account_subscriptions_status_idx on public.account_subscriptions (status);

create trigger account_subscriptions_updated_at before update on public.account_subscriptions
  for each row execute function public.set_updated_at();

alter table public.account_subscriptions enable row level security;
-- No client policies: rows hold internal notes and billing ids. Members see
-- the plan through workspace_usage(); writes go through the admin RPCs only.
revoke all on public.account_subscriptions from anon, authenticated;

create or replace function public.create_default_account_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_default_subscription after insert on public.profiles
  for each row execute function public.create_default_account_subscription();

-- Backfill: every account, then each owner's best workspace plan (writable
-- statuses first, then the highest plan, then the most recently changed).
insert into public.account_subscriptions (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

update public.account_subscriptions a
   set plan_id = b.plan_id,
       status = b.status,
       trial_ends_at = b.trial_ends_at,
       current_period_end = b.current_period_end,
       billing_customer_id = b.billing_customer_id,
       billing_subscription_id = b.billing_subscription_id
  from (
    select distinct on (w.owner_id) w.owner_id, s.plan_id, s.status, s.trial_ends_at, s.current_period_end,
           s.billing_customer_id, s.billing_subscription_id
    from public.workspace_subscriptions s
    join public.workspaces w on w.id = s.workspace_id
    join public.plans p on p.id = s.plan_id
    order by w.owner_id,
             (s.status in ('trialing','active','past_due') and not (s.status = 'trialing' and s.trial_ends_at <= now())) desc,
             p.sort_order desc,
             s.updated_at desc
  ) b
 where a.user_id = b.owner_id;

-- Keep every workspace's admin notes, labelled by workspace.
update public.account_subscriptions a
   set notes = left(b.notes, 2000)
  from (
    select w.owner_id, string_agg(w.name || ': ' || s.notes, E'\n' order by w.created_at) as notes
    from public.workspace_subscriptions s
    join public.workspaces w on w.id = s.workspace_id
    where s.notes <> ''
    group by w.owner_id
  ) b
 where a.user_id = b.owner_id;

-- ---------------------------------------------------------------------------
-- Entitlements
-- ---------------------------------------------------------------------------

-- What an account may do right now. A lapsed trial falls back to Free; an
-- account without a row (or a NULL user) is Free. `trialing`, `active` and
-- `past_due` are writable; `canceled` and `suspended` are read-only.
create or replace function public.account_entitlements(p_user_id uuid)
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
  monthly_price_cents integer,
  max_workspaces integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with sub as (
    select coalesce(s.plan_id, 'free') as plan_id,
           coalesce(s.status, 'active') as status,
           coalesce(s.status = 'trialing' and s.trial_ends_at <= now(), false) as trial_expired,
           s.custom_price_cents
    from (select 1) one
    left join public.account_subscriptions s on s.user_id = p_user_id
  )
  select p.id, p.name, sub.status, sub.trial_expired, sub.status in ('trialing','active','past_due'),
         p.max_members, p.max_items_per_module, p.storage_mb, p.modules,
         case when p.id = 'custom' then coalesce(sub.custom_price_cents, 0) else p.monthly_price_cents end,
         p.max_workspaces
  from sub
  join public.plans p on p.id = case when sub.trial_expired then 'free' else sub.plan_id end;
$$;

-- A workspace runs on its owner's plan. Same columns as before, so every
-- caller (triggers, collab.room_access) keeps working unchanged.
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
  select e.plan_id, e.plan_name, e.status, e.trial_expired, e.writable,
         e.max_members, e.max_items_per_module, e.storage_mb, e.modules, e.monthly_price_cents
  from (select 1) one
  left join public.workspaces w on w.id = p_workspace_id
  cross join lateral public.account_entitlements(w.owner_id) e;
$$;

-- Serialises limit checks for one account (replaces the per-workspace lock).
create or replace function public.lock_workspace_account(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select 1 from public.account_subscriptions a
  join public.workspaces w on w.owner_id = a.user_id
  where w.id = p_workspace_id
  for update of a;
$$;

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
  perform public.lock_workspace_account(p_workspace_id);
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
    perform public.lock_workspace_account(v_ws);
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

-- Modules outside the plan can't be switched on. On insert (a new workspace
-- requests every module) they are quietly turned off and flagged, so they come
-- back on by themselves after an upgrade. Switching a module on clears the flag.
alter table public.workspace_modules add column plan_disabled boolean not null default false;

create or replace function public.enforce_module_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  if new.enabled then
    new.plan_disabled := false;
  end if;
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
    new.plan_disabled := true;
    return new;
  end if;
  raise exception '% isn''t included in the % plan. Upgrade to use it.', public.module_label(new.module_type), e.plan_name
    using errcode = 'PT402', hint = 'plan_module';
end;
$$;

-- Before this migration every workspace started on Free, so a switched-off
-- module outside Free was almost always switched off by the plan.
update public.workspace_modules
   set plan_disabled = true
 where not enabled and module_type <> all (array['docs','kanban','chat','shopping']);

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
  if e.storage_mb is null then
    return new;
  end if;
  perform public.lock_workspace_account(new.workspace_id);
  select coalesce(sum(size_bytes), 0) into v_used from public.attachments where workspace_id = new.workspace_id;
  if v_used + new.size_bytes > e.storage_mb::bigint * 1024 * 1024 then
    raise exception 'This workspace has used its % of file storage. Upgrade for more space.', public.format_storage(e.storage_mb)
      using errcode = 'PT402', hint = 'plan_storage';
  end if;
  return new;
end;
$$;

-- Workspaces an account may own: checked on create and on ownership transfer.
create or replace function public.enforce_workspace_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_owned integer;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.owner_id = old.owner_id then
    return new;
  end if;
  perform 1 from public.account_subscriptions where user_id = new.owner_id for update;
  select * into e from public.account_entitlements(new.owner_id);
  if not e.writable then
    raise exception '%', case
      when tg_op = 'UPDATE' then 'The new owner''s account is ' || e.status || ', so it can''t take over workspaces.'
      else 'Your account is ' || e.status || ', so you can''t create workspaces. Contact support to reactivate it.' end
      using errcode = 'PT403', hint = 'plan_inactive';
  end if;
  if e.max_workspaces is null then
    return new;
  end if;
  select count(*) into v_owned from public.workspaces where owner_id = new.owner_id and id <> new.id;
  if v_owned >= e.max_workspaces then
    raise exception '%', case
      when tg_op = 'UPDATE' then format('The new owner''s %s plan allows up to %s workspace%s.', e.plan_name, e.max_workspaces,
        case when e.max_workspaces = 1 then '' else 's' end)
      else format('Your %s plan allows up to %s workspace%s. Upgrade to create more.', e.plan_name, e.max_workspaces,
        case when e.max_workspaces = 1 then '' else 's' end) end
      using errcode = 'PT402', hint = 'plan_workspace_limit';
  end if;
  return new;
end;
$$;

create trigger workspaces_count before insert or update of owner_id on public.workspaces
  for each row execute function public.enforce_workspace_count();

-- The plan now decides how many workspaces someone may own, so the fixed cap
-- of 20 from 20261021000001 goes (same body otherwise).
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
begin
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

-- Turns back on the modules a plan had switched off, in every workspace the
-- account owns, once the plan includes them and the account is writable.
create or replace function public.reenable_plan_modules(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.workspace_modules wm
     set enabled = true, plan_disabled = false
    from public.workspaces w, public.account_entitlements(p_user_id) e
   where w.id = wm.workspace_id
     and w.owner_id = p_user_id
     and wm.plan_disabled
     and not wm.enabled
     and e.writable
     and wm.module_type = any (e.modules);
$$;

-- Apply to everyone now (this is how a workspace created on Free gets its
-- tools back once its owner's account is on a bigger plan).
select public.reenable_plan_modules(a.user_id) from public.account_subscriptions a;

-- ---------------------------------------------------------------------------
-- Usage, for the workspace settings page (any member)
-- ---------------------------------------------------------------------------

drop function public.workspace_usage(uuid);

create function public.workspace_usage(p_workspace_id uuid)
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
  usage jsonb,
  max_workspaces integer,
  owner_workspace_count integer,
  owner_name text,
  is_owner boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_owner uuid;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  select w.owner_id into v_owner from public.workspaces w where w.id = p_workspace_id;
  return query
    select e.plan_id, e.plan_name, coalesce(s.plan_id, 'free'), e.status, s.trial_ends_at, e.trial_expired,
           s.current_period_end, e.writable, e.monthly_price_cents, e.max_members,
           (select count(*)::int from public.workspace_members m where m.workspace_id = p_workspace_id),
           e.max_items_per_module, e.storage_mb,
           (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a where a.workspace_id = p_workspace_id),
           e.modules, public.workspace_item_counts(p_workspace_id),
           e.max_workspaces,
           (select count(*)::int from public.workspaces w where w.owner_id = v_owner),
           coalesce((select p.display_name from public.profiles p where p.id = v_owner), ''),
           v_owner = v_uid
    from public.account_entitlements(v_owner) e
    left join public.account_subscriptions s on s.user_id = v_owner;
end;
$$;

-- The signed-in user's own plan, for the "new workspace" form: which tools a
-- new workspace gets and how many more workspaces they can create.
create or replace function public.my_account_plan()
returns table (
  plan_id text,
  plan_name text,
  status text,
  writable boolean,
  modules text[],
  max_workspaces integer,
  workspace_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.plan_id, e.plan_name, e.status, e.writable, e.modules, e.max_workspaces,
         (select count(*)::int from public.workspaces w where w.owner_id = (select auth.uid()))
  from public.account_entitlements((select auth.uid())) e
  where (select auth.uid()) is not null;
$$;

-- ---------------------------------------------------------------------------
-- Audit log: entries now name the customer (account) they concern
-- ---------------------------------------------------------------------------

alter table public.admin_audit_log
  add column subject_user_id uuid references public.profiles (id) on delete set null,
  add column subject_email text not null default '';

create index admin_audit_log_subject_idx on public.admin_audit_log (subject_user_id, created_at desc) where subject_user_id is not null;

update public.admin_audit_log l
   set subject_user_id = w.owner_id,
       subject_email = coalesce((select u.email from auth.users u where u.id = w.owner_id), '')
  from public.workspaces w
 where w.id = l.workspace_id and l.subject_user_id is null;

alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check check (action in (
  'plan_changed','status_changed','trial_extended','notes_updated','custom_price_set',
  'admin_granted','admin_revoked','billing_synced'));

drop function public.log_admin_action(text, uuid, jsonb);

create function public.log_admin_action(p_action text, p_subject_user_id uuid, p_workspace_id uuid, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log
    (actor_id, actor_email, action, subject_user_id, subject_email, workspace_id, workspace_name, details)
  values (
    (select auth.uid()),
    coalesce((select u.email from auth.users u where u.id = (select auth.uid())), ''),
    p_action,
    p_subject_user_id,
    coalesce((select u.email from auth.users u where u.id = p_subject_user_id), ''),
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
    v_user,
    null,
    jsonb_build_object('user_id', v_user,
      'email', coalesce((select u.email from auth.users u where u.id = v_user), '')));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace the per-workspace admin RPCs and the old subscription table
-- ---------------------------------------------------------------------------

drop function public.admin_overview();
drop function public.admin_list_workspaces(text, text, text, int, int);
drop function public.admin_get_workspace(uuid);
drop function public.admin_list_audit_log(uuid, int);
drop function public.admin_set_plan(uuid, text);
drop function public.admin_set_status(uuid, text, text);
drop function public.admin_extend_trial(uuid, int);
drop function public.admin_set_notes(uuid, text);
drop function public.billing_apply_provider_update(uuid, text, text, timestamptz, text, text);
drop function public.lock_subscription(uuid);
drop trigger workspaces_default_subscription on public.workspaces;
drop function public.create_default_subscription();
drop table public.workspace_subscriptions;

-- Accounts that count as customers: they own a workspace or have a plan/status
-- an admin set. (Everyone else is a signed-up user who only joins others.)
create or replace function public.admin_overview()
returns table (
  total_customers bigint,
  total_workspaces bigint,
  total_users bigint,
  new_customers_30d bigint,
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
    with acc as (
      select pr.id, pr.created_at, coalesce(s.plan_id, 'free') as plan_id, coalesce(s.status, 'active') as status,
             coalesce(s.status = 'trialing' and s.trial_ends_at <= now(), false) as trial_expired,
             s.custom_price_cents,
             (select count(*) from public.workspaces w where w.owner_id = pr.id) as workspaces
      from public.profiles pr
      left join public.account_subscriptions s on s.user_id = pr.id
    ),
    cust as (
      select * from acc where workspaces > 0 or plan_id <> 'free' or status <> 'active'
    )
    select
      (select count(*) from cust),
      (select count(*) from public.workspaces),
      (select count(*) from acc),
      (select count(*) from cust where created_at > now() - interval '30 days'),
      (select count(*) from cust where status = 'trialing' and not trial_expired),
      -- Estimated MRR: every paying account (active or in the past_due grace
      -- period) at its list price, or its agreed price on Custom.
      (select coalesce(sum(case when p.id = 'custom' then coalesce(cust.custom_price_cents, 0) else p.monthly_price_cents end), 0)::bigint
         from cust join public.plans p on p.id = cust.plan_id
        where cust.status in ('active','past_due')),
      (select coalesce(jsonb_agg(jsonb_build_object(
                'plan_id', p.id, 'name', p.name, 'monthly_price_cents', p.monthly_price_cents,
                'customers', (select count(*) from cust where cust.plan_id = p.id),
                'paying', (select count(*) from cust where cust.plan_id = p.id and cust.status in ('active','past_due')),
                'workspaces', (select coalesce(sum(cust.workspaces), 0) from cust where cust.plan_id = p.id),
                -- Custom prices differ per customer, so revenue is summed here.
                'mrr_cents', (select coalesce(sum(case when p.id = 'custom' then coalesce(cust.custom_price_cents, 0) else p.monthly_price_cents end), 0)
                                from cust where cust.plan_id = p.id and cust.status in ('active','past_due'))
              ) order by p.sort_order), '[]'::jsonb)
         from public.plans p),
      (select jsonb_object_agg(st, (select count(*) from cust where cust.status = st))
         from unnest(array['trialing','active','past_due','canceled','suspended']) st);
end;
$$;

create or replace function public.admin_list_customers(
  p_search text default '',
  p_plan_id text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  user_id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  plan_id text,
  plan_name text,
  status text,
  trial_ends_at timestamptz,
  custom_price_cents integer,
  workspace_count integer,
  max_workspaces integer,
  member_count integer,
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
    with acc as (
      select pr.id, pr.display_name, coalesce(u.email, '')::text as email, pr.created_at,
             coalesce(s.plan_id, 'free') as plan_id, coalesce(s.status, 'active') as status,
             s.trial_ends_at, s.custom_price_cents,
             (select count(*)::int from public.workspaces w where w.owner_id = pr.id) as workspace_count
      from public.profiles pr
      left join auth.users u on u.id = pr.id
      left join public.account_subscriptions s on s.user_id = pr.id
    )
    select acc.id, acc.display_name, acc.email, acc.created_at, acc.plan_id, pl.name, acc.status,
           acc.trial_ends_at, acc.custom_price_cents, acc.workspace_count, pl.max_workspaces,
           (select count(distinct m.user_id)::int from public.workspace_members m
              join public.workspaces w on w.id = m.workspace_id where w.owner_id = acc.id),
           count(*) over ()
    from acc
    join public.plans pl on pl.id = acc.plan_id
    where (
            -- Searching finds any account (so an admin can upgrade someone
            -- before they create a workspace); the default list is customers.
            case when v_q is null
              then acc.workspace_count > 0 or acc.plan_id <> 'free' or acc.status <> 'active'
              else acc.display_name ilike v_pattern or acc.email ilike v_pattern or acc.id::text = lower(v_q)
                   or exists (select 1 from public.workspaces w where w.owner_id = acc.id and w.name ilike v_pattern)
            end
          )
      and (p_plan_id is null or acc.plan_id = p_plan_id)
      and (p_status is null or acc.status = p_status)
    order by acc.created_at desc, acc.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_get_customer(p_user_id uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  plan_id text,
  effective_plan_id text,
  status text,
  trial_ends_at timestamptz,
  trial_expired boolean,
  current_period_end timestamptz,
  custom_price_cents integer,
  monthly_price_cents integer,
  notes text,
  billing_customer_id text,
  billing_subscription_id text,
  subscription_updated_at timestamptz,
  max_workspaces integer,
  max_members integer,
  max_items_per_module integer,
  storage_mb integer,
  modules text[],
  workspace_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.profiles pr where pr.id = p_user_id) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  return query
    select pr.id, pr.display_name, coalesce(u.email, '')::text, pr.created_at,
           coalesce(s.plan_id, 'free'), e.plan_id, e.status, s.trial_ends_at, e.trial_expired, s.current_period_end,
           s.custom_price_cents, e.monthly_price_cents, coalesce(s.notes, ''),
           s.billing_customer_id, s.billing_subscription_id, s.updated_at,
           e.max_workspaces, e.max_members, e.max_items_per_module, e.storage_mb, e.modules,
           (select count(*)::int from public.workspaces w where w.owner_id = pr.id)
    from public.profiles pr
    cross join lateral public.account_entitlements(pr.id) e
    left join auth.users u on u.id = pr.id
    left join public.account_subscriptions s on s.user_id = pr.id
    where pr.id = p_user_id;
end;
$$;

create or replace function public.admin_customer_workspaces(p_user_id uuid)
returns table (
  workspace_id uuid,
  name text,
  icon text,
  color text,
  created_at timestamptz,
  member_count integer,
  pending_invitations integer,
  item_count integer,
  storage_bytes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    select w.id, w.name, w.icon, w.color, w.created_at,
           (select count(*)::int from public.workspace_members m where m.workspace_id = w.id),
           (select count(*)::int from public.invitations i
             where i.workspace_id = w.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
           (select coalesce(sum(c.value::int), 0)::int from jsonb_each_text(public.workspace_item_counts(w.id)) c),
           (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a where a.workspace_id = w.id)
    from public.workspaces w
    where w.owner_id = p_user_id
    order by w.created_at;
end;
$$;

create or replace function public.admin_list_audit_log(p_user_id uuid default null, p_limit int default 50)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_email text,
  subject_user_id uuid,
  subject_email text,
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
    select l.id, l.created_at, l.action, l.actor_id, l.actor_email, l.subject_user_id,
           coalesce((select u.email from auth.users u where u.id = l.subject_user_id), l.subject_email)::text,
           l.workspace_id, coalesce(w.name, l.workspace_name), l.details
    from public.admin_audit_log l
    left join public.workspaces w on w.id = l.workspace_id
    where p_user_id is null or l.subject_user_id = p_user_id
    order by l.created_at desc, l.id
    limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

-- Locks and returns the account's subscription, creating it if missing.
create or replace function public.lock_account(p_user_id uuid)
returns public.account_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.account_subscriptions;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  insert into public.account_subscriptions (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_sub from public.account_subscriptions where user_id = p_user_id for update;
  return v_sub;
end;
$$;

create or replace function public.admin_set_plan(p_user_id uuid, p_plan_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.account_subscriptions;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  v_sub := public.lock_account(p_user_id);
  if v_sub.plan_id = p_plan_id then
    return;
  end if;
  -- There is nothing to trial on Free, so a trial ends when moving there.
  update public.account_subscriptions
     set plan_id = p_plan_id,
         status = case when p_plan_id = 'free' and status = 'trialing' then 'active' else status end,
         trial_ends_at = case when p_plan_id = 'free' and status = 'trialing' then null else trial_ends_at end
   where user_id = p_user_id;
  perform public.reenable_plan_modules(p_user_id);
  perform public.log_admin_action('plan_changed', p_user_id, null,
    jsonb_build_object('from', v_sub.plan_id, 'to', p_plan_id));
end;
$$;

create or replace function public.admin_set_status(p_user_id uuid, p_status text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.account_subscriptions;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  perform public.require_platform_admin();
  -- Trials are started with admin_extend_trial(), which also sets the end date.
  if p_status is null or p_status not in ('active','past_due','canceled','suspended') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  v_sub := public.lock_account(p_user_id);
  if v_sub.status = p_status then
    return;
  end if;
  update public.account_subscriptions set status = p_status, trial_ends_at = null where user_id = p_user_id;
  perform public.reenable_plan_modules(p_user_id);
  perform public.log_admin_action('status_changed', p_user_id, null,
    jsonb_build_object('from', v_sub.status, 'to', p_status, 'reason', v_reason));
end;
$$;

create or replace function public.admin_extend_trial(p_user_id uuid, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.account_subscriptions;
  v_plan text;
  v_ends timestamptz;
begin
  perform public.require_platform_admin();
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Trial extensions must be 1 to 90 days' using errcode = '22023';
  end if;
  v_sub := public.lock_account(p_user_id);
  -- The marketed trial is a Team trial; paid plans keep their own plan.
  v_plan := case when v_sub.plan_id = 'free' then 'team' else v_sub.plan_id end;
  v_ends := greatest(coalesce(case when v_sub.status = 'trialing' then v_sub.trial_ends_at end, now()), now())
            + make_interval(days => p_days);
  update public.account_subscriptions
     set plan_id = v_plan, status = 'trialing', trial_ends_at = v_ends
   where user_id = p_user_id;
  perform public.reenable_plan_modules(p_user_id);
  perform public.log_admin_action('trial_extended', p_user_id, null,
    jsonb_build_object('days', p_days, 'plan_from', v_sub.plan_id, 'plan_to', v_plan,
      'status_from', v_sub.status, 'trial_ends_from', v_sub.trial_ends_at, 'trial_ends_to', v_ends));
  return v_ends;
end;
$$;

create or replace function public.admin_set_notes(p_user_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.account_subscriptions;
  v_notes text := trim(coalesce(p_notes, ''));
begin
  perform public.require_platform_admin();
  if char_length(v_notes) > 2000 then
    raise exception 'Notes can be at most 2000 characters' using errcode = '22023';
  end if;
  v_sub := public.lock_account(p_user_id);
  if v_sub.notes = v_notes then
    return;
  end if;
  update public.account_subscriptions set notes = v_notes where user_id = p_user_id;
  perform public.log_admin_action('notes_updated', p_user_id, null,
    jsonb_build_object('before', left(v_sub.notes, 500), 'after', left(v_notes, 500)));
end;
$$;

-- Monthly price for a Custom-plan customer, in cents (NULL clears it).
create or replace function public.admin_set_custom_price(p_user_id uuid, p_cents int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.account_subscriptions;
begin
  perform public.require_platform_admin();
  if p_cents is not null and (p_cents < 0 or p_cents > 100000000) then
    raise exception 'Price must be between $0 and $1,000,000 a month' using errcode = '22023';
  end if;
  v_sub := public.lock_account(p_user_id);
  if v_sub.custom_price_cents is not distinct from p_cents then
    return;
  end if;
  update public.account_subscriptions set custom_price_cents = p_cents where user_id = p_user_id;
  perform public.log_admin_action('custom_price_set', p_user_id, null,
    jsonb_build_object('from', v_sub.custom_price_cents, 'to', p_cents));
end;
$$;

-- ===========================================================================
-- BILLING PROVIDER SEAM (not wired up). A future Stripe webhook handler,
-- running with the service role outside the web app, maps subscription events
-- to a plan and status for the customer's account and calls this function.
-- ===========================================================================
create or replace function public.billing_apply_provider_update(
  p_user_id uuid,
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
  v_sub public.account_subscriptions;
begin
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active','past_due','canceled') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  v_sub := public.lock_account(p_user_id);
  -- A suspension is a platform decision; billing events never lift it.
  update public.account_subscriptions
     set plan_id = p_plan_id,
         status = case when status = 'suspended' then status else p_status end,
         trial_ends_at = null,
         current_period_end = p_current_period_end,
         billing_customer_id = coalesce(p_customer_id, billing_customer_id),
         billing_subscription_id = coalesce(p_subscription_id, billing_subscription_id)
   where user_id = p_user_id;
  perform public.reenable_plan_modules(p_user_id);
  perform public.log_admin_action('billing_synced', p_user_id, null,
    jsonb_build_object('plan_from', v_sub.plan_id, 'plan_to', p_plan_id, 'status_from', v_sub.status, 'status_to', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

-- Internal helpers: triggers and other definer functions only.
revoke execute on function public.create_default_account_subscription() from public, anon, authenticated;
revoke execute on function public.account_entitlements(uuid) from public, anon, authenticated;
revoke execute on function public.lock_workspace_account(uuid) from public, anon, authenticated;
revoke execute on function public.enforce_workspace_count() from public, anon, authenticated;
revoke execute on function public.reenable_plan_modules(uuid) from public, anon, authenticated;
revoke execute on function public.log_admin_action(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.lock_account(uuid) from public, anon, authenticated;
revoke execute on function public.billing_apply_provider_update(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;

-- Callable by signed-in users; the admin ones re-check is_platform_admin().
revoke execute on function public.workspace_usage(uuid) from public, anon;
revoke execute on function public.my_account_plan() from public, anon;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_list_customers(text, text, text, int, int) from public, anon;
revoke execute on function public.admin_get_customer(uuid) from public, anon;
revoke execute on function public.admin_customer_workspaces(uuid) from public, anon;
revoke execute on function public.admin_list_audit_log(uuid, int) from public, anon;
revoke execute on function public.admin_set_plan(uuid, text) from public, anon;
revoke execute on function public.admin_set_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_extend_trial(uuid, int) from public, anon;
revoke execute on function public.admin_set_notes(uuid, text) from public, anon;
revoke execute on function public.admin_set_custom_price(uuid, int) from public, anon;

grant execute on function public.workspace_usage(uuid) to authenticated;
grant execute on function public.my_account_plan() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_customers(text, text, text, int, int) to authenticated;
grant execute on function public.admin_get_customer(uuid) to authenticated;
grant execute on function public.admin_customer_workspaces(uuid) to authenticated;
grant execute on function public.admin_list_audit_log(uuid, int) to authenticated;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;
grant execute on function public.admin_set_status(uuid, text, text) to authenticated;
grant execute on function public.admin_extend_trial(uuid, int) to authenticated;
grant execute on function public.admin_set_notes(uuid, text) to authenticated;
grant execute on function public.admin_set_custom_price(uuid, int) to authenticated;

-- The billing seam is for the service role only.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.billing_apply_provider_update(uuid, text, text, timestamptz, text, text) to service_role;
  end if;
end;
$$;
