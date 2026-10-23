import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { Wordmark } from "@/components/shell/wordmark";
import { AcceptInvite } from "@/components/workspace/accept-invite";
import { Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/invite/${token}`);
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("get_invitation_preview", { p_token: token });
  const invite = data?.[0];

  let body: React.ReactNode;
  if (!invite) {
    body = <Notice tone="danger">This invitation link isn&apos;t valid. Ask whoever invited you for a new one.</Notice>;
  } else if (invite.status !== "pending") {
    body = (
      <Notice tone="warning">
        This invitation {invite.status === "expired" ? "has expired" : invite.status === "revoked" ? "was revoked" : "was already used"}.
        {invite.status === "accepted" ? (
          <>
            {" "}
            <Link className="underline" href="/w">
              Go to your workspaces
            </Link>
          </>
        ) : (
          " Ask for a new one."
        )}
      </Notice>
    );
  } else if (!invite.email_matches) {
    body = (
      <div className="flex flex-col gap-4">
        <Notice tone="warning">
          This invitation was sent to a different email address than the one you&apos;re signed in with ({user.email}). Sign in with the
          invited address to accept it.
        </Notice>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out and switch account
          </Button>
        </form>
      </div>
    );
  } else {
    body = <AcceptInvite token={token} invite={invite} />;
  }

  return (
    <div className="min-h-dvh">
      <header className="px-6 py-5">
        <Wordmark href="/w" />
      </header>
      <main className="mx-auto max-w-md px-6 pt-10">{body}</main>
    </div>
  );
}
