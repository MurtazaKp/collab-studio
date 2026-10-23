import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { Wordmark } from "@/components/shell/wordmark";

export const dynamic = "force-dynamic";

/** Shown instead of the app when required environment variables are missing. */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  const vars = [
    ["NEXT_PUBLIC_SUPABASE_URL", "Project URL from Supabase → Project Settings → API"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Publishable (or legacy anon) key — safe for the browser"],
    ["NEXT_PUBLIC_COLLAB_URL", "WebSocket URL of the collaboration server, e.g. ws://localhost:1234"],
    ["COLLAB_JWT_SECRET", "Shared secret (32+ chars) with the collaboration server — server-only"],
    ["NEXT_PUBLIC_SITE_URL", "Public URL of this app, used in email links"],
  ];
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Wordmark />
      <h1 className="mt-10 font-display text-[38px] leading-tight text-text">Finish configuring CollabVerse</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text-2">
        This deployment can&apos;t reach Supabase yet. Add the variables below to <code className="font-mono text-[13px]">apps/web/.env.local</code>{" "}
        (or your hosting provider&apos;s environment settings) and restart. See <code className="font-mono text-[13px]">README.md</code> for the full
        setup, including database migrations.
      </p>
      <dl className="mt-8 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {vars.map(([name, desc]) => (
          <div key={name} className="px-4 py-3">
            <dt className="font-mono text-[13px] text-text">{name}</dt>
            <dd className="mt-0.5 text-[13px] text-muted">{desc}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
