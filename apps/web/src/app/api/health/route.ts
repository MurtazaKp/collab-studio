import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      supabaseConfigured: isSupabaseConfigured(),
      collabConfigured: Boolean(process.env.NEXT_PUBLIC_COLLAB_URL && process.env.COLLAB_JWT_SECRET),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
