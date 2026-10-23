-- Module operations that must succeed or fail as a unit. These run as the
-- caller (SECURITY INVOKER), so the normal RLS policies still apply.

create or replace function public.create_board(p_workspace_id uuid, p_title text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_board uuid;
begin
  insert into public.boards (workspace_id, title) values (p_workspace_id, trim(p_title)) returning id into v_board;
  insert into public.board_columns (workspace_id, board_id, title, position) values
    (p_workspace_id, v_board, 'To do', 'a0'),
    (p_workspace_id, v_board, 'In progress', 'a1'),
    (p_workspace_id, v_board, 'Done', 'a2');
  return v_board;
end;
$$;

-- Move a task to a column/position, failing on a stale version so concurrent
-- edits are detected instead of silently overwritten.
create or replace function public.move_task(
  p_task_id uuid,
  p_column_id uuid,
  p_position text,
  p_expected_version integer
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_ws uuid;
begin
  select workspace_id into v_ws from public.tasks where id = p_task_id;
  if v_ws is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'You don''t have permission to move tasks' using errcode = '42501';
  end if;
  update public.tasks
     set column_id = p_column_id, position = p_position
   where id = p_task_id and version = p_expected_version
  returning * into v_task;
  if v_task.id is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception 'Task was changed by someone else' using errcode = '40001';
    end if;
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  return v_task;
end;
$$;

revoke execute on function public.create_board(uuid, text) from public, anon;
revoke execute on function public.move_task(uuid, uuid, text, integer) from public, anon;
grant execute on function public.create_board(uuid, text) to authenticated;
grant execute on function public.move_task(uuid, uuid, text, integer) to authenticated;
