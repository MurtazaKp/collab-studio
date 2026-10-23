"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | null = null;

/** One browser client per tab; it shares the cookie session with the server. */
export function getBrowserSupabase(): TypedSupabaseClient {
  if (!client) {
    client = createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey);
  }
  return client;
}
