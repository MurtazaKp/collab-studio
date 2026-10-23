-- Realtime publication, private-channel authorization and storage policies.
-- Each block is guarded so the migration also applies to plain PostgreSQL
-- (used by the automated database tests) where these Supabase schemas may
-- be absent.

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Postgres Changes: structured modules stream row changes to subscribers.
-- Supabase Realtime evaluates each subscriber's RLS policies per change, so a
-- removed member stops receiving events immediately.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array[
    'workspaces','workspace_members','workspace_modules',
    'documents','whiteboards','mindmaps','code_projects',
    'boards','board_columns','tasks','comments',
    'channels','messages','message_reactions',
    'playlists','playlist_items','shopping_lists','shopping_items',
    'activity_events','notifications','attachments'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime Authorization for private Broadcast/Presence channels.
-- Topics are `ws:<workspace uuid>` (presence, typing indicators).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not found; skipping realtime policies';
    return;
  end if;

  execute $p$
    create policy "realtime: members receive workspace topics" on realtime.messages
      for select to authenticated
      using (
        realtime.topic() like 'ws:%'
        and (select public.is_workspace_member(public.try_uuid(substr(realtime.topic(), 4))))
      )
  $p$;

  execute $p$
    create policy "realtime: members send workspace topics" on realtime.messages
      for insert to authenticated
      with check (
        realtime.topic() like 'ws:%'
        and (select public.is_workspace_member(public.try_uuid(substr(realtime.topic(), 4))))
      )
  $p$;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: a private bucket; object keys start with the workspace id.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found; skipping storage setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'attachments', 'attachments', false, 10485760,
    array['image/png','image/jpeg','image/gif','image/webp','application/pdf',
          'text/plain','text/markdown','text/csv','application/zip']
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy "attachments: members read objects" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'attachments'
        and (select public.is_workspace_member(public.try_uuid((storage.foldername(name))[1])))
      )
  $p$;

  execute $p$
    create policy "attachments: editors upload objects" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'attachments'
        and (select public.can_edit_workspace(public.try_uuid((storage.foldername(name))[1])))
      )
  $p$;

  execute $p$
    create policy "attachments: uploader or manager delete objects" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'attachments'
        and (
          (owner_id = (select auth.uid())::text
            and (select public.can_edit_workspace(public.try_uuid((storage.foldername(name))[1]))))
          or (select public.can_manage_workspace(public.try_uuid((storage.foldername(name))[1])))
        )
      )
  $p$;
end;
$$;
