"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Mail, Plus, Users } from "lucide-react";
import { ROLE_LABELS, type Role } from "@collabverse/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WorkspaceForm } from "@/components/workspace/onboarding";
import { colorVar, timeAgo } from "@/lib/utils";

export interface HubWorkspace {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  role: Role;
  members: number;
  updatedAt: string;
}

export function WorkspacesHub({
  name,
  workspaces,
  lastWorkspaceId,
  pendingInvites,
}: {
  name: string;
  workspaces: HubWorkspace[];
  lastWorkspaceId: string | null;
  pendingInvites: number;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const ordered = [...workspaces].sort((a, b) =>
    a.id === lastWorkspaceId ? -1 : b.id === lastWorkspaceId ? 1 : a.name.localeCompare(b.name),
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">Welcome back, {name.split(" ")[0]}</p>
          <h1 className="mt-1 font-display text-[38px] leading-tight tracking-tight text-text">Your workspaces</h1>
          <p className="mt-1 text-[14px] text-text-2">
            Each workspace has its own people, modules and content. Open one to start working.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New workspace
        </Button>
      </div>

      {pendingInvites > 0 ? (
        <Link
          href="/invitations"
          className="mt-6 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 px-4 py-3 text-[14px] text-text transition-colors hover:bg-accent-soft/70"
        >
          <Mail className="size-4 text-accent" aria-hidden />
          <span className="flex-1">
            You have {pendingInvites} pending invitation{pendingInvites === 1 ? "" : "s"}.
          </span>
          <span className="font-medium text-accent">Review</span>
        </Link>
      ) : null}

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((w) => (
          <li key={w.id}>
            <Link
              href={`/w/${w.id}`}
              className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg text-white shadow-sm"
                  style={{ background: colorVar(w.color) }}
                >
                  {w.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[16px] font-semibold text-text">{w.name}</h2>
                  <p className="text-[12.5px] text-muted">
                    {ROLE_LABELS[w.role]}
                    {w.id === lastWorkspaceId ? " · last opened" : ""}
                  </p>
                </div>
                <ArrowRight
                  aria-hidden
                  className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text"
                />
              </div>
              <p className="mt-3 line-clamp-2 flex-1 text-[13.5px] leading-relaxed text-text-2">
                {w.description || " "}
              </p>
              <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-muted">
                <Users className="size-3.5" aria-hidden />
                {w.members} member{w.members === 1 ? "" : "s"} · updated {timeAgo(w.updatedAt)}
              </p>
            </Link>
          </li>
        ))}
        <li>
          <button
            onClick={() => setCreating(true)}
            className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong text-[14px] text-muted transition-colors hover:border-accent hover:bg-surface hover:text-text"
          >
            <Plus className="size-5" aria-hidden />
            Create another workspace
          </button>
        </li>
      </ul>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New workspace" description="Workspaces keep their own members, modules and content." wide>
          <WorkspaceForm
            onCreated={(id) => {
              setCreating(false);
              router.push(`/w/${id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
