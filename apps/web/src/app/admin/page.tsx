import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, FlaskConical, TrendingUp, UsersRound } from "lucide-react";
import { getOverview, listAuditLog, listCustomers } from "@/lib/admin";
import { SUBSCRIPTION_STATUSES, STATUS_LABELS, STATUS_TONES, formatPrice } from "@/lib/billing";
import { AuditList } from "@/components/admin/audit-list";
import { PlanBadge } from "@/components/admin/badges";
import { Avatar } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const PLAN_FILL: Record<string, string> = { free: "var(--border-strong)", team: "var(--accent)", business: "var(--text)", custom: "var(--success)" };
const DOT: Record<(typeof STATUS_TONES)[keyof typeof STATUS_TONES], string> = {
  neutral: "bg-border-strong",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

function Tile({
  label,
  value,
  note,
  icon,
  href,
  className,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  icon: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between text-[12.5px] text-muted">
        {label}
        <span aria-hidden className="text-muted [&>svg]:size-4">
          {icon}
        </span>
      </div>
      <p className="mt-3 font-display text-[40px] leading-none tracking-tight text-text tabular-nums">{value}</p>
      {note ? <p className="mt-2 text-[12.5px] text-text-2">{note}</p> : null}
    </>
  );
  const cls = cn("rounded-2xl border border-border bg-surface p-5 shadow-sm", className);
  return href ? (
    <Link href={href} className={cn(cls, "transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function AdminOverviewPage() {
  const [overview, newest, audit] = await Promise.all([getOverview(), listCustomers({ limit: 6 }), listAuditLog(8)]);
  const paying = overview.by_plan.reduce((n, p) => n + p.paying, 0);
  const total = Math.max(overview.total_customers, 1);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11.5px] tracking-wider text-muted uppercase">Platform</p>
          <h1 className="mt-1 font-display text-[40px] leading-tight tracking-tight text-text">Overview</h1>
          <p className="mt-1 text-[14px] text-text-2">Every customer on CollabVerse, by plan and status. A plan covers all of a customer&apos;s workspaces.</p>
        </div>
        <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
          All customers <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-sm sm:col-span-2 lg:row-span-2">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full opacity-[0.08]"
            style={{ background: "var(--accent)" }}
          />
          <div className="flex items-center justify-between text-[12.5px] text-muted">
            Estimated MRR
            <TrendingUp aria-hidden className="size-4" />
          </div>
          <p className="mt-4 font-display text-[72px] leading-none tracking-tight text-text tabular-nums">{formatPrice(overview.mrr_cents)}</p>
          <p className="mt-3 text-[14px] text-text-2">
            <span className="font-medium text-text tabular-nums">{formatPrice(overview.mrr_cents * 12)}</span> annual run-rate from{" "}
            <span className="font-medium text-text tabular-nums">{paying}</span> paying customer{paying === 1 ? "" : "s"}
          </p>
          <div className="mt-8 space-y-2.5">
            {overview.by_plan
              .filter((p) => p.plan_id !== "free")
              .map((p) => (
                <div key={p.plan_id} className="flex items-center gap-3 text-[13px]">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: PLAN_FILL[p.plan_id] ?? "var(--muted)" }} />
                  <span className="w-20 text-text-2">{p.name}</span>
                  <span className="flex-1 text-muted tabular-nums">
                    {p.plan_id === "custom" ? `${p.paying} at agreed prices` : `${p.paying} × ${formatPrice(p.monthly_price_cents)}`}
                  </span>
                  <span className="font-medium text-text tabular-nums">{formatPrice(p.mrr_cents)}</span>
                </div>
              ))}
          </div>
          <p className="mt-6 text-[12px] text-muted">
            List price of active and past-due customers (Custom at the price set on the customer). Trials, canceled and suspended
            customers count as $0. No payment provider is connected, so this is an estimate, not collected revenue.
          </p>
        </div>
        <Tile
          label="Customers"
          value={overview.total_customers.toLocaleString()}
          note={`+${overview.new_customers_30d} in the last 30 days`}
          icon={<UsersRound />}
          href="/admin/customers"
        />
        <Tile
          label="Workspaces"
          value={overview.total_workspaces.toLocaleString()}
          note={`${overview.total_users.toLocaleString()} signed-up accounts`}
          icon={<Building2 />}
        />
        <Tile
          label="Active trials"
          value={overview.active_trials.toLocaleString()}
          note="Trials that haven't ended yet"
          icon={<FlaskConical />}
          href="/admin/customers?status=trialing"
        />
        <Tile
          label="Needs attention"
          value={(overview.by_status.past_due + overview.by_status.suspended).toLocaleString()}
          note={`${overview.by_status.past_due} past due · ${overview.by_status.suspended} suspended`}
          icon={<span className="block size-2 rounded-full bg-warning" />}
          href="/admin/customers?status=past_due"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="by-plan" className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 id="by-plan" className="text-[14px] font-semibold text-text">
            Customers by plan
          </h2>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Share of customers per plan">
            {overview.by_plan.map((p) =>
              p.customers > 0 ? (
                <span key={p.plan_id} style={{ width: `${(p.customers / total) * 100}%`, background: PLAN_FILL[p.plan_id] ?? "var(--muted)" }} />
              ) : null,
            )}
          </div>
          <table className="mt-4 w-full text-[13px]">
            <caption className="sr-only">Customers, their workspaces, paying customers and estimated MRR per plan</caption>
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th scope="col" className="pb-2 font-normal">Plan</th>
                <th scope="col" className="pb-2 text-right font-normal">Customers</th>
                <th scope="col" className="pb-2 text-right font-normal">Workspaces</th>
                <th scope="col" className="pb-2 text-right font-normal">Paying</th>
                <th scope="col" className="pb-2 text-right font-normal">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {overview.by_plan.map((p) => (
                <tr key={p.plan_id}>
                  <th scope="row" className="py-2.5 text-left font-normal">
                    <Link href={`/admin/customers?plan=${p.plan_id}`} className="inline-flex items-center gap-2 hover:underline">
                      <PlanBadge planId={p.plan_id} />
                    </Link>
                  </th>
                  <td className="py-2.5 text-right text-text tabular-nums">
                    {p.customers}
                    <span className="ml-1.5 text-muted">{Math.round((p.customers / total) * 100)}%</span>
                  </td>
                  <td className="py-2.5 text-right text-text-2 tabular-nums">{p.workspaces}</td>
                  <td className="py-2.5 text-right text-text tabular-nums">{p.plan_id !== "free" ? p.paying : "—"}</td>
                  <td className="py-2.5 text-right font-medium text-text tabular-nums">{formatPrice(p.mrr_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="by-status" className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 id="by-status" className="text-[14px] font-semibold text-text">
            By status
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {SUBSCRIPTION_STATUSES.map((s) => (
              <li key={s}>
                <Link href={`/admin/customers?status=${s}`} className="group flex items-center gap-3 py-2.5 text-[13.5px]">
                  <span aria-hidden className={cn("size-2 rounded-full", DOT[STATUS_TONES[s]])} />
                  <span className="flex-1 text-text-2 group-hover:text-text">{STATUS_LABELS[s]}</span>
                  <span className="font-medium text-text tabular-nums">{overview.by_status[s]}</span>
                  <ArrowRight aria-hidden className="size-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section aria-labelledby="newest" className="rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 id="newest" className="text-[14px] font-semibold text-text">
              Newest customers
            </h2>
            <Link href="/admin/customers" className="text-[12.5px] text-accent hover:underline">
              View all
            </Link>
          </div>
          {newest.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted">No customers yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {newest.rows.map((c) => (
                <li key={c.user_id}>
                  <Link href={`/admin/customers/${c.user_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/50">
                    <Avatar name={c.display_name || c.email} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-text">{c.display_name || c.email}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {c.email} · {c.workspace_count === 1 ? "1 workspace" : `${c.workspace_count} workspaces`}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <PlanBadge planId={c.plan_id} />
                      <span className="text-[11.5px] text-muted">{timeAgo(c.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent" className="rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 id="recent" className="text-[14px] font-semibold text-text">
              Recent admin activity
            </h2>
            <Link href="/admin/audit" className="text-[12.5px] text-accent hover:underline">
              Audit log
            </Link>
          </div>
          <AuditList entries={audit} />
        </section>
      </div>
    </>
  );
}
