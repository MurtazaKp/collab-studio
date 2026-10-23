"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, isRole } from "@collabverse/shared";
import { acceptInvitationAction } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { colorVar } from "@/lib/utils";

export function AcceptInvite({
  token,
  invite,
}: {
  token: string;
  invite: { workspace_name: string; workspace_icon: string; workspace_color: string; role: string; inviter_name: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const role = isRole(invite.role) ? invite.role : null;
  return (
    <div className="animate-pop-in text-center">
      <span
        className="mx-auto flex size-14 items-center justify-center rounded-2xl text-2xl text-white shadow-md"
        style={{ background: colorVar(invite.workspace_color) }}
      >
        {invite.workspace_icon}
      </span>
      <p className="mt-6 text-[14px] text-muted">{invite.inviter_name} invited you to join</p>
      <h1 className="mt-1 font-display text-[36px] leading-tight text-text">{invite.workspace_name}</h1>
      {role ? (
        <p className="mt-2 text-[13.5px] text-text-2">
          as <strong className="font-semibold">{ROLE_LABELS[role]}</strong> — {ROLE_DESCRIPTIONS[role].toLowerCase()}
        </p>
      ) : null}
      {error ? <Notice tone="danger" className="mt-6 text-left">{error}</Notice> : null}
      <Button
        variant="primary"
        size="lg"
        className="mt-8 w-full"
        loading={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptInvitationAction(token);
            if (!res.ok) setError(res.error);
            else router.push(`/w/${res.data.workspaceId}`);
          })
        }
      >
        Accept and join
      </Button>
    </div>
  );
}
