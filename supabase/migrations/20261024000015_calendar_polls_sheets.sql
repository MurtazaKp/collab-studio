-- Three new modules: Calendar, Polls and Sheets. All three are relational
-- (rows + Supabase Realtime), like Kanban and Playlists.
--
--   Calendar  calendars (items) → calendar_events, with attendees who get a
--             notification when they're added.
--   Polls     polls (items) → poll_options → poll_votes. One vote per poll
--             unless it allows several; closed polls refuse votes. Vote counts
--             live on poll_options (kept by a trigger), so results update live
--             for everyone without exposing who voted in anonymous polls.
--   Sheets    sheets (items) → sheet_cells, one row per non-empty cell. Each
--             cell syncs on its own, so people can edit different cells at once.
--
-- They're part of Team, Business and Custom (and so of the 14-day trial);
-- Free keeps its four tools. Existing workspaces get the three modules,
-- switched on where the owner's plan includes them.

-- ---------------------------------------------------------------------------
-- Module and activity type lists
-- ---------------------------------------------------------------------------

alter table public.workspace_modules drop constraint workspace_modules_module_type_check;
alter table public.workspace_modules add constraint workspace_modules_module_type_check check (module_type in (
  'docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping','calendar','polls','sheets'));

alter table public.plans drop constraint plans_modules_check;
alter table public.plans add constraint plans_modules_check check (
  cardinality(modules) between 1 and 11
  and modules <@ array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping','calendar','polls','sheets']);

update public.plans
   set modules = array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping','calendar','polls','sheets']
 where id in ('team','business','custom');

alter table public.activity_events drop constraint activity_events_entity_type_check;
alter table public.activity_events add constraint activity_events_entity_type_check check (entity_type in (
  'document','whiteboard','mindmap','code_project','board','task','channel',
  'playlist','playlist_item','shopping_list','shopping_item','member',
  'calendar','calendar_event','poll','sheet'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','task_comment','thread_reply','item_assigned',
  'member_joined','role_changed','invitation','event_invite'));

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index calendars_ws_idx on public.calendars (workspace_id, created_at);
create index calendars_created_by_idx on public.calendars (created_by);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  calendar_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color text not null default 'iris'
    check (color in ('iris','teal','amber','rose','sky','lime','violet','slate')),
  attendee_ids uuid[] not null default '{}' check (cardinality(attendee_ids) <= 100),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at),
  check (ends_at - starts_at <= interval '366 days'),
  foreign key (calendar_id, workspace_id) references public.calendars (id, workspace_id) on delete cascade
);

create index calendar_events_range_idx on public.calendar_events (calendar_id, workspace_id, starts_at);
create index calendar_events_created_by_idx on public.calendar_events (created_by);

-- Attendees must be members of the workspace; newly added ones are notified.
create or replace function public.calendar_event_attendees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_op = 'INSERT' or new.attendee_ids is distinct from old.attendee_ids then
    new.attendee_ids := array(select distinct unnest(new.attendee_ids));
    if exists (
      select 1 from unnest(new.attendee_ids) a(uid)
      where not exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = a.uid)
    ) then
      raise exception 'Attendees must be members of the workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.calendar_event_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_new uuid[] := case when tg_op = 'INSERT' then new.attendee_ids
                       else array(select unnest(new.attendee_ids) except select unnest(old.attendee_ids)) end;
begin
  foreach v_user in array coalesce(v_new, '{}') loop
    perform public.notify_user(v_user, new.workspace_id, 'event_invite',
      public.actor_name() || ' added you to an event',
      new.title || ' · ' || to_char(new.starts_at at time zone 'UTC', case when new.all_day then 'Mon DD' else 'Mon DD, HH24:MI "UTC"' end),
      '/w/' || new.workspace_id || '/calendar/' || new.calendar_id);
  end loop;
  return null;
end;
$$;

create trigger calendar_events_attendees before insert or update on public.calendar_events
  for each row execute function public.calendar_event_attendees();
create trigger calendar_events_notify after insert or update of attendee_ids on public.calendar_events
  for each row execute function public.calendar_event_notify();

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The question.
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 1000),
  multiple boolean not null default false,
  anonymous boolean not null default false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index polls_ws_idx on public.polls (workspace_id, created_at);
create index polls_created_by_idx on public.polls (created_by);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  poll_id uuid not null,
  label text not null check (char_length(trim(label)) between 1 and 200),
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,128}$'),
  -- Maintained by poll_votes triggers; clients can't change it.
  vote_count integer not null default 0 check (vote_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, poll_id),
  foreign key (poll_id, workspace_id) references public.polls (id, workspace_id) on delete cascade
);

