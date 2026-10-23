"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { UPGRADE_HREF } from "@/lib/notify-error";

/** Explains why nothing can be edited while a workspace is suspended or canceled. */
export function ReadOnlyBanner() {
  const { billing, readOnly } = useWorkspace();
  if (!readOnly || !billing) return null;
  const suspended = billing.status === "suspended";
  return (
    <div role="status" className="flex shrink-0 items-center gap-2.5 border-b border-warning/25 bg-warning-soft px-4 py-2 text-[13px] text-text lg:px-6">
      <Lock aria-hidden className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{suspended ? "This workspace is suspended." : "This workspace's subscription is canceled."}</span>{" "}
        <span className="text-text-2">
          Everything stays readable, but nothing can be changed{suspended ? " until CollabVerse support reactivates it." : " until a plan is chosen."}
        </span>
      </p>
      {suspended ? null : (
        <Link href={UPGRADE_HREF} className="shrink-0 font-medium text-accent hover:underline">
          See plans
        </Link>
      )}
    </div>
  );
}
