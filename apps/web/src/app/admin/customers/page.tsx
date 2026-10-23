import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listCustomers } from "@/lib/admin";
import { SUBSCRIPTION_STATUSES } from "@/lib/billing";
import { PLANS, planById } from "@/components/marketing/plans";
import { CustomerFilters } from "@/components/admin/customer-filters";
import { PlanBadge, StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/misc";
import { cn, colorVar } from "@/lib/utils";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 25;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  // Unknown filter values are ignored rather than passed to the database.
  const plan = PLANS.some((p) => p.id === one(sp.plan)) ? one(sp.plan) : "";
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(sp.page), 10) || 1));

  const { rows, total } = await listCustomers({
    search: q,
    planId: plan || null,
    status: status || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (plan) params.set("plan", plan);
    if (status) params.set("status", status);
    if (n > 1) params.set("page", String(n));
    const s = params.toString();
    return `/admin/customers${s ? `?${s}` : ""}`;
  };
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11.5px] tracking-wider text-muted uppercase">Customers</p>
          <h1 className="mt-1 font-display text-[40px] leading-tight tracking-tight text-text">Workspaces</h1>
          <p className="mt-1 text-[14px] text-text-2">
            {total.toLocaleString()} {q || plan || status ? "matching" : "in total"}
            {plan ? ` on ${planById(plan)?.name}` : ""}
            {q ? ` for “${q}”` : ""}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <CustomerFilters q={q} plan={plan} status={status} />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            title="No customers match"
            description={q || plan || status ? "Try a different search or clear the filters." : "Workspaces appear here as soon as someone creates one."}
          />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Customers" tabIndex={0}>
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <caption className="sr-only">Customer workspaces with owner, plan, status, usage and creation date</caption>
              <thead className="border-b border-border bg-surface-2/50 text-[12px] text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Workspace</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Owner</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Plan</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">People</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Items</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((w) => {
                  const limit = planById(w.plan_id)?.limits.maxMembers ?? null;
                  const full = limit !== null && w.member_count >= limit;
                  return (
                    <tr key={w.workspace_id} className="group relative transition-colors hover:bg-surface-2/50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[14px] text-white"
                            style={{ background: colorVar(w.color) }}
                          >
                            {w.icon}
                          </span>
                          <div className="min-w-0">
                            {/* The stretched link makes the whole row clickable. */}
                            <Link
                              href={`/admin/customers/${w.workspace_id}`}
                              className="block max-w-[240px] truncate font-medium text-text after:absolute after:inset-0 group-hover:text-accent"
                            >
                              {w.name}
                            </Link>
                            <span className="block font-mono text-[11px] text-muted">{w.workspace_id.slice(0, 8)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="block max-w-[220px] truncate text-text">{w.owner_name || "Unnamed"}</span>
                        <span className="block max-w-[220px] truncate text-[12px] text-muted">{w.owner_email}</span>
                      </td>
                      <td className="px-3 py-3">
                        <PlanBadge planId={w.plan_id} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={w.status} trialEndsAt={w.trial_ends_at} />
                      </td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", full ? "font-medium text-warning" : "text-text")}>
                        {w.member_count}
                        <span className="text-muted">{limit !== null ? ` / ${limit}` : ""}</span>
                      </td>
                      <td className="px-3 py-3 text-right text-text tabular-nums">{w.item_count}</td>
                      <td className="px-5 py-3 text-right text-text-2 tabular-nums">{shortDate(w.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12.5px] text-muted">
            <span className="tabular-nums">
              {from}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <span className="flex items-center gap-1">
              <PageLink href={pageHref(page - 1)} disabled={page <= 1} label="Previous page">
                <ChevronLeft className="size-4" />
              </PageLink>
              <span className="px-2 tabular-nums">
                Page {Math.min(page, pages)} of {pages}
              </span>
              <PageLink href={pageHref(page + 1)} disabled={page >= pages} label="Next page">
                <ChevronRight className="size-4" />
              </PageLink>
            </span>
          </nav>
        ) : null}
      </div>
    </>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "inline-flex size-7 items-center justify-center rounded-md border border-border bg-surface";
  if (disabled) {
    return (
      <span aria-disabled className={cn(cls, "opacity-40")} aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(cls, "text-text hover:border-border-strong hover:bg-surface-2")}>
      {children}
    </Link>
  );
}
