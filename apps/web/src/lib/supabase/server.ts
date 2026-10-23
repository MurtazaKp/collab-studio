import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * A Supabase client bound to the current request's cookies. Every query runs
 * as the signed-in user, so Row Level Security applies to server code too.
 * The service-role key is never used by the web app.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; the
          // proxy refreshes the session instead.
        }
      },
    },
  });
}
