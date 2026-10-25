import "server-only";
import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * The app's public base URL for links we hand out (emails, invitations).
 * Prefers NEXT_PUBLIC_SITE_URL, so a spoofed Host header can't point links at
 * another site; without it, uses the host this request arrived on (so links
 * are right on Vercel and locally even before the variable is set).
 */
export async function siteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return publicEnv.siteUrl.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
