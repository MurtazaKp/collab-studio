/**
 * Public (browser-safe) configuration. NEXT_PUBLIC_* values are inlined at
 * build time, so each must be referenced literally.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  collabUrl: process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:1234",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  googleAuthEnabled: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true",
} as const;

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseKey);
}

/** Resolve a user-supplied `next` path, allowing only same-origin relative paths. */
export function safeNextPath(next: string | null | undefined, fallback = "/w"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Browsers strip tabs/newlines, which could turn "/<TAB>/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://same.origin");
    if (url.origin !== "http://same.origin") return fallback;
  } catch {
    return fallback;
  }
  return next;
}
