import type { Metadata } from "next";
import { getMyWorkspaces, getProfile, requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { Onboarding } from "@/components/workspace/onboarding";
import { Wordmark } from "@/components/shell/wordmark";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  await requireUser("/onboarding");
  const supabase = await createServerSupabase();
  const [profile, workspaces, { data: invitations }] = await Promise.all([
    getProfile(),
    getMyWorkspaces(),
    supabase.rpc("my_pending_invitations"),
  ]);
  return (
    <div className="min-h-dvh">
      <header className="px-6 py-5">
        <Wordmark href="/w" />
      </header>
      <main className="mx-auto max-w-xl px-6 pt-6 pb-20">
        <Onboarding
          initialName={profile?.display_name ?? ""}
          hasWorkspaces={workspaces.length > 0}
          invitations={invitations ?? []}
        />
      </main>
    </div>
  );
}