create index poll_options_order_idx on public.poll_options (poll_id, workspace_id, position);

create table public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  poll_id uuid not null,
  option_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (option_id, user_id),
  foreign key (poll_id, workspace_id) references public.polls (id, workspace_id) on delete cascade,
  foreign key (option_id, poll_id) references public.poll_options (id, poll_id) on delete cascade
);

create index poll_votes_poll_idx on public.poll_votes (poll_id, workspace_id, user_id);
create index poll_votes_option_poll_idx on public.poll_votes (option_id, poll_id);
create index poll_votes_user_idx on public.poll_votes (user_id);

create or replace function public.poll_is_open(p_poll_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.polls p
    where p.id = p_poll_id and p.closed_at is null and (p.closes_at is null or p.closes_at > now())
  );
$$;

-- Votes are always the caller's own; single-choice polls replace the earlier vote.
create or replace function public.poll_vote_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_multiple boolean;
begin
  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  if not public.poll_is_open(new.poll_id) then
    raise exception 'This poll is closed' using errcode = '42501';
  end if;
  select multiple into v_multiple from public.polls where id = new.poll_id;
  if not v_multiple then
    delete from public.poll_votes where poll_id = new.poll_id and user_id = new.user_id and option_id <> new.option_id;
  end if;
  return new;
end;
$$;

create or replace function public.poll_vote_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
  else
    update public.poll_options set vote_count = greatest(vote_count - 1, 0) where id = old.option_id;
  end if;
  return null;
end;
$$;

-- Clients may rename or reorder options, never change their counts.
create or replace function public.poll_option_protect_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null then
    new.vote_count := case when tg_op = 'INSERT' then 0 else old.vote_count end;
  end if;
  return new;
end;
$$;

create or replace function public.poll_vote_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Withdrawing a vote needs an open poll (cascades from deleted options/polls pass).
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null and not public.poll_is_open(old.poll_id) then
    raise exception 'This poll is closed' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger poll_votes_before_insert before insert on public.poll_votes
  for each row execute function public.poll_vote_before_insert();
create trigger poll_votes_before_delete before delete on public.poll_votes
  for each row execute function public.poll_vote_delete_guard();
create trigger poll_votes_count after insert or delete on public.poll_votes
  for each row execute function public.poll_vote_count();
create trigger poll_options_protect_count before insert or update on public.poll_options
  for each row execute function public.poll_option_protect_count();

-- ---------------------------------------------------------------------------
-- Sheets
-- ---------------------------------------------------------------------------

create table public.sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  row_count integer not null default 100 check (row_count between 1 and 1000),
  col_count integer not null default 26 check (col_count between 1 and 52),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index sheets_ws_idx on public.sheets (workspace_id, created_at);
create index sheets_created_by_idx on public.sheets (created_by);

create table public.sheet_cells (
  -- Stable per cell (an upsert keeps it), so live updates can match rows.
  id uuid not null default gen_random_uuid() unique,
  workspace_id uuid not null,
  sheet_id uuid not null,
  row_index integer not null check (row_index between 0 and 999),
  col_index integer not null check (col_index between 0 and 51),
  value text not null default '' check (char_length(value) <= 2000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (sheet_id, row_index, col_index),
  foreign key (sheet_id, workspace_id) references public.sheets (id, workspace_id) on delete cascade
);

create index sheet_cells_sheet_ws_idx on public.sheet_cells (sheet_id, workspace_id);
create index sheet_cells_updated_by_idx on public.sheet_cells (updated_by);

create or replace function public.sheet_cell_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger sheet_cells_author before insert or update on public.sheet_cells
  for each row execute function public.sheet_cell_author();

-- ---------------------------------------------------------------------------
-- Shared triggers: timestamps, workspace immutability, authorship, activity
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['calendars','calendar_events','polls','poll_options','sheets'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['calendars','calendar_events','polls','poll_options','poll_votes','sheets','sheet_cells'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_workspace_change()', t || '_ws_immutable', t);
  end loop;
  foreach t in array array['calendars','calendar_events','polls','sheets'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.force_created_by()', t || '_created_by', t);
  end loop;
end;
$$;

create trigger calendars_activity after insert on public.calendars
  for each row execute function public.activity_on_create('calendar');
create trigger calendar_events_activity after insert on public.calendar_events
  for each row execute function public.activity_on_create('calendar_event');
create trigger polls_activity after insert on public.polls
  for each row execute function public.activity_on_create('poll');
create trigger sheets_activity after insert on public.sheets
  for each row execute function public.activity_on_create('sheet');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  -- Standard shared content: members read, members/admins/owners write.
  foreach t in array array['calendars','calendar_events','polls','poll_options','sheets','sheet_cells'] loop
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

-- Votes: who voted is visible unless the poll is anonymous (your own vote
-- always is). Everyone sees counts on poll_options.
alter table public.poll_votes enable row level security;
create policy "poll_votes: members read" on public.poll_votes
  for select to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (user_id = (select auth.uid())
         or not exists (select 1 from public.polls p where p.id = poll_id and p.anonymous))
  );
create policy "poll_votes: editors vote" on public.poll_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)));
create policy "poll_votes: own withdraw" on public.poll_votes
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.can_edit_workspace(workspace_id)));
revoke update on public.poll_votes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Plans: module access, read-only accounts and item limits
-- ---------------------------------------------------------------------------

