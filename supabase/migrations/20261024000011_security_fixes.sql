-- Fixes from the 2026-10-24 break test.
--
--   1. A workspace Admin could make themselves owner with a direct UPDATE of
--      workspaces.owner_id (the update policy allowed managers to change any
--      column). Clients may now update only name, description, icon and color;
--      ownership changes go through transfer_ownership() (owner, to an existing
--      member) or the new admin_transfer_workspace() (platform admins).
--   2. An owner could hand a workspace to a stranger who isn't a member, using
--      up that person's workspace allowance. Same fix, plus a guard trigger:
--      the new owner must be a member of the workspace.
--   3. Uploading straight to Storage only checked edit rights, so suspended or
--      canceled accounts could still upload, and files with no `attachments`
--      row escaped the storage quota. Uploads now also require a writable
--      workspace with room left, counting every object in its folder.
--   4. Invitations are rate limited per inviter (30 an hour).
--   5. Members (and viewers) no longer see the owner's plan, price and usage,
--      or which modules are switched off; owners and admins still do. Members
--      get only whether the workspace is writable (workspace_write_state).

-- ---------------------------------------------------------------------------
-- 1 and 2: ownership
-- ---------------------------------------------------------------------------

revoke update on public.workspaces from anon, authenticated;
grant update (name, description, icon, color) on public.workspaces to authenticated;

create or replace function public.guard_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = new.id and m.user_id = new.owner_id
     ) then
    raise exception 'The new owner must be a member of the workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger workspaces_guard_owner before update of owner_id on public.workspaces
  for each row execute function public.guard_owner_change();

alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check check (action in (
  'plan_changed','status_changed','trial_extended','notes_updated','custom_price_set',
  'ownership_transferred','admin_granted','admin_revoked','billing_synced'));

-- Platform admins can move a workspace to another account (for example when
-- the owner leaves the customer's company). The new owner joins as owner if
-- they weren't a member; the previous owner stays on as an Admin. The new
-- owner's plan must have room for another workspace, as for any transfer.
create or replace function public.admin_transfer_workspace(p_workspace_id uuid, p_new_owner uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  perform public.require_platform_admin();
  select owner_id into v_old from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_new_owner) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  if v_old = p_new_owner then
    return;
  end if;
  -- One owner per workspace: step the current owner down first.
  update public.workspace_members set role = 'admin' where workspace_id = p_workspace_id and user_id = v_old;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_new_owner, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  update public.workspaces set owner_id = p_new_owner where id = p_workspace_id;
  perform public.log_admin_action('ownership_transferred', p_new_owner, p_workspace_id,
    jsonb_build_object('from', v_old,
      'from_email', coalesce((select u.email from auth.users u where u.id = v_old), ''),
      'to', p_new_owner, 'reason', v_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3: uploads must respect read-only accounts and the storage quota
-- ---------------------------------------------------------------------------

-- Usage counts the larger of recorded attachments and the objects actually in
-- the workspace's folder, so files uploaded without an attachments row count.
-- A single upload can overshoot by at most the bucket's 10 MB file limit.
create or replace function public.can_upload_attachment(p_workspace_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e record;
  v_used bigint;
begin
  if p_workspace_id is null or not public.can_edit_workspace(p_workspace_id) then
    return false;
  end if;
  select * into e from public.workspace_entitlements(p_workspace_id);
  if not coalesce(e.writable, false) then
    return false;
  end if;
  if e.storage_mb is null then
    return true;
  end if;
  select greatest(
    (select coalesce(sum(a.size_bytes), 0) from public.attachments a where a.workspace_id = p_workspace_id),
    (select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)
       from storage.objects o
      where o.bucket_id = 'attachments' and o.name like p_workspace_id::text || '/%')
  ) into v_used;
  return v_used < e.storage_mb::bigint * 1024 * 1024;
end;
$$;

revoke execute on function public.can_upload_attachment(uuid) from public, anon;
grant execute on function public.can_upload_attachment(uuid) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found; skipping storage policy';
    return;
  end if;
  execute 'drop policy if exists "attachments: editors upload objects" on storage.objects';
  execute $p$
    create policy "attachments: editors upload objects" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'attachments'
        and (select public.can_upload_attachment(public.try_uuid((storage.foldername(name))[1])))
      )
  $p$;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4: invitation rate limit
-- ---------------------------------------------------------------------------

create index if not exists invitations_invited_by_created_idx on public.invitations (invited_by, created_at desc);

create or replace function public.limit_invitation_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;
  if (select count(*) from public.invitations where invited_by = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many invitations in the last hour. Try again later.' using errcode = '54000', hint = 'rate_limited';
  end if;
  return new;
end;
$$;

create trigger invitations_rate_limit before insert on public.invitations
  for each row execute function public.limit_invitation_rate();

revoke execute on function public.guard_owner_change() from public, anon, authenticated;
revoke execute on function public.limit_invitation_rate() from public, anon, authenticated;
revoke execute on function public.admin_transfer_workspace(uuid, uuid, text) from public, anon;
grant execute on function public.admin_transfer_workspace(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5: members don't see the plan or which modules are switched off
-- ---------------------------------------------------------------------------

-- Plan, price and usage are for the workspace's owner and admins. (Same body
-- as 20261023000010, plus the manager check.)
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
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Only owners and admins can see the plan' using errcode = '42501';
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


-- What every member needs: whether the workspace is writable and, if not, why
-- (for the read-only banner). No plan, price or limits.
create or replace function public.workspace_write_state(p_workspace_id uuid)
returns table (writable boolean, status text)
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
  return query select e.writable, e.status from public.workspace_entitlements(p_workspace_id) e;
end;
$$;

revoke execute on function public.workspace_write_state(uuid) from public, anon;
grant execute on function public.workspace_write_state(uuid) to authenticated;

-- Members see only the modules that are switched on; owners and admins see all.
drop policy "modules: members read" on public.workspace_modules;
create policy "modules: members read enabled, managers read all" on public.workspace_modules
  for select to authenticated
  using ((select public.is_workspace_member(workspace_id)) and (enabled or (select public.can_manage_workspace(workspace_id))));
