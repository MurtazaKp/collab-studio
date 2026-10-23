-- Module content.
--
-- Child rows carry `workspace_id` (denormalised for cheap RLS) and composite
-- foreign keys of the form (parent_id, workspace_id) -> parent (id, workspace_id),
-- so a row can never point at a parent in another workspace, whatever a client sends.

create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Yjs-backed entities: documents, whiteboards, mindmaps, code projects
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default 'Untitled document' check (char_length(trim(title)) between 1 and 120),
  -- Derived from the Yjs state by the collaboration server.
  preview_text text not null default '' check (char_length(preview_text) <= 500),
  content_updated_at timestamptz,
  last_edited_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.whiteboards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default 'Untitled board' check (char_length(trim(title)) between 1 and 120),
  preview_text text not null default '' check (char_length(preview_text) <= 500),
  content_updated_at timestamptz,
  last_edited_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.mindmaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default 'Untitled mindmap' check (char_length(trim(title)) between 1 and 120),
  preview_text text not null default '' check (char_length(preview_text) <= 500),
  content_updated_at timestamptz,
  last_edited_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.code_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default 'Untitled project' check (char_length(trim(title)) between 1 and 120),
  preview_text text not null default '' check (char_length(preview_text) <= 500),
  content_updated_at timestamptz,
  last_edited_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index documents_ws_idx on public.documents (workspace_id, updated_at desc);
create index whiteboards_ws_idx on public.whiteboards (workspace_id, updated_at desc);
create index mindmaps_ws_idx on public.mindmaps (workspace_id, updated_at desc);
create index code_projects_ws_idx on public.code_projects (workspace_id, updated_at desc);

-- One collaboration room per Yjs-backed entity. Exactly one entity FK is set,
-- and deleting the entity deletes its room and all persisted Yjs state.
create table public.collaboration_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('document','whiteboard','mindmap','code')),
  name text not null unique,
  document_id uuid unique references public.documents (id) on delete cascade,
  whiteboard_id uuid unique references public.whiteboards (id) on delete cascade,
  mindmap_id uuid unique references public.mindmaps (id) on delete cascade,
  code_project_id uuid unique references public.code_projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(document_id, whiteboard_id, mindmap_id, code_project_id) = 1),
  check (
    (kind = 'document' and document_id is not null and name = 'document:' || document_id::text) or
    (kind = 'whiteboard' and whiteboard_id is not null and name = 'whiteboard:' || whiteboard_id::text) or
    (kind = 'mindmap' and mindmap_id is not null and name = 'mindmap:' || mindmap_id::text) or
    (kind = 'code' and code_project_id is not null and name = 'code:' || code_project_id::text)
  )
);

create index collaboration_rooms_ws_idx on public.collaboration_rooms (workspace_id);

-- Append-only Yjs update log. Rows are merged into the snapshot and deleted by
-- id (never by range), so updates committed during compaction are never lost.
create table public.collaboration_updates (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.collaboration_rooms (id) on delete cascade,
  data bytea not null check (octet_length(data) between 1 and 8388608),
  created_at timestamptz not null default now()
);

create index collaboration_updates_room_idx on public.collaboration_updates (room_id, id);

create table public.collaboration_snapshots (
  room_id uuid primary key references public.collaboration_rooms (id) on delete cascade,
  state bytea not null,
  compacted_updates bigint not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.create_collab_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := tg_argv[0];
begin
  insert into public.collaboration_rooms (workspace_id, kind, name, document_id, whiteboard_id, mindmap_id, code_project_id)
  values (
    new.workspace_id,
    v_kind,
    v_kind || ':' || new.id::text,
    case when v_kind = 'document' then new.id end,
    case when v_kind = 'whiteboard' then new.id end,
    case when v_kind = 'mindmap' then new.id end,
    case when v_kind = 'code' then new.id end
  );
  return new;
end;
$$;

revoke execute on function public.create_collab_room() from public, anon, authenticated;

create trigger documents_room after insert on public.documents
  for each row execute function public.create_collab_room('document');
create trigger whiteboards_room after insert on public.whiteboards
  for each row execute function public.create_collab_room('whiteboard');
create trigger mindmaps_room after insert on public.mindmaps
  for each row execute function public.create_collab_room('mindmap');
create trigger code_projects_room after insert on public.code_projects
  for each row execute function public.create_collab_room('code');

-- ---------------------------------------------------------------------------
-- Kanban
-- ---------------------------------------------------------------------------

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index boards_ws_idx on public.boards (workspace_id, created_at);

create table public.board_columns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  board_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 60),
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (board_id, workspace_id) references public.boards (id, workspace_id) on delete cascade,
  unique (id, board_id)
);

