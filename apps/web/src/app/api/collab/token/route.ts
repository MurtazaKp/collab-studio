import { NextResponse } from "next/server";
import { z } from "zod";
import { parseRoomName } from "@collabverse/shared";
import { COLLAB_TOKEN_TTL_SECONDS, signCollabToken } from "@collabverse/shared/collab-token";
import { createServerSupabase } from "@/lib/supabase/server";
import { collabJwtSecret } from "@/lib/server-env";

const bodySchema = z.object({ room: z.string().max(64) });

const noStore = { "Cache-Control": "no-store" };

/**
 * Issues a short-lived collaboration token for one room. The room is resolved
 * with the caller's own RLS-scoped session, so non-members get a 404. The
 * collaboration server independently re-checks membership on connect.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parseRoomName(parsed.data.room)) {
    return NextResponse.json({ error: "invalid_room" }, { status: 400, headers: noStore });
  }
  const room = parsed.data.room;

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const { data: roomRow } = await supabase.from("collaboration_rooms").select("id").eq("name", room).maybeSingle();
  if (!roomRow) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", auth.user.id).maybeSingle();

  const token = await signCollabToken(
    { userId: auth.user.id, room, name: profile?.display_name || undefined },
    collabJwtSecret(),
  );
  return NextResponse.json({ token, expiresIn: COLLAB_TOKEN_TTL_SECONDS }, { headers: noStore });
}
