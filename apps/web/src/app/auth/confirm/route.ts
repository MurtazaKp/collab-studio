import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/env";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Where to go after confirming. Templates can pass `next` directly, or
 * `redirect_to={{ .RedirectTo }}`: the URL the app asked Supabase for (for
 * example /auth/confirm?next=/invite/…, so a sign-up started from an
 * invitation ends on the invitation). Only links back to this site count.
 */
function nextFrom(url: URL): string {
  const direct = url.searchParams.get("next");
  if (direct) return safeNextPath(direct, "/w");
  const redirectTo = url.searchParams.get("redirect_to");
  if (redirectTo) {
    try {
      const target = new URL(redirectTo);
      if (target.origin === url.origin) return safeNextPath(target.searchParams.get("next"), "/w");
    } catch {
      // Not a URL; fall through.
    }
  }
  return "/w";
}

/**
 * Email links (sign-up confirmation, password recovery) land here. Supports
 * both the token-hash template and the PKCE `code` redirect.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = nextFrom(url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const supabase = await createServerSupabase();

  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    // `next` may carry a query string (e.g. ?task=…); resolve it, don't assign it to pathname.
    return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : next, request.nextUrl.origin));
  } else {
    target.pathname = "/login";
    target.searchParams.set("error", "link_invalid");
  }
  return NextResponse.redirect(target);
}
