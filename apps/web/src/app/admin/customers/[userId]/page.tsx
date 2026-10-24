import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight, HardDrive, Mail, Users } from "lucide-react";
import { MODULES, MODULE_TYPES } from "@collabverse/shared";
import { getCustomer } from "@/lib/admin";
import { formatBytes, formatPrice, formatStorageMb } from "@/lib/billing";
import { planById } from "@/components/marketing/plans";
import { AuditList } from "@/components/admin/audit-list";
import { PlanBadge, StatusBadge } from "@/components/admin/badges";
import { CustomerControls } from "@/components/admin/customer-controls";
import { TransferWorkspaceButton } from "@/components/admin/transfer-workspace";
import { Avatar } from "@/components/ui/misc";
import { ModuleIcon } from "@/components/ui/module-icon";
import { UsageMeter } from "@/components/ui/usage-meter";
import { colorVar, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Customer" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function limitText(n: number | null, unit: string): string {
  return n === null ? `Unlimited ${unit}` : `Up to ${n.toLocaleString()} ${unit}`;
}

export default async function CustomerPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const { detail: c, workspaces, audit } = await getCustomer(userId);
  const effective = planById(c.effective_plan_id);
  const name = c.display_name || c.email || "Unnamed";

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-muted">
        <Link href="/admin/customers" className="hover:text-text">
          Customers
        </Link>
        <ChevronRight aria-hidden className="size-3" />
        <span className="truncate">{name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start gap-4">
        <Avatar name={name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate font-display text-[38px] leading-tight tracking-tight text-text">{name}</h1>
            <PlanBadge planId={c.plan_id} />
            <StatusBadge status={c.status} trialEndsAt={c.trial_ends_at} trialExpired={c.trial_expired} />
          </div>
          <p className="mt-1 text-[13px] text-text-2">
            <a href={`mailto:${c.email}`} className="text-accent hover:underline">
              {c.email}
            </a>{" "}
            · joined {longDate(c.created_at)}
            {c.plan_id === "custom" ? (
              <>
                {" "}
                · <span className="font-medium text-text">{c.custom_price_cents === null ? "price not set" : `${formatPrice(c.custom_price_cents)}/mo`}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 font-mono text-[11.5px] text-muted">{c.user_id}</p>
        </div>
      </header>

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="allowance" className="rounded-2xl border border-border bg-surface shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
              <h2 id="allowance" className="text-[14px] font-semibold text-text">
                Plan allowance
              </h2>
              <p className="text-[12px] text-muted">
                {effective?.name ?? c.effective_plan_id} plan{c.effective_plan_id !== c.plan_id ? " (trial ended)" : ""}, shared by every
                workspace they own
              </p>
            </div>
            <div className="space-y-5 p-5">
              <UsageMeter label="Workspaces" icon={<Building2 />} used={c.workspace_count} limit={c.max_workspaces} />
              <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
                <div>
                  <dt className="text-[12px] text-muted">People per workspace</dt>
                  <dd className="text-text">{limitText(c.max_members, "people")}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Items per tool</dt>
                  <dd className="text-text">{limitText(c.max_items_per_module, "items")}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">File storage per workspace</dt>
                  <dd className="text-text">{c.storage_mb === null ? "Unlimited" : formatStorageMb(c.storage_mb)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-4">
                {MODULE_TYPES.map((m) => {
                  const on = c.modules.includes(m);
                  return (
                    <span
                      key={m}
                      className={
                        on
                          ? "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-text"
                          : "inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[12px] text-muted line-through"
                      }
                    >
                      <ModuleIcon type={m} className={on ? undefined : "opacity-50"} />
                      {MODULES[m].label}
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          <section aria-labelledby="workspaces" className="rounded-2xl border border-border bg-surface shadow-sm">
            <h2 id="workspaces" className="border-b border-border px-5 py-3.5 text-[14px] font-semibold text-text">
              Workspaces · {workspaces.length}
            </h2>
            {workspaces.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">No workspaces yet. They&apos;ll run on this plan as soon as they create one.</p>
            ) : (
              <ul className="divide-y divide-border">
                {workspaces.map((w) => {
                  const full = c.max_members !== null && w.member_count >= c.max_members;
                  return (
                    <li key={w.workspace_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[14px] text-white"
                        style={{ background: colorVar(w.color) }}
                      >
                        {w.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-text">{w.name}</p>
                        <p className="truncate text-[12px] text-muted">
                          created {timeAgo(w.created_at)} · <span className="font-mono">{w.workspace_id.slice(0, 8)}</span>
                        </p>
                      </div>
                      <dl className="flex shrink-0 items-center gap-4 text-[12.5px] text-text-2 tabular-nums">
                        <div className="flex items-center gap-1.5" title="People">
                          <dt>
                            <Users aria-hidden className="size-3.5 text-muted" />
                            <span className="sr-only">People</span>
                          </dt>
                          <dd className={full ? "font-medium text-warning" : undefined}>
                            {w.member_count}
                            {c.max_members !== null ? <span className="text-muted"> / {c.max_members}</span> : null}
                          </dd>
                        </div>
                        <div title="Items">
                          <dt className="sr-only">Items</dt>
                          <dd>{w.item_count} items</dd>
                        </div>
                        <div className="flex items-center gap-1.5" title="File storage">
                          <dt>
                            <HardDrive aria-hidden className="size-3.5 text-muted" />
                            <span className="sr-only">File storage</span>
                          </dt>
                          <dd>{formatBytes(w.storage_bytes)}</dd>
                        </div>
                        {w.pending_invitations > 0 ? (
                          <div className="flex items-center gap-1.5" title="Pending invitations">
                            <dt>
                              <Mail aria-hidden className="size-3.5 text-muted" />
                              <span className="sr-only">Pending invitations</span>
                            </dt>
                            <dd>{w.pending_invitations}</dd>
                          </div>
                        ) : null}
                      </dl>
                      <TransferWorkspaceButton workspaceId={w.workspace_id} workspaceName={w.name} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="history" className="rounded-2xl border border-border bg-surface shadow-sm">
            <h2 id="history" className="border-b border-border px-5 py-3.5 text-[14px] font-semibold text-text">
              Admin history
            </h2>
            <AuditList entries={audit} showCustomer={false} empty="No admin changes to this customer yet." />
          </section>
        </div>

        <aside aria-label="Manage subscription" className="lg:sticky lg:top-20">
          <CustomerControls customer={c} />
        </aside>
      </div>
    </>
  );
}
