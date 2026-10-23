import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isRole } from "@collabverse/shared";
import { ShieldCheck } from "lucide-react";
import { getProfile, requireUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { Wordmark } from "@/components/shell/wordmark";
import { Avatar } from "@/components/ui/misc";
import { WorkspacesHub, type HubWorkspace } from "@/components/workspace/workspaces-hub";

export const metadata: Metadata = { title: "Your workspaces" };

/** Home after sign-in: every workspace you belong to, plus creating new ones. */
export default async function WorkspacesPage() {
  const user = await requireUser("/w");
  const supabase = await createServerSupabase();
  const [profile, memberships, invites, staff] = await Promise.all([
    getProfile(),
    supabase
      .from("workspace_members")
      .select("role, workspace:workspaces!inner(id, name, description, icon, color, updated_at)")
      .eq("user_id", user.id),
    supabase.rpc("my_pending_invitations"),
    isPlatformAdmin(),
  ]);
  if (memberships.error) throw memberships.error;
  const rows = memberships.data ?? [];
  if (rows.length === 0) redirect("/onboarding");

  // Member counts (RLS lets you read memberships of your own workspaces).
  const ids = rows.map((r) => r.workspace.id);
  const { data: allMembers, error: membersError } = await supabase.from("workspace_members").select("workspace_id").in("workspace_id", ids);
  if (membersError) throw membersError;
  const counts = new Map<string, number>();
  for (const m of allMembers ?? []) counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1);

  const workspaces: HubWorkspace[] = rows.map((r) => ({
    id: r.workspace.id,
    name: r.workspace.name,
    description: r.workspace.description,
    icon: r.workspace.icon,
    color: r.workspace.color,
    role: isRole(r.role) ? r.role : "viewer",
    members: counts.get(r.workspace.id) ?? 1,
    updatedAt: r.workspace.updated_at,
  }));

  const name = profile?.display_name || "there";
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark href="/w" />
        <div className="flex items-center gap-1">
          {staff ? (
            <Link href="/admin" className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-text-2 hover:bg-surface-2 hover:text-text">
              <ShieldCheck aria-hidden className="size-4" />
              <span className="hidden sm:inline">Admin console</span>
              <span className="sr-only sm:hidden">Admin console</span>
            </Link>
          ) : null}
          <Link href="/account" className="flex items-center gap-2 rounded-lg p-1.5 text-[13px] text-text-2 hover:bg-surface-2 hover:text-text">
            <Avatar name={name} color={profile?.avatar_color} size={26} />
            <span className="hidden sm:inline">Account</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 pt-6 pb-16">
        <WorkspacesHub
          name={name}
          workspaces={workspaces}
          lastWorkspaceId={profile?.last_workspace_id ?? null}
          pendingInvites={invites.data?.length ?? 0}
        />
      </main>
    </div>
  );
}