create index board_columns_board_idx on public.board_columns (board_id, position);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  board_id uuid not null,
  column_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  priority text not null default 'none' check (priority in ('none','low','medium','high','urgent')),
  due_date date,
  assignee_id uuid references public.profiles (id) on delete set null,
  labels text[] not null default '{}' check (cardinality(labels) <= 10),
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (board_id, workspace_id) references public.boards (id, workspace_id) on delete cascade,
  foreign key (column_id, board_id) references public.board_columns (id, board_id) on delete cascade,
  unique (id, workspace_id)
);

create index tasks_board_idx on public.tasks (board_id);
create index tasks_column_idx on public.tasks (column_id, position);
create index tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;

create or replace function public.validate_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if not exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.assignee_id) then
      raise exception 'Assignee must be a workspace member' using errcode = '23514';
    end if;
  end if;
  foreach v_label in array new.labels loop
    if char_length(trim(v_label)) not between 1 and 24 then
      raise exception 'Labels must be 1-24 characters' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.validate_task() from public, anon, authenticated;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);

create index comments_task_idx on public.comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  topic text not null default '' check (char_length(topic) <= 250),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  channel_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  parent_id uuid,
  reply_count integer not null default 0,
  last_reply_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (channel_id, workspace_id) references public.channels (id, workspace_id) on delete cascade,
  unique (id, channel_id),
  unique (id, workspace_id),
  foreign key (parent_id, channel_id) references public.messages (id, channel_id) on delete cascade
);

create index messages_channel_idx on public.messages (channel_id, created_at desc, id desc) where parent_id is null;
create index messages_thread_idx on public.messages (parent_id, created_at) where parent_id is not null;

create table public.message_reactions (
  message_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','🎉','😄','👀','🚀')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  foreign key (message_id, workspace_id) references public.messages (id, workspace_id) on delete cascade
);

create table public.channel_reads (
  channel_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id),
  foreign key (channel_id, workspace_id) references public.channels (id, workspace_id) on delete cascade
);

create or replace function public.message_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.author_id := (select auth.uid());
    end if;
    new.created_at := now();
    new.reply_count := 0;
    new.last_reply_at := null;
    new.edited_at := null;
    new.deleted_at := null;
    if new.parent_id is not null and exists (
      select 1 from public.messages p where p.id = new.parent_id and p.parent_id is not null
    ) then
      raise exception 'Threads are one level deep' using errcode = '23514';
    end if;
  else
    -- Only body and deleted_at are editable; everything else is fixed.
    if (new.workspace_id, new.channel_id, new.author_id, new.parent_id, new.created_at)
       is distinct from (old.workspace_id, old.channel_id, old.author_id, old.parent_id, old.created_at) then
      raise exception 'Message metadata is immutable' using errcode = '42501';
    end if;
    if new.body is distinct from old.body then
      new.edited_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    update public.messages
       set reply_count = reply_count + 1, last_reply_at = new.created_at
     where id = new.parent_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.message_before_write() from public, anon, authenticated;
revoke execute on function public.message_after_insert() from public, anon, authenticated;

create trigger messages_before_write before insert or update on public.messages
  for each row execute function public.message_before_write();
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.message_after_insert();

create or replace function public.force_user_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger message_reactions_user before insert on public.message_reactions
  for each row execute function public.force_user_id();
create trigger channel_reads_user before insert or update on public.channel_reads
  for each row execute function public.force_user_id();

