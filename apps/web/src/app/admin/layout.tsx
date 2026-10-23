import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { Wordmark } from "@/components/shell/wordmark";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" } };

/** Platform admin console. Everyone who isn't a platform admin gets a 404. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 sm:px-6">
          <div className="flex h-14 items-center gap-3">
            <Wordmark href="/admin" />
            <span className="inline-flex h-6 items-center gap-1 rounded-md bg-text px-2 font-mono text-[11px] tracking-wider text-bg uppercase">
              <ShieldCheck aria-hidden className="size-3.5" /> Admin
            </span>
          </div>
          <AdminNav />
          <div className="ml-auto flex h-14 items-center gap-4 text-[13px]">
            <span className="hidden truncate text-muted md:inline" title="Signed in as">
              {user.email}
            </span>
            <Link href="/w" className="inline-flex items-center gap-1.5 text-text-2 hover:text-text">
              <ArrowLeft aria-hidden className="size-4" /> Back to app
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6">{children}</main>
    </div>
  );
}
