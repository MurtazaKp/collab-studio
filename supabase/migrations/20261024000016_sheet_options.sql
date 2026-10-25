-- Sheets options: cell formatting, column widths, a frozen header, and
-- inserting/deleting rows and columns.
--
--   * sheet_cells.format  bold/italic/colours/alignment/number format, as a
--     small JSON object (the app validates the keys; the database caps size).
--   * sheets.col_widths   {"<column index>": pixels}; sheets.frozen_rows.
--   * sheet_shift()       inserts or deletes rows/columns by moving cells in one
--     locked step. It runs with the caller's rights (RLS and plan checks apply),
--     so only editors can use it.

alter table public.sheet_cells
  add column format jsonb not null default '{}'::jsonb
    check (jsonb_typeof(format) = 'object' and pg_column_size(format) <= 512);

alter table public.sheets
  add column col_widths jsonb not null default '{}'::jsonb
    check (jsonb_typeof(col_widths) = 'object' and pg_column_size(col_widths) <= 4096),
  add column frozen_rows integer not null default 0 check (frozen_rows between 0 and 10);

create or replace function public.sheet_shift(p_sheet_id uuid, p_axis text, p_at integer, p_delta integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sheet public.sheets;
  v_cells jsonb;
  v_max integer;
  v_from integer;
  v_updated integer;
begin
  if p_axis is null or p_axis not in ('row','col') or p_delta is null or p_delta = 0 or abs(p_delta) > 1000
     or p_at is null or p_at < 0 then
    raise exception 'Invalid row or column change' using errcode = '22023';
  end if;
  v_max := case when p_axis = 'row' then 999 else 51 end;

  -- Members can see the sheet; the update below locks it and checks edit rights.
  select * into v_sheet from public.sheets where id = p_sheet_id;
  if not found then
    raise exception 'Sheet not found' using errcode = 'P0002';
  end if;

  -- Resize first (this takes the row lock that serialises shifts): RLS turns
  -- it into a no-op for anyone who can't edit.
  update public.sheets s
     set row_count = case when p_axis = 'row' then least(greatest(row_count + p_delta, 1), 1000) else row_count end,
         col_count = case when p_axis = 'col' then least(greatest(col_count + p_delta, 1), 52) else col_count end,
         col_widths = case when p_axis = 'col' then coalesce((
           select jsonb_object_agg((e.k::int + case when e.k::int >= p_at then p_delta else 0 end)::text, e.v)
           from jsonb_each(s.col_widths) as e(k, v)
           where e.k ~ '^\d+$'
             and not (p_delta < 0 and e.k::int >= p_at and e.k::int < p_at - p_delta)
             and e.k::int + case when e.k::int >= p_at then p_delta else 0 end between 0 and 51
         ), '{}'::jsonb) else col_widths end
   where s.id = p_sheet_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'You don''t have permission to change this sheet' using errcode = '42501';
  end if;

  -- Cells that move: everything from the insert point, or after the deleted block.
  v_from := case when p_delta > 0 then p_at else p_at - p_delta end;
  select coalesce(jsonb_agg(jsonb_build_object('r', c.row_index, 'c', c.col_index, 'v', c.value, 'f', c.format)), '[]'::jsonb)
    into v_cells
    from public.sheet_cells c
   where c.sheet_id = p_sheet_id
     and (case when p_axis = 'row' then c.row_index else c.col_index end) >= v_from;

  delete from public.sheet_cells c
   where c.sheet_id = p_sheet_id
     and (case when p_axis = 'row' then c.row_index else c.col_index end) >= p_at;

  insert into public.sheet_cells (workspace_id, sheet_id, row_index, col_index, value, format)
  select v_sheet.workspace_id, p_sheet_id,
         (x ->> 'r')::int + case when p_axis = 'row' then p_delta else 0 end,
         (x ->> 'c')::int + case when p_axis = 'col' then p_delta else 0 end,
         x ->> 'v', x -> 'f'
    from jsonb_array_elements(v_cells) as x
   where (case when p_axis = 'row' then (x ->> 'r')::int else (x ->> 'c')::int end) + p_delta between 0 and v_max;
end;
$$;

revoke execute on function public.sheet_shift(uuid, text, integer, integer) from public, anon;
grant execute on function public.sheet_shift(uuid, text, integer, integer) to authenticated;
