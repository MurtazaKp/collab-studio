-- Index every foreign key that had no index led by its column, so deleting a
-- user account or a workspace doesn't scan whole tables to clear or cascade
-- references. Nullable "who did it" references use partial indexes to stay
-- small. Enforced by supabase/tests/migrations.test.ts (scripts/check-fk-indexes.ts).

create index if not exists activity_events_actor_idx on public.activity_events (actor_id) where actor_id is not null;
create index if not exists attachments_created_by_idx on public.attachments (created_by) where created_by is not null;
create index if not exists boards_created_by_idx on public.boards (created_by) where created_by is not null;
create index if not exists channel_reads_user_idx on public.channel_reads (user_id);
create index if not exists channels_created_by_idx on public.channels (created_by) where created_by is not null;
create index if not exists code_projects_created_by_idx on public.code_projects (created_by) where created_by is not null;
create index if not exists code_projects_last_edited_by_idx on public.code_projects (last_edited_by) where last_edited_by is not null;
create index if not exists comments_author_idx on public.comments (author_id) where author_id is not null;
create index if not exists dashboard_layouts_user_idx on public.dashboard_layouts (user_id);
create index if not exists documents_created_by_idx on public.documents (created_by) where created_by is not null;
create index if not exists documents_last_edited_by_idx on public.documents (last_edited_by) where last_edited_by is not null;
create index if not exists invitations_accepted_by_idx on public.invitations (accepted_by) where accepted_by is not null;
create index if not exists invitations_invited_by_idx on public.invitations (invited_by) where invited_by is not null;
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);
create index if not exists messages_author_idx on public.messages (author_id) where author_id is not null;
create index if not exists mindmaps_created_by_idx on public.mindmaps (created_by) where created_by is not null;
create index if not exists mindmaps_last_edited_by_idx on public.mindmaps (last_edited_by) where last_edited_by is not null;
create index if not exists notifications_actor_idx on public.notifications (actor_id) where actor_id is not null;
create index if not exists notifications_workspace_idx on public.notifications (workspace_id) where workspace_id is not null;
create index if not exists playlist_items_created_by_idx on public.playlist_items (created_by) where created_by is not null;
create index if not exists playlists_created_by_idx on public.playlists (created_by) where created_by is not null;
create index if not exists profiles_last_workspace_idx on public.profiles (last_workspace_id) where last_workspace_id is not null;
create index if not exists shopping_items_assignee_idx on public.shopping_items (assignee_id) where assignee_id is not null;
create index if not exists shopping_items_checked_by_idx on public.shopping_items (checked_by) where checked_by is not null;
create index if not exists shopping_items_created_by_idx on public.shopping_items (created_by) where created_by is not null;
create index if not exists shopping_lists_created_by_idx on public.shopping_lists (created_by) where created_by is not null;
create index if not exists tasks_created_by_idx on public.tasks (created_by) where created_by is not null;
create index if not exists whiteboards_created_by_idx on public.whiteboards (created_by) where created_by is not null;
create index if not exists whiteboards_last_edited_by_idx on public.whiteboards (last_edited_by) where last_edited_by is not null;
