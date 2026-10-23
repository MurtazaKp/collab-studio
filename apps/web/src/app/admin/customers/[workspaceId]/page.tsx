import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, HardDrive, Mail, Users } from "lucide-react";
import { MODULES, MODULE_TYPES, ROLE_LABELS, isRole } from "@collabverse/shared";
import { getCustomer } from "@/lib/admin";
import { formatBytes, formatStorageMb } from "@/lib/billing";
import { planById } from "@/components/marketing/plans";
import { AuditList } from "@/components/admin/audit-list";
import { PlanBadge, StatusBadge } from "@/components/admin/badges";
import { CustomerControls } from "@/components/admin/customer-controls";
import { Avatar, Badge } from "@/components/ui/misc";
import { ModuleIcon } from "@/components/ui/module-icon";
import { UsageMeter } from "@/components/ui/usage-meter";
import { colorVar, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Customer" };

const MB = 1024 * 1024;

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default async function CustomerPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { detail: c, members, audit } = await getCustomer(workspaceId);
  const effective = planById(c.effective_plan_id);

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-muted">
        <Link href="/admin/customers" className="hover:text-text">
          Customers
        </Link>
        <ChevronRight aria-hidden className="size-3" />
        <span className="truncate">{c.name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl text-2xl text-white shadow-sm"
          style={{ background: colorVar(c.color) }}
        >
          {c.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate font-display text-[38px] leading-tight tracking-tight text-text">{c.name}</h1>
            <PlanBadge planId={c.plan_id} />
            <StatusBadge status={c.status} trialEndsAt={c.trial_ends_at} trialExpired={c.trial_expired} />
          </div>
          <p className="mt-1 text-[13px] text-text-2">
            Owned by <span className="font-medium text-text">{c.owner_name || "Unnamed"}</span>{" "}
            <a href={`mailto:${c.owner_email}`} className="text-accent hover:underline">
              {c.owner_email}
            </a>{" "}
            · created {longDate(c.created_at)}
          </p>
          <p className="mt-1 font-mono text-[11.5px] text-muted">{c.workspace_id}</p>
          {c.description ? <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-2">{c.description}</p> : null}
        </div>
      </header>

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="usage" className="rounded-2xl border border-border bg-surface shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
              <h2 id="usage" className="text-[14px] font-semibold text-text">
                Usage
              </h2>
              <p className="text-[12px] text-muted">
                Limits of the {effective?.name ?? c.effective_plan_id} plan
                {c.effective_plan_id !== c.plan_id ? " (trial ended)" : ""}
              </p>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <UsageMeter label="People" icon={<Users />} used={c.member_count} limit={c.max_members} />
                <UsageMeter
                  label="File storage"
                  icon={<HardDrive />}
                  used={c.storage_bytes}
                  limit={c.storage_mb * MB}
                  format={(n) => (n === c.storage_mb * MB ? formatStorageMb(c.storage_mb) : formatBytes(n))}
                />
              </div>
              {c.pending_invitations > 0 ? (
                <p className="flex items-center gap-2 text-[12.5px] text-text-2">
                  <Mail aria-hidden className="size-3.5 text-muted" />
                  {c.pending_invitations} pending invitation{c.pending_invitations === 1 ? "" : "s"}
                </p>
              ) : null}
              <div className="grid gap-x-8 gap-y-3.5 border-t border-border pt-4 sm:grid-cols-2">
                {MODULE_TYPES.map((m) =>
                  c.modules.includes(m) ? (
                    <UsageMeter key={m} label={MODULES[m].label} icon={<ModuleIcon type={m} />} used={c.usage[m]} limit={c.max_items_per_module} />
                  ) : (
                    <div key={m} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="flex items-center gap-2 text-muted">
                        <ModuleIcon type={m} className="opacity-50" />
                        {MODULES[m].label}
                      </span>
                      <span className="text-[12px] text-muted">
                        {c.usage[m] > 0 ? `${c.usage[m]} kept, read-only · ` : ""}not on plan
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </section>

          <section aria-labelledby="members" className="rounded-2xl border border-border bg-surface shadow-sm">
            <h2 id="members" className="border-b border-border px-5 py-3.5 text-[14px] font-semibold text-text">
              Members · {members.length}
            </h2>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar name={m.display_name || m.email} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-text">{m.display_name || "Unnamed"}</p>
                    <p className="truncate text-[12px] text-muted">{m.email}</p>
                  </div>
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{isRole(m.role) ? ROLE_LABELS[m.role] : m.role}</Badge>
                  <span className="hidden w-24 text-right text-[12px] text-muted sm:block">joined {timeAgo(m.joined_at)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="history" className="rounded-2xl border border-border bg-surface shadow-sm">
            <h2 id="history" className="border-b border-border px-5 py-3.5 text-[14px] font-semibold text-text">
              Admin history
            </h2>
            <AuditList entries={audit} showWorkspace={false} empty="No admin changes to this workspace yet." />
          </section>
        </div>

        <aside aria-label="Manage subscription" className="lg:sticky lg:top-20">
          <CustomerControls customer={c} />
        </aside>
      </div>
    </>
  );
}
