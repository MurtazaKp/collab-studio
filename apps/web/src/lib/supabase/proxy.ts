import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

const PUBLIC_PATHS = ["/", "/pricing", "/login", "/signup", "/forgot-password", "/auth", "/api/health", "/setup"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * Refreshes the Supabase session cookie on every request and performs the
 * optimistic redirect for signed-out visitors. Authorization itself happens
 * in server components, route handlers and the database (RLS).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (!isSupabaseConfigured()) {
    if (pathname === "/setup" || pathname.startsWith("/api/health")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Validates the JWT (locally with asymmetric keys, otherwise via Auth).
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    signedIn = false;
  }

  if (!signedIn && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (signedIn && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/w";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
