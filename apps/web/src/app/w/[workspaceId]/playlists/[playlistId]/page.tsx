import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadPlaylistItems } from "@/lib/data/lists";
import { PlaylistView } from "@/components/modules/playlist/playlist-view";

type Params = Promise<{ workspaceId: string; playlistId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, playlistId } = await params;
  return { title: (await getItemOr404("playlists", playlistId, workspaceId)).title };
}

export default async function PlaylistPage({ params }: { params: Params }) {
  const { workspaceId, playlistId } = await params;
  await requireModule(workspaceId, "playlist");
  const playlist = await getItemOr404("playlists", playlistId, workspaceId);
  const items = await loadPlaylistItems(await createServerSupabase(), playlistId);
  return <PlaylistView playlist={playlist} initialItems={items} />;
}
