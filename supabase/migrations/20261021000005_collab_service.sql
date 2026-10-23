-- Database surface for the collaboration server.
--
-- The collaboration server connects with a dedicated, least-privilege role
-- (`collab_server`) instead of the service-role key. It can resolve room
-- access, read/write the Yjs update log and snapshots, and record derived
-- previews — nothing else. The `collab` schema is not exposed through the
-- Supabase Data API.

create schema if not exists collab;
revoke all on schema collab from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'collab_server') then
    create role collab_server nologin noinherit;
  end if;
end;
$$;

-- Authoritative access check, run on every connection and periodically for
-- every open session. Returns no row unless `p_user_id` is currently a member
-- of the room's workspace.
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
    m.role,
    coalesce(wm.enabled, false)
  from public.collaboration_rooms r
  join public.workspace_members m on m.workspace_id = r.workspace_id and m.user_id = p_user_id
  left join public.documents d on d.id = r.document_id
  left join public.whiteboards wb on wb.id = r.whiteboard_id
  left join public.mindmaps mm on mm.id = r.mindmap_id
  left join public.code_projects cp on cp.id = r.code_project_id
  left join public.workspace_modules wm
    on wm.workspace_id = r.workspace_id
   and wm.module_type = case r.kind when 'document' then 'docs' else r.kind end
  where r.name = p_room_name;
$$;

-- Record a derived plain-text preview and last-edit metadata on the entity row.
create or replace function collab.save_preview(p_room_id uuid, p_preview text, p_editor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.collaboration_rooms%rowtype;
  v_editor uuid;
  v_preview text := left(coalesce(p_preview, ''), 500);
begin
  select * into r from public.collaboration_rooms where id = p_room_id;
  if not found then
    return;
  end if;
  -- Only attribute edits to people who are still members.
  select m.user_id into v_editor from public.workspace_members m
   where m.workspace_id = r.workspace_id and m.user_id = p_editor;

  if r.kind = 'document' then
    update public.documents set preview_text = v_preview, content_updated_at = now(),
      last_edited_by = coalesce(v_editor, last_edited_by) where id = r.document_id;
  elsif r.kind = 'whiteboard' then
    update public.whiteboards set preview_text = v_preview, content_updated_at = now(),
      last_edited_by = coalesce(v_editor, last_edited_by) where id = r.whiteboard_id;
  elsif r.kind = 'mindmap' then
    update public.mindmaps set preview_text = v_preview, content_updated_at = now(),
      last_edited_by = coalesce(v_editor, last_edited_by) where id = r.mindmap_id;
  elsif r.kind = 'code' then
    update public.code_projects set preview_text = v_preview, content_updated_at = now(),
      last_edited_by = coalesce(v_editor, last_edited_by) where id = r.code_project_id;
  end if;
end;
$$;

revoke execute on function collab.room_access(text, uuid) from public, anon, authenticated;
revoke execute on function collab.save_preview(uuid, text, uuid) from public, anon, authenticated;

grant usage on schema collab to collab_server;
grant usage on schema public to collab_server;
grant execute on function collab.room_access(text, uuid) to collab_server;
grant execute on function collab.save_preview(uuid, text, uuid) to collab_server;

grant select on public.collaboration_rooms to collab_server;
grant select, insert, delete on public.collaboration_updates to collab_server;
grant select, insert, update on public.collaboration_snapshots to collab_server;

create policy "rooms: collab server read" on public.collaboration_rooms
  for select to collab_server using (true);
create policy "updates: collab server" on public.collaboration_updates
  for all to collab_server using (true) with check (true);
create policy "snapshots: collab server" on public.collaboration_snapshots
  for all to collab_server using (true) with check (true);
