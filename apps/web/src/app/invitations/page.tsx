import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { Wordmark } from "@/components/shell/wordmark";
import { PendingInvitations } from "@/components/workspace/pending-invitations";

export const metadata: Metadata = { title: "Invitations" };

export default async function InvitationsPage() {
  await requireUser("/invitations");
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("my_pending_invitations");
  return (
    <div className="min-h-dvh">
      <header className="px-6 py-5">
        <Wordmark href="/w" />
      </header>
      <main className="mx-auto max-w-xl px-6 pt-6 pb-16">
        <h1 className="font-display text-[36px] text-text">Invitations</h1>
        <p className="mt-1 text-[14px] text-muted">Workspaces that invited your verified email address.</p>
        <div className="mt-8">
          <PendingInvitations invitations={data ?? []} />
        </div>
      </main>
    </div>
  );
}
