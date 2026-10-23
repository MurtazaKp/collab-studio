"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, HardDrive, Lock, Users } from "lucide-react";
import { MODULES, MODULE_TYPES } from "@collabverse/shared";
import type { WorkspaceBilling } from "@/lib/billing";
import { STATUS_TONES, daysUntil, formatBytes, formatPrice, formatStorageMb, statusSummary } from "@/lib/billing";
import { UPGRADE_HREF } from "@/lib/notify-error";
import { ctaClass } from "@/components/marketing/cta";
import { planById } from "@/components/marketing/plans";
import { Badge, Notice } from "@/components/ui/misc";
import { ModuleIcon } from "@/components/ui/module-icon";
import { UsageMeter } from "@/components/ui/usage-meter";
import { formatDate } from "@/lib/utils";

const MB = 1024 * 1024;

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function StateLine({ billing }: { billing: WorkspaceBilling }) {
  if (billing.status === "suspended") return <>Suspended by CollabVerse. Content is read-only until it&apos;s reactivated.</>;
  if (billing.status === "canceled") return <>Canceled. Content is read-only until a plan is chosen.</>;
  if (billing.status === "trialing" && billing.trialEndsAt) {
    if (billing.trialExpired) return <>The trial ended on {longDate(billing.trialEndsAt)}; Free limits apply.</>;
    const days = daysUntil(billing.trialEndsAt);
    return (
      <>
        {planById(billing.subscribedPlanId)?.name ?? "Paid"} trial ends {days <= 1 ? "tomorrow" : `in ${days} days`} ({formatDate(billing.trialEndsAt)}).
      </>
    );
  }
  if (billing.status === "past_due") return <>The last payment didn&apos;t go through. Everything keeps working for now.</>;
  if (billing.currentPeriodEnd) return <>Renews {longDate(billing.currentPeriodEnd)}.</>;
  if (billing.planId === "custom") return <>Custom plan, priced for your organisation.</>;
  return billing.monthlyPriceCents === 0 ? <>Free, for as long as you like.</> : <>One price covers all of the account&apos;s workspaces.</>;
}

/** Current plan, status and usage against the plan's limits (settings → General). */
export function PlanUsageCard({ billing }: { billing: WorkspaceBilling | null }) {
  if (!billing) {
    return (
      <section className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-text">Plan</h2>
        <p className="mt-1 text-[13px] text-muted">Plan details couldn&apos;t be loaded. Limits still apply; try refreshing.</p>
      </section>
    );
  }

  const isFree = billing.planId === "free";
  const storageLimit = billing.storageMb === null ? null : billing.storageMb * MB;
  const included = MODULE_TYPES.filter((m) => billing.modules.includes(m));
  const locked = MODULE_TYPES.filter((m) => !billing.modules.includes(m));

  return (
    <section aria-labelledby="plan-title" className="mb-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2/40 p-5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
            {billing.isOwner ? "Your plan" : `Plan of ${billing.ownerName || "the workspace owner"}`}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h2 id="plan-title" className="font-display text-[32px] leading-none tracking-tight text-text">
              {billing.planName}
            </h2>
            <Badge tone={STATUS_TONES[billing.status]}>{statusSummary(billing)}</Badge>
          </div>
          <p className="mt-2 text-[13px] text-text-2">
            <span className="font-medium text-text tabular-nums">
              {billing.monthlyPriceCents === 0 ? "$0" : formatPrice(billing.monthlyPriceCents)}
            </span>
            <span className="text-muted"> / month · </span>
            <StateLine billing={billing} />
          </p>
        </div>
        {billing.planId !== "custom" ? (
          <Link href={UPGRADE_HREF} className={ctaClass(isFree ? "primary" : "outline", "md")}>
            {isFree ? "Upgrade" : "Compare plans"} <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>

      <div className="space-y-5 p-5">
        {!billing.writable ? (
          <Notice tone="warning">
            This workspace is read-only. Everyone can still open and read its content, but nothing can be created, edited or deleted.
          </Notice>
        ) : null}

        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <UsageMeter
            label={billing.isOwner ? "Your workspaces" : "Owner's workspaces"}
            icon={<Building2 />}
            used={billing.ownerWorkspaceCount}
            limit={billing.maxWorkspaces}
          />
          <UsageMeter label="People in this workspace" icon={<Users />} used={billing.memberCount} limit={billing.maxMembers} />
          <UsageMeter
            label="File storage"
            icon={<HardDrive />}
            used={billing.storageBytes}
            limit={storageLimit}
            format={(n) => (storageLimit !== null && n === storageLimit && billing.storageMb !== null ? formatStorageMb(billing.storageMb) : formatBytes(n))}
          />
        </div>

        <div>
          <h3 className="text-[13px] font-medium text-text">
            Items per tool
            <span className="font-normal text-muted">
              {billing.maxItemsPerModule === null ? " · unlimited on this plan" : ` · up to ${billing.maxItemsPerModule} each`}
            </span>
          </h3>
          <div className="mt-3 grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
            {included.map((m) => (
              <UsageMeter
                key={m}
                label={MODULES[m].label}
                icon={<ModuleIcon type={m} />}
                used={billing.usage[m]}
                limit={billing.maxItemsPerModule}
              />
            ))}
          </div>
        </div>

        {locked.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border-strong px-3.5 py-3">
            <Lock aria-hidden className="size-3.5 text-muted" />
            <span className="text-[13px] text-text-2">Included with Team and Business:</span>
            {locked.map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[12.5px] text-text-2">
                <ModuleIcon type={m} className="size-3.5" />
                {MODULES[m].label}
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-[12px] text-muted">
          The plan belongs to the workspace owner&apos;s account and covers every workspace they own. People, items and storage
          limits apply to each workspace and are enforced for everyone. Plan changes are made by the CollabVerse team while
          self-serve billing is being set up.
        </p>
      </div>
    </section>
  );
}
