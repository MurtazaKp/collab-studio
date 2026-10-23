import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/env";

/** OAuth (e.g. Google) PKCE callback. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/w");
  const target = request.nextUrl.clone();
  target.search = "";
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    }
  }
  target.pathname = "/login";
  target.searchParams.set("error", "oauth");
  return NextResponse.redirect(target);
}
