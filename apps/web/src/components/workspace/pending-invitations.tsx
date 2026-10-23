"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/notify-error";
import { Mail } from "lucide-react";
import { ROLE_LABELS, isRole } from "@collabverse/shared";
import { acceptInvitationByIdAction, declineInvitationAction } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { colorVar, timeAgo } from "@/lib/utils";

interface Invite {
  id: string;
  workspace_name: string;
  workspace_icon: string;
  workspace_color: string;
  role: string;
  inviter_name: string;
  expires_at: string;
}

export function PendingInvitations({ invitations }: { invitations: Invite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [list, setList] = useState(invitations);

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Mail />}
        title="No pending invitations"
        description="When someone invites your email address to a workspace, it shows up here."
        action={
          <Button variant="outline" onClick={() => router.push("/w")}>
            Back to workspaces
          </Button>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {list.map((inv) => (
        <li key={inv.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
          <span className="flex size-9 items-center justify-center rounded-lg text-white" style={{ background: colorVar(inv.workspace_color) }}>
            {inv.workspace_icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-text">{inv.workspace_name}</p>
            <p className="text-[12.5px] text-muted">
              {inv.inviter_name} · {isRole(inv.role) ? ROLE_LABELS[inv.role] : inv.role} · expires {timeAgo(inv.expires_at)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(inv.id);
              try {
                const res = await declineInvitationAction(inv.id);
                if (!res.ok) toastError(res.error);
                else setList((l) => l.filter((x) => x.id !== inv.id));
              } catch {
                toast.error("Your session may have expired. Refresh and sign in again.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Decline
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy === inv.id}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(inv.id);
              try {
                const res = await acceptInvitationByIdAction(inv.id);
                if (!res.ok) toastError(res.error);
                else router.push(`/w/${res.data.workspaceId}`);
              } catch {
                toast.error("Your session may have expired. Refresh and sign in again.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Join
          </Button>
        </li>
      ))}
    </ul>
  );
}
