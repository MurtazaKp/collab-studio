-- The "Shopping" module is now presented as "TODO List". Tables and URLs keep
-- their original names; only the notification wording changes here.

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
      public.actor_name() || ' assigned you a to-do', new.name || coalesce(' · ' || v_list, ''),
      '/w/' || new.workspace_id || '/shopping/' || new.list_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_on_shopping_item() from public, anon, authenticated;
