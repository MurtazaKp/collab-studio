import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getProfile, requireUser } from "@/lib/auth";
import { AccountSettings } from "@/components/workspace/account-settings";
import { Wordmark } from "@/components/shell/wordmark";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/account");
  const profile = await getProfile();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark href="/w" />
        <Link href="/w" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Back to workspace
        </Link>
      </header>
      <main className="mx-auto max-w-xl px-6 pt-6 pb-16">
        <h1 className="font-display text-[36px] text-text">Account</h1>
        <AccountSettings
          email={user.email ?? ""}
          displayName={profile?.display_name ?? ""}
          avatarColor={profile?.avatar_color ?? "iris"}
        />
      </main>
    </div>
  );
}
