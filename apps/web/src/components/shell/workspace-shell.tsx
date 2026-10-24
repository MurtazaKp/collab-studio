"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Menu as MenuIcon, X } from "lucide-react";
import type { Role } from "@collabverse/shared";
import { CollabRoot } from "@/lib/collab/react";
import { WorkspacePresenceProvider, usePresence } from "@/lib/realtime/presence";
import { WorkspaceProvider, useWorkspace, type WorkspaceInfo, type WorkspaceMember, type WorkspaceModuleInfo } from "@/lib/workspace-context";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { setLastWorkspaceAction } from "@/app/actions/workspace";
import { COLOR_HEX } from "@/lib/utils";
import type { WorkspaceBilling, WorkspaceWriteState } from "@/lib/billing";
import { ReadOnlyBanner } from "./read-only-banner";
import { Sidebar, type SwitcherWorkspace } from "./sidebar";
import { Logo } from "./wordmark";

export function WorkspaceShell({
  workspace,
  role,
  me,
  members,
  modules,
  billing,
  writeState,
  workspaces,
  children,
}: {
  workspace: WorkspaceInfo;
  role: Role;
  me: { id: string; name: string; color: string };
  members: WorkspaceMember[];
  modules: WorkspaceModuleInfo[];
  billing: WorkspaceBilling | null;
  writeState: WorkspaceWriteState | null;
  workspaces: SwitcherWorkspace[];
  children: React.ReactNode;
}) {
  const collabUser = { id: me.id, name: me.name, color: COLOR_HEX[me.color] ?? COLOR_HEX.iris! };
  return (
    <WorkspaceProvider workspace={workspace} role={role} me={me} members={members} modules={modules} billing={billing} writeState={writeState}>
      <WorkspacePresenceProvider workspaceId={workspace.id} me={collabUser}>
        <CollabRoot user={collabUser}>
          <MembershipWatcher />
          <PresenceLocation />
          <Frame workspaces={workspaces}>{children}</Frame>
        </CollabRoot>
      </WorkspacePresenceProvider>
    </WorkspaceProvider>
  );
}

function Frame({ workspaces, children }: { workspaces: SwitcherWorkspace[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the drawer so keyboard users land in the navigation.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-mobile-nav] a, [data-mobile-nav] button")?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden w-[248px] shrink-0 lg:block">
        <Sidebar workspaces={workspaces} />
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 animate-fade-in bg-[rgb(20_19_16/0.35)]" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div data-mobile-nav className="absolute inset-y-0 left-0 w-[272px] animate-pop-in shadow-lg">
            <Sidebar workspaces={workspaces} />
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:hidden">
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-md p-1.5 text-text-2 hover:bg-surface-2"
            aria-label={open ? "Close navigation" : "Open navigation"}
          >
            {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
          <Link href={`/w/${workspace.id}`} className="flex items-center gap-2 text-[14px] font-semibold text-text">
            <Logo className="size-5" />
            <span className="truncate">{workspace.name}</span>
          </Link>
        </div>
        <ReadOnlyBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

/** Tell teammates which part of the workspace we're looking at. */
function PresenceLocation() {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const { setLocation } = usePresence();
  useEffect(() => {
    const rest = pathname.replace(`/w/${workspace.id}`, "").replace(/^\//, "");
    setLocation(rest || "dashboard");
  }, [pathname, workspace.id, setLocation]);
  return null;
}

/**
 * Keeps membership, roles and modules fresh. If the current user is removed,
 * they're sent out of the workspace immediately (the database and the
 * collaboration server already deny access on their own).
 */
function MembershipWatcher() {
  const router = useRouter();
  const { workspace, me } = useWorkspace();

  useEffect(() => {
    void setLastWorkspaceAction(workspace.id);
  }, [workspace.id]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel(`membership:${workspace.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_members", filter: `workspace_id=eq.${workspace.id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspace_members", filter: `workspace_id=eq.${workspace.id}` }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "workspace_members" }, (payload) => {
        const old = payload.old as { workspace_id?: string; user_id?: string };
        if (old.workspace_id !== workspace.id) return;
        if (old.user_id === me.id) {
          toast.error("You were removed from this workspace.");
          router.replace("/w");
        } else refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_modules", filter: `workspace_id=eq.${workspace.id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspaces", filter: `id=eq.${workspace.id}` }, refresh)
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [workspace.id, me.id, router]);
  return null;
}
