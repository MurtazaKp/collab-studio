-- Activity feed and notifications. Both are written exclusively by triggers
-- (SECURITY DEFINER), so clients can read but never forge them.

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  verb text not null check (verb in ('created','moved','completed','added','checked','joined','left','renamed')),
  entity_type text not null check (entity_type in (
    'document','whiteboard','mindmap','code_project','board','task','channel',
    'playlist','playlist_item','shopping_list','shopping_item','member')),
  entity_id uuid,
  title text not null default '' check (char_length(title) <= 200),
  detail text not null default '' check (char_length(detail) <= 200),
  created_at timestamptz not null default now()
);

create index activity_events_ws_idx on public.activity_events (workspace_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in (
    'task_assigned','task_comment','thread_reply','item_assigned',
    'member_joined','role_changed','invitation')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 500),
  link text not null default '' check (link = '' or link ~ '^/[A-Za-z0-9/_?=&%.-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.activity_events enable row level security;
alter table public.notifications enable row level security;

create policy "activity: members read" on public.activity_events
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));

create policy "notifications: own read" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: own update" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "notifications: own delete" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

revoke insert on public.activity_events from anon, authenticated;
revoke insert on public.notifications from anon, authenticated;
revoke update, delete on public.activity_events from anon, authenticated;

-- Recipients may only mark notifications read.
create or replace function public.notifications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.user_id, new.workspace_id, new.actor_id, new.kind, new.title, new.body, new.link, new.created_at)
     is distinct from (old.user_id, old.workspace_id, old.actor_id, old.kind, old.title, old.body, old.link, old.created_at) then
    raise exception 'Only read_at can change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_guard before update on public.notifications
  for each row execute function public.notifications_guard();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.log_activity(
  p_workspace_id uuid, p_verb text, p_entity_type text, p_entity_id uuid, p_title text, p_detail text default ''
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_events (workspace_id, actor_id, verb, entity_type, entity_id, title, detail)
  values (p_workspace_id, (select auth.uid()), p_verb, p_entity_type, p_entity_id,
          left(coalesce(p_title, ''), 200), left(coalesce(p_detail, ''), 200));
$$;

create or replace function public.notify_user(
  p_user_id uuid, p_workspace_id uuid, p_kind text, p_title text, p_body text, p_link text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never notify people about their own actions.
  if p_user_id is null or p_user_id = (select auth.uid()) then
    return;
  end if;
  insert into public.notifications (user_id, workspace_id, actor_id, kind, title, body, link)
  values (p_user_id, p_workspace_id, (select auth.uid()), p_kind, left(p_title, 200), left(coalesce(p_body, ''), 500), p_link);
end;
$$;

create or replace function public.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif((select display_name from public.profiles where id = (select auth.uid())), ''), 'Someone');
$$;

revoke execute on function public.log_activity(uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.actor_name() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Activity triggers
-- ---------------------------------------------------------------------------

create or replace function public.activity_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := to_jsonb(new);
begin
  perform public.log_activity(
    new.workspace_id,
    case when tg_argv[0] in ('playlist_item','shopping_item') then 'added' else 'created' end,
    tg_argv[0],
    new.id,
    coalesce(v ->> 'title', v ->> 'name', '')
  );
  return new;
end;
$$;

revoke execute on function public.activity_on_create() from public, anon, authenticated;

create trigger documents_activity after insert on public.documents
  for each row execute function public.activity_on_create('document');
create trigger whiteboards_activity after insert on public.whiteboards
  for each row execute function public.activity_on_create('whiteboard');
create trigger mindmaps_activity after insert on public.mindmaps
  for each row execute function public.activity_on_create('mindmap');
create trigger code_projects_activity after insert on public.code_projects
  for each row execute function public.activity_on_create('code_project');
create trigger boards_activity after insert on public.boards
  for each row execute function public.activity_on_create('board');
create trigger channels_activity after insert on public.channels
  for each row execute function public.activity_on_create('channel');
create trigger playlists_activity after insert on public.playlists
  for each row execute function public.activity_on_create('playlist');
create trigger playlist_items_activity after insert on public.playlist_items
  for each row execute function public.activity_on_create('playlist_item');
create trigger shopping_lists_activity after insert on public.shopping_lists
  for each row execute function public.activity_on_create('shopping_list');

create or replace function public.activity_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col text;
  v_board text;
begin
  select title into v_board from public.boards where id = new.board_id;
  if tg_op = 'INSERT' then
    perform public.log_activity(new.workspace_id, 'created', 'task', new.id, new.title, coalesce(v_board, ''));
    if new.assignee_id is not null then
      perform public.notify_user(new.assignee_id, new.workspace_id, 'task_assigned',
        public.actor_name() || ' assigned you a task', new.title,
        '/w/' || new.workspace_id || '/kanban/' || new.board_id || '?task=' || new.id);
    end if;
  else
    if new.column_id is distinct from old.column_id then
      select title into v_col from public.board_columns where id = new.column_id;
      perform public.log_activity(new.workspace_id, 'moved', 'task', new.id, new.title, coalesce(v_col, ''));
    end if;
    if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
      perform public.notify_user(new.assignee_id, new.workspace_id, 'task_assigned',
        public.actor_name() || ' assigned you a task', new.title,
        '/w/' || new.workspace_id || '/kanban/' || new.board_id || '?task=' || new.id);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_on_task() from public, anon, authenticated;

create trigger tasks_activity after insert or update on public.tasks
  for each row execute function public.activity_on_task();

create or replace function public.activity_on_shopping_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list text;
begin
  select title into v_list from public.shopping_lists where id = new.list_id;
  if tg_op = 'INSERT' then
    perform public.log_activity(new.workspace_id, 'added', 'shopping_item', new.id, new.name, coalesce(v_list, ''));
  elsif new.checked and not old.checked then
    perform public.log_activity(new.workspace_id, 'checked', 'shopping_item', new.id, new.name, coalesce(v_list, ''));
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_user(new.assignee_id, new.workspace_id, 'item_assigned',
      public.actor_name() || ' asked you to pick something up', new.name || coalesce(' · ' || v_list, ''),
      '/w/' || new.workspace_id || '/shopping/' || new.list_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_on_shopping_item() from public, anon, authenticated;

create trigger shopping_items_activity after insert or update on public.shopping_items
  for each row execute function public.activity_on_shopping_item();

create or replace function public.activity_on_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_ws text;
  r record;
begin
  if tg_op = 'INSERT' then
    -- The creator's own membership at workspace creation is not news.
    if new.role = 'owner' then
      return new;
    end if;
    select display_name into v_name from public.profiles where id = new.user_id;
    select name into v_ws from public.workspaces where id = new.workspace_id;
    perform public.log_activity(new.workspace_id, 'joined', 'member', new.user_id, coalesce(v_name, ''), new.role);
    for r in select user_id from public.workspace_members
             where workspace_id = new.workspace_id and role in ('owner','admin') and user_id <> new.user_id loop
      perform public.notify_user(r.user_id, new.workspace_id, 'member_joined',
        coalesce(nullif(v_name, ''), 'Someone') || ' joined ' || coalesce(v_ws, 'your workspace'),
        'Role: ' || new.role, '/w/' || new.workspace_id || '/settings/members');
    end loop;
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    select name into v_ws from public.workspaces where id = new.workspace_id;
    perform public.notify_user(new.user_id, new.workspace_id, 'role_changed',
      'Your role in ' || coalesce(v_ws, 'a workspace') || ' is now ' || new.role, '',
      '/w/' || new.workspace_id);
  elsif tg_op = 'DELETE' then
    select display_name into v_name from public.profiles where id = old.user_id;
    if exists (select 1 from public.workspaces where id = old.workspace_id) then
      perform public.log_activity(old.workspace_id, 'left', 'member', old.user_id, coalesce(v_name, ''));
    end if;
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_on_member() from public, anon, authenticated;

create trigger workspace_members_activity after insert or update or delete on public.workspace_members
  for each row execute function public.activity_on_member();

-- ---------------------------------------------------------------------------
-- Notification triggers for comments, thread replies and invitations
-- ---------------------------------------------------------------------------

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  select id, title, board_id, assignee_id, created_by into t from public.tasks where id = new.task_id;
  perform public.notify_user(t.assignee_id, new.workspace_id, 'task_comment',
    public.actor_name() || ' commented on ' || t.title, left(new.body, 140),
    '/w/' || new.workspace_id || '/kanban/' || t.board_id || '?task=' || t.id);
  if t.created_by is distinct from t.assignee_id then
    perform public.notify_user(t.created_by, new.workspace_id, 'task_comment',
      public.actor_name() || ' commented on ' || t.title, left(new.body, 140),
      '/w/' || new.workspace_id || '/kanban/' || t.board_id || '?task=' || t.id);
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_on_comment() from public, anon, authenticated;

create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_author uuid;
  v_channel text;
begin
  if new.parent_id is null then
    return new;
  end if;
  select author_id into v_parent_author from public.messages where id = new.parent_id;
  select name into v_channel from public.channels where id = new.channel_id;
  perform public.notify_user(v_parent_author, new.workspace_id, 'thread_reply',
    public.actor_name() || ' replied in #' || coalesce(v_channel, 'chat'), left(new.body, 140),
    '/w/' || new.workspace_id || '/chat/' || new.channel_id || '?thread=' || new.parent_id);
  return new;
end;
$$;

revoke execute on function public.notify_on_reply() from public, anon, authenticated;

create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_on_reply();

-- Existing users get an in-app notice; the raw token is never stored, so the
-- link points to their pending-invitations list instead.
create or replace function public.notify_on_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_ws text;
begin
  select id into v_user from auth.users where lower(email) = new.email;
  if v_user is null then
    return new;
  end if;
  select name into v_ws from public.workspaces where id = new.workspace_id;
  perform public.notify_user(v_user, null, 'invitation',
    public.actor_name() || ' invited you to ' || coalesce(v_ws, 'a workspace'), 'Role: ' || new.role,
    '/invitations');
  return new;
end;
$$;

revoke execute on function public.notify_on_invitation() from public, anon, authenticated;

create trigger invitations_notify after insert on public.invitations
  for each row execute function public.notify_on_invitation();