-- Unread counts per channel for the caller (top-level messages by others).
create or replace function public.channel_unread_counts(p_workspace_id uuid)
returns table (channel_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, count(m.id)
  from public.channels c
  left join public.channel_reads r on r.channel_id = c.id and r.user_id = (select auth.uid())
  left join public.messages m on m.channel_id = c.id
    and m.parent_id is null
    and m.deleted_at is null
    and m.author_id is distinct from (select auth.uid())
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where c.workspace_id = p_workspace_id
  group by c.id;
$$;

create or replace function public.mark_channel_read(p_channel_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.channels where id = p_channel_id;
  if v_ws is null then
    raise exception 'Channel not found' using errcode = 'P0002';
  end if;
  insert into public.channel_reads (channel_id, workspace_id, user_id, last_read_at)
  values (p_channel_id, v_ws, (select auth.uid()), now())
  on conflict (channel_id, user_id) do update set last_read_at = now();
end;
$$;

revoke execute on function public.channel_unread_counts(uuid) from public, anon;
revoke execute on function public.mark_channel_read(uuid) from public, anon;
grant execute on function public.channel_unread_counts(uuid) to authenticated;
grant execute on function public.mark_channel_read(uuid) to authenticated;

-- Every workspace starts with #general.
create or replace function public.create_default_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channels (workspace_id, name, topic, created_by)
  values (new.id, 'general', 'Company-wide announcements and chatter', new.owner_id);
  return new;
end;
$$;

revoke execute on function public.create_default_channel() from public, anon, authenticated;

create trigger workspaces_default_channel after insert on public.workspaces
  for each row execute function public.create_default_channel();

-- ---------------------------------------------------------------------------
-- Playlists
-- ---------------------------------------------------------------------------

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index playlists_ws_idx on public.playlists (workspace_id, created_at);

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  playlist_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  url text not null check (char_length(url) <= 2048 and url ~* '^https?://[^\s]+$'),
  artist text not null default '' check (char_length(artist) <= 120),
  note text not null default '' check (char_length(note) <= 500),
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (playlist_id, workspace_id) references public.playlists (id, workspace_id) on delete cascade
);

create index playlist_items_order_idx on public.playlist_items (playlist_id, position);

-- ---------------------------------------------------------------------------
-- Shopping lists
-- ---------------------------------------------------------------------------

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index shopping_lists_ws_idx on public.shopping_lists (workspace_id, created_at);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  list_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity numeric(10, 2) not null default 1 check (quantity > 0 and quantity <= 9999),
  unit text not null default '' check (char_length(unit) <= 16),
  category text not null default '' check (char_length(category) <= 40),
  assignee_id uuid references public.profiles (id) on delete set null,
  checked boolean not null default false,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (list_id, workspace_id) references public.shopping_lists (id, workspace_id) on delete cascade
);

create index shopping_items_order_idx on public.shopping_items (list_id, position);

create or replace function public.shopping_item_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if not exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.assignee_id) then
      raise exception 'Assignee must be a workspace member' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.checked then
      new.checked_by := (select auth.uid());
      new.checked_at := now();
    else
      new.checked_by := null;
      new.checked_at := null;
    end if;
  elsif new.checked is distinct from old.checked then
    new.checked_by := case when new.checked then (select auth.uid()) end;
    new.checked_at := case when new.checked then now() end;
  else
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.shopping_item_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attachments (file metadata; bytes live in the private `attachments` bucket)
-- ---------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid,
  -- Object key inside the bucket: <workspace_id>/<uuid>/<safe file name>
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,120}$'),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in (
    'image/png','image/jpeg','image/gif','image/webp','application/pdf',
    'text/plain','text/markdown','text/csv','application/zip')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = workspace_id::text),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);

create index attachments_task_idx on public.attachments (task_id) where task_id is not null;
create index attachments_ws_idx on public.attachments (workspace_id);

-- ---------------------------------------------------------------------------
-- Triggers: timestamps, authorship, immutability, versions
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'documents','whiteboards','mindmaps','code_projects','boards','board_columns','tasks',
    'comments','channels','playlists','playlist_items','shopping_lists','shopping_items'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_workspace_change()', t || '_ws_immutable', t);
  end loop;

  foreach t in array array[
    'documents','whiteboards','mindmaps','code_projects','boards','tasks','channels',
    'playlists','playlist_items','shopping_lists','shopping_items','attachments'
  ] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.force_created_by()', t || '_created_by', t);
  end loop;
end;
$$;

create or replace function public.force_comment_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.author_id := (select auth.uid());
  end if;
  if tg_op = 'UPDATE' and (new.author_id, new.task_id) is distinct from (old.author_id, old.task_id) then
    raise exception 'Comment metadata is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger comments_author before insert or update on public.comments
  for each row execute function public.force_comment_author();