create trigger calendars_plan before insert or update or delete on public.calendars
  for each row execute function public.enforce_workspace_plan('calendar', 'items');
create trigger polls_plan before insert or update or delete on public.polls
  for each row execute function public.enforce_workspace_plan('polls', 'items');
create trigger sheets_plan before insert or update or delete on public.sheets
  for each row execute function public.enforce_workspace_plan('sheets', 'items');
create trigger calendar_events_plan before insert or update or delete on public.calendar_events
  for each row execute function public.enforce_workspace_plan('calendar');
create trigger poll_options_plan before insert or update or delete on public.poll_options
  for each row execute function public.enforce_workspace_plan('polls');
create trigger poll_votes_plan before insert or update or delete on public.poll_votes
  for each row execute function public.enforce_workspace_plan('polls');
create trigger sheet_cells_plan before insert or update or delete on public.sheet_cells
  for each row execute function public.enforce_workspace_plan('sheets');

create or replace function public.module_label(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'docs' then 'Docs' when 'whiteboard' then 'Whiteboard' when 'kanban' then 'Kanban'
    when 'chat' then 'Chat' when 'mindmap' then 'Mindmap' when 'code' then 'Code'
    when 'playlist' then 'Playlist' when 'shopping' then 'TODO List'
    when 'calendar' then 'Calendar' when 'polls' then 'Polls' when 'sheets' then 'Sheets'
    else p_module end;
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
    when 'playlist' then 'playlists' when 'shopping' then 'to-do lists'
    when 'calendar' then 'calendars' when 'polls' then 'polls' when 'sheets' then 'sheets'
    else 'items' end;
$$;

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
    'shopping', (select count(*) from public.shopping_lists where workspace_id = p_workspace_id),
    'calendar', (select count(*) from public.calendars where workspace_id = p_workspace_id),
    'polls', (select count(*) from public.polls where workspace_id = p_workspace_id),
    'sheets', (select count(*) from public.sheets where workspace_id = p_workspace_id)
  );
$$;

-- New workspaces get all eleven modules (same body as 20261023000010).
create or replace function public.create_workspace(
  p_name text,
  p_description text default '',
  p_icon text default '✦',
  p_color text default 'iris',
  p_modules text[] default array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping','calendar','polls','sheets']
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_ws uuid;
  v_all text[] := array['docs','whiteboard','kanban','chat','mindmap','code','playlist','shopping','calendar','polls','sheets'];
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

-- Existing workspaces: add the three modules, on where the plan includes them
-- (otherwise off and flagged, so an upgrade switches them on).
insert into public.workspace_modules (workspace_id, module_type, enabled, position, plan_disabled)
select w.id, m.module_type, m.module_type = any (e.modules), m.position, not (m.module_type = any (e.modules))
from public.workspaces w
cross join (values ('calendar', 8), ('polls', 9), ('sheets', 10)) as m(module_type, position)
cross join lateral public.workspace_entitlements(w.id) e
where not exists (
  select 1 from public.workspace_modules x where x.workspace_id = w.id and x.module_type = m.module_type
);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['calendars','calendar_events','polls','poll_options','poll_votes','sheets','sheet_cells'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

revoke execute on function public.calendar_event_attendees() from public, anon, authenticated;
revoke execute on function public.calendar_event_notify() from public, anon, authenticated;
revoke execute on function public.poll_is_open(uuid) from public, anon, authenticated;
revoke execute on function public.poll_vote_before_insert() from public, anon, authenticated;
revoke execute on function public.poll_vote_count() from public, anon, authenticated;
revoke execute on function public.poll_option_protect_count() from public, anon, authenticated;
revoke execute on function public.poll_vote_delete_guard() from public, anon, authenticated;
revoke execute on function public.sheet_cell_author() from public, anon, authenticated;
