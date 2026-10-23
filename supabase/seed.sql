-- Local development seed.
--
-- Runs automatically after `supabase db reset` (local only; never in production).
-- It contains no users or credentials. Sign up through the app, then fill a
-- demo workspace for your account with:
--
--   npm run db:seed-demo -- you@example.com
--
-- or directly in SQL:   select dev.seed_demo_workspace('<your auth user id>');

create schema if not exists dev;
revoke all on schema dev from public;

create or replace function dev.seed_demo_workspace(p_owner uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_ws uuid;
  v_board uuid;
  v_backlog uuid;
  v_doing uuid;
  v_review uuid;
  v_done uuid;
  v_general uuid;
  v_design uuid;
  v_root uuid;
  v_playlist uuid;
  v_list uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'No profile for user %; sign up first', p_owner;
  end if;

  -- Act as the owner for the rest of this transaction so triggers attribute
  -- authorship and activity correctly.
  perform set_config('request.jwt.claims', json_build_object('sub', p_owner, 'role', 'authenticated')::text, true);

  v_ws := public.create_workspace('Demo Studio', 'Sample content for exploring CollabVerse.', '◆', 'teal');

  -- The demo shows every module, so it runs on a Team trial rather than Free.
  update public.workspace_subscriptions
     set plan_id = 'team', status = 'trialing', trial_ends_at = now() + interval '14 days'
   where workspace_id = v_ws;
  update public.workspace_modules set enabled = true where workspace_id = v_ws;

  insert into public.documents (workspace_id, title) values
    (v_ws, 'Welcome to CollabVerse'),
    (v_ws, 'Q4 product brief'),
    (v_ws, 'Meeting notes');
  insert into public.whiteboards (workspace_id, title) values (v_ws, 'Brainstorm');
  insert into public.mindmaps (workspace_id, title) values (v_ws, 'Launch plan');
  insert into public.code_projects (workspace_id, title) values (v_ws, 'Snippets');

  insert into public.boards (workspace_id, title, description)
  values (v_ws, 'Product roadmap', 'What we are building this quarter')
  returning id into v_board;

  insert into public.board_columns (workspace_id, board_id, title, position) values (v_ws, v_board, 'Backlog', 'a0') returning id into v_backlog;
  insert into public.board_columns (workspace_id, board_id, title, position) values (v_ws, v_board, 'In progress', 'a1') returning id into v_doing;
  insert into public.board_columns (workspace_id, board_id, title, position) values (v_ws, v_board, 'Review', 'a2') returning id into v_review;
  insert into public.board_columns (workspace_id, board_id, title, position) values (v_ws, v_board, 'Done', 'a3') returning id into v_done;

  insert into public.tasks (workspace_id, board_id, column_id, title, description, priority, labels, position, due_date) values
    (v_ws, v_board, v_backlog, 'Interview five beta users', 'Focus on how teams split work between docs and boards.', 'medium', array['research'], 'a0', current_date + 10),
    (v_ws, v_board, v_backlog, 'Draft pricing page copy', '', 'low', array['marketing'], 'a1', null),
    (v_ws, v_board, v_doing, 'Offline reconnection polish', 'Show a clear banner while the collaboration socket reconnects.', 'high', array['frontend'], 'a0', current_date + 3),
    (v_ws, v_board, v_review, 'Invite flow copy review', '', 'medium', array['ux'], 'a0', current_date + 1),
    (v_ws, v_board, v_done, 'Set up RLS test suite', 'Cross-tenant read/write attempts for every table.', 'urgent', array['security'], 'a0', null);

  select id into v_general from public.channels where workspace_id = v_ws and name = 'general';
  insert into public.channels (workspace_id, name, topic) values (v_ws, 'design', 'Critiques, inspiration and WIP') returning id into v_design;

  insert into public.messages (workspace_id, channel_id, body) values
    (v_ws, v_general, 'Welcome to the demo workspace! Every module here is live; open this page in a second browser to see it sync.'),
    (v_ws, v_general, 'Try dragging a card on the roadmap board while someone else watches.');
  insert into public.messages (workspace_id, channel_id, body) values
    (v_ws, v_design, 'Sticky-note colours on the whiteboard now match the module palette.')
  returning id into v_root;
  insert into public.messages (workspace_id, channel_id, body, parent_id) values
    (v_ws, v_design, 'Nice. Can we get a darker ink option for connectors?', v_root);

  insert into public.playlists (workspace_id, title, description)
  values (v_ws, 'Deep focus', 'Long instrumental pieces for heads-down work') returning id into v_playlist;
  insert into public.playlist_items (workspace_id, playlist_id, title, artist, url, position) values
    (v_ws, v_playlist, 'Sample track one', 'Sample artist', 'https://example.com/tracks/one', 'a0'),
    (v_ws, v_playlist, 'Sample track two', 'Sample artist', 'https://example.com/tracks/two', 'a1'),
    (v_ws, v_playlist, 'Sample track three', 'Another artist', 'https://example.com/tracks/three', 'a2');

  insert into public.shopping_lists (workspace_id, title) values (v_ws, 'Team offsite') returning id into v_list;
  insert into public.shopping_items (workspace_id, list_id, name, quantity, unit, category, position, checked) values
    (v_ws, v_list, 'Sparkling water', 12, 'bottles', 'Drinks', 'a0', false),
    (v_ws, v_list, 'Coffee beans', 2, 'kg', 'Drinks', 'a1', true),
    (v_ws, v_list, 'Sticky notes', 6, 'packs', 'Supplies', 'a2', false),
    (v_ws, v_list, 'Fruit', 1, 'basket', 'Food', 'a3', false);

  return v_ws;
end;
$$;

revoke execute on function dev.seed_demo_workspace(uuid) from public;