create trigger tasks_validate before insert or update on public.tasks
  for each row execute function public.validate_task();
create trigger tasks_version before update on public.tasks
  for each row execute function public.bump_version();
create trigger shopping_items_before_write before insert or update on public.shopping_items
  for each row execute function public.shopping_item_before_write();
create trigger shopping_items_version before update on public.shopping_items
  for each row execute function public.bump_version();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  -- Standard shared content: members read, members/admins/owners write, viewers read only.
  foreach t in array array[
    'documents','whiteboards','mindmaps','code_projects','boards','board_columns','tasks',
    'playlists','playlist_items','shopping_lists','shopping_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "%s: members read" on public.%I for select to authenticated
      using ((select public.is_workspace_member(workspace_id)))$p$, t, t);
    execute format($p$create policy "%s: editors insert" on public.%I for insert to authenticated
      with check ((select public.can_edit_workspace(workspace_id)))$p$, t, t);
    execute format($p$create policy "%s: editors update" on public.%I for update to authenticated
      using ((select public.can_edit_workspace(workspace_id)))
      with check ((select public.can_edit_workspace(workspace_id)))$p$, t, t);
    execute format($p$create policy "%s: editors delete" on public.%I for delete to authenticated
      using ((select public.can_edit_workspace(workspace_id)))$p$, t, t);
  end loop;
end;
$$;

alter table public.collaboration_rooms enable row level security;
alter table public.collaboration_updates enable row level security;
alter table public.collaboration_snapshots enable row level security;

-- Members may resolve room metadata; Yjs state is only reachable through the
-- collaboration server, so the update log and snapshots have no client policies.
create policy "rooms: members read" on public.collaboration_rooms
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
revoke all on public.collaboration_updates from anon, authenticated;
revoke all on public.collaboration_snapshots from anon, authenticated;
revoke insert, update, delete on public.collaboration_rooms from anon, authenticated;

alter table public.comments enable row level security;
create policy "comments: members read" on public.comments
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy "comments: editors insert" on public.comments
  for insert to authenticated with check ((select public.can_edit_workspace(workspace_id)));
create policy "comments: author update" on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
  with check (author_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)));
create policy "comments: author or manager delete" on public.comments
  for delete to authenticated
  using ((author_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
         or (select public.can_manage_workspace(workspace_id)));

alter table public.channels enable row level security;
create policy "channels: members read" on public.channels
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy "channels: editors insert" on public.channels
  for insert to authenticated with check ((select public.can_edit_workspace(workspace_id)));
create policy "channels: creator or manager update" on public.channels
  for update to authenticated
  using ((created_by = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
         or (select public.can_manage_workspace(workspace_id)))
  with check ((select public.can_edit_workspace(workspace_id)));
create policy "channels: creator or manager delete" on public.channels
  for delete to authenticated
  using ((created_by = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
         or (select public.can_manage_workspace(workspace_id)));

alter table public.messages enable row level security;
create policy "messages: members read" on public.messages
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy "messages: editors insert" on public.messages
  for insert to authenticated with check ((select public.can_edit_workspace(workspace_id)));
create policy "messages: author update" on public.messages
  for update to authenticated
  using (author_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
  with check (author_id = (select auth.uid()));
create policy "messages: author or manager delete" on public.messages
  for delete to authenticated
  using ((author_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
         or (select public.can_manage_workspace(workspace_id)));

alter table public.message_reactions enable row level security;
create policy "reactions: members read" on public.message_reactions
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy "reactions: editors add own" on public.message_reactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)));
create policy "reactions: remove own" on public.message_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

alter table public.channel_reads enable row level security;
create policy "reads: own read" on public.channel_reads
  for select to authenticated using (user_id = (select auth.uid()));
create policy "reads: own insert" on public.channel_reads
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));
create policy "reads: own update" on public.channel_reads
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_workspace_member(workspace_id)));

alter table public.attachments enable row level security;
create policy "attachments: members read" on public.attachments
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy "attachments: editors insert" on public.attachments
  for insert to authenticated with check ((select public.can_edit_workspace(workspace_id)));
create policy "attachments: uploader or manager delete" on public.attachments
  for delete to authenticated
  using ((created_by = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)))
         or (select public.can_manage_workspace(workspace_id)));
