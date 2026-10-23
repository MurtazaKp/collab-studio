"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeDollarSign, CalendarPlus, Check, CreditCard, Pause, Play, Save } from "lucide-react";
import {
  adminExtendTrialAction,
  adminSetCustomPriceAction,
  adminSetNotesAction,
  adminSetPlanAction,
  adminSetStatusAction,
} from "@/app/actions/admin";
import type { ActionResult } from "@/app/actions/workspace";
import { PLANS, workspacesLabel, type PlanId } from "@/components/marketing/plans";
import { STATUS_LABELS, formatPrice, formatStorageMb, type SubscriptionStatus } from "@/lib/billing";
import type { CustomerDetail } from "@/lib/admin-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "./badges";

const TRIAL_STEPS = [7, 14, 30] as const;
const NOTES_MAX = 2000;

type StatusChange = { status: Exclude<SubscriptionStatus, "trialing">; title: string; description: string; confirm: string; danger: boolean };

const STATUS_CHANGES: Record<"suspend" | "cancel" | "past_due" | "reactivate", StatusChange> = {
  suspend: {
    status: "suspended",
    title: "Suspend this customer?",
    description:
      "Every workspace they own becomes read-only: members keep read access, nothing can be created, edited or deleted, and live editors switch to read-only.",
    confirm: "Suspend customer",
    danger: true,
  },
  cancel: {
    status: "canceled",
    title: "Mark the subscription canceled?",
    description: "Their workspaces become read-only until the account is reactivated.",
    confirm: "Mark canceled",
    danger: true,
  },
  past_due: {
    status: "past_due",
    title: "Mark payment as past due?",
    description: "Nothing is blocked; this flags the account while payment is chased and keeps it out of collected MRR.",
    confirm: "Mark past due",
    danger: false,
  },
  reactivate: {
    status: "active",
    title: "Reactivate this customer?",
    description: "Their workspaces can be edited again straight away, within the limits of the current plan.",
    confirm: "Reactivate",
    danger: false,
  },
};

function Panel({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-sm">
      <h2 className="border-b border-border px-5 py-3.5 text-[14px] font-semibold text-text">{title}</h2>
      <div className="p-5">{children}</div>
      {footer ? <div className="border-t border-border bg-surface-2/40 px-5 py-3">{footer}</div> : null}
    </section>
  );
}

function useAdminAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ActionResult>, success: string, onDone?: () => void) =>
    start(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(success);
        onDone?.();
        router.refresh();
      } catch {
        toast.error("Your session may have expired. Refresh and sign in again.");
      }
    });
  return { pending, run };
}

export function CustomerControls({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <PlanPanel customer={customer} />
      {customer.plan_id === "custom" ? <PricePanel customer={customer} /> : null}
      <StatusPanel customer={customer} />
      <NotesPanel customer={customer} />
      <Panel title="Billing provider">
        <div className="flex items-start gap-3 text-[13px] text-text-2">
          <CreditCard aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          {customer.billing_customer_id ? (
            <dl className="grid gap-1 font-mono text-[12px]">
              <dt className="sr-only">Customer id</dt>
              <dd>{customer.billing_customer_id}</dd>
              <dt className="sr-only">Subscription id</dt>
              <dd>{customer.billing_subscription_id ?? "No subscription id"}</dd>
            </dl>
          ) : (
            <p>
              Not connected. Plans and statuses are set here by hand; a payment provider can later update them through the billing
              webhook seam.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function PlanPanel({ customer }: { customer: CustomerDetail }) {
  const { pending, run } = useAdminAction();
  const [plan, setPlan] = useState<PlanId>((PLANS.find((p) => p.id === customer.plan_id)?.id ?? "free") as PlanId);
  const changed = plan !== customer.plan_id;
  return (
    <Panel
      title="Plan"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted">{changed ? "Applies to all of their workspaces immediately." : "Current plan selected."}</p>
          <Button
            variant="primary"
            size="sm"
            disabled={!changed}
            loading={pending}
            onClick={() => run(() => adminSetPlanAction({ userId: customer.user_id, planId: plan }), "Plan updated")}
          >
            <Save className="size-3.5" /> Save plan
          </Button>
        </div>
      }
    >
      <div role="radiogroup" aria-label="Plan" className="grid gap-2">
        {PLANS.map((p) => {
          const selected = plan === p.id;
          const over = p.limits.maxWorkspaces !== null && customer.workspace_count > p.limits.maxWorkspaces;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPlan(p.id)}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-[border-color,background-color]",
                selected ? "border-accent bg-accent-soft/40" : "border-border hover:border-border-strong hover:bg-surface-2/60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-accent bg-accent text-accent-text" : "border-border-strong",
                )}
              >
                {selected ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-text">
                    {p.name}
                    {customer.plan_id === p.id ? <span className="ml-1.5 text-[12px] font-normal text-muted">current</span> : null}
                  </span>
                  <span className="text-[13px] text-text tabular-nums">{p.monthly === null ? "Custom price" : `$${p.monthly}/mo`}</span>
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {workspacesLabel(p.limits.maxWorkspaces)} · {p.limits.maxMembers === null ? "unlimited people" : `up to ${p.limits.maxMembers} people`} ·{" "}
                  {p.limits.storageMb === null ? "unlimited storage" : formatStorageMb(p.limits.storageMb)} ·{" "}
                  {p.limits.maxItemsPerModule === null ? "unlimited items" : `${p.limits.maxItemsPerModule} items per tool`} · {p.limits.modules.length} tools
                </span>
                {over ? (
                  <span className="mt-1 block text-[12px] text-warning">
                    Has {customer.workspace_count} workspaces; none are removed, but no new ones can be created.
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function StatusPanel({ customer }: { customer: CustomerDetail }) {
  const { pending, run } = useAdminAction();
  const [change, setChange] = useState<StatusChange | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState<number>(14);
  const status = customer.status;
  const blocked = status === "suspended" || status === "canceled";
  const trialing = status === "trialing" && !customer.trial_expired;

  const open = (c: StatusChange) => {
    setReason("");
    setChange(c);
  };

  return (
    <Panel title="Status and trial">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] text-text-2">
          <StatusBadge status={status} trialEndsAt={customer.trial_ends_at} trialExpired={customer.trial_expired} />
          {customer.trial_ends_at ? <span>ends {formatDate(customer.trial_ends_at)}</span> : null}
        </div>
      </div>

      {blocked ? (
        <Notice tone={status === "suspended" ? "danger" : "warning"} className="mt-3">
          {STATUS_LABELS[status]}: members of their workspaces can read but not change anything.
        </Notice>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {blocked ? (
          <Button variant="primary" size="sm" onClick={() => open(STATUS_CHANGES.reactivate)}>
            <Play className="size-3.5" /> Reactivate
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" className="text-danger" onClick={() => open(STATUS_CHANGES.suspend)}>
              <Pause className="size-3.5" /> Suspend
            </Button>
            {status === "past_due" || trialing ? (
              <Button variant="outline" size="sm" onClick={() => open(STATUS_CHANGES.reactivate)}>
                {trialing ? "End trial, mark active" : "Mark paid"}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => open(STATUS_CHANGES.past_due)}>
                Mark past due
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => open(STATUS_CHANGES.cancel)}>
              Mark canceled
            </Button>
          </>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-[13px] font-medium text-text">{trialing ? "Extend the trial" : "Start a trial"}</p>
        <p className="mt-0.5 text-[12px] text-muted">
          {customer.plan_id === "free" ? "Moves the customer to a Team trial. " : ""}
          {trialing ? "Days are added to the current end date." : "The trial starts today."}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Trial length" className="flex rounded-lg border border-border bg-surface-2 p-0.5">
            {TRIAL_STEPS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                onClick={() => setDays(d)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-[12.5px] font-medium tabular-nums transition-colors",
                  days === d ? "bg-surface text-text shadow-sm" : "text-text-2 hover:text-text",
                )}
              >
                {d} days
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={pending && change === null}
            onClick={() =>
              run(() => adminExtendTrialAction({ userId: customer.user_id, days }), trialing ? `Trial extended by ${days} days` : "Trial started")
            }
          >
            <CalendarPlus className="size-3.5" /> {trialing ? "Extend" : "Start trial"}
          </Button>
        </div>
      </div>

      <Dialog open={change !== null} onOpenChange={(o) => !o && setChange(null)}>
        {change ? (
          <DialogContent title={change.title} description={change.description}>
            <Field label="Reason (recorded in the audit log)" hint="Optional, up to 500 characters.">
              {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />}
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setChange(null)}>
                Cancel
              </Button>
              <Button
                variant={change.danger ? "danger" : "primary"}
                loading={pending}
                onClick={() =>
                  run(
                    () => adminSetStatusAction({ userId: customer.user_id, status: change.status, reason }),
                    `Status set to ${STATUS_LABELS[change.status].toLowerCase()}`,
                    () => setChange(null),
                  )
                }
              >
                {change.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Panel>
  );
}

function NotesPanel({ customer }: { customer: CustomerDetail }) {
  const { pending, run } = useAdminAction();
  const [notes, setNotes] = useState(customer.notes);
  const [saved, setSaved] = useState(customer.notes);
  // Pick up notes saved elsewhere (another admin) when the server data changes.
  if (customer.notes !== saved) {
    setSaved(customer.notes);
    setNotes(customer.notes);
  }
  const dirty = notes.trim() !== customer.notes;
  return (
    <Panel
      title="Internal notes"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted tabular-nums">
            {notes.length}/{NOTES_MAX} · visible to platform admins only
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty}
            loading={pending}
            onClick={() => run(() => adminSetNotesAction({ userId: customer.user_id, notes }), "Notes saved")}
          >
            <Save className="size-3.5" /> Save notes
          </Button>
        </div>
      }
    >
      <Textarea
        aria-label="Internal notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={NOTES_MAX}
        rows={5}
        placeholder="Contract terms, contacts, why the plan was changed…"
      />
    </Panel>
  );
}

function PricePanel({ customer }: { customer: CustomerDetail }) {
  const { pending, run } = useAdminAction();
  const current = customer.custom_price_cents === null ? "" : String(customer.custom_price_cents / 100);
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(current);
  // Pick up a price saved elsewhere when the server data changes.
  if (current !== saved) {
    setSaved(current);
    setValue(current);
  }
  const trimmed = value.trim();
  const dollars = trimmed === "" ? null : Number(trimmed);
  const valid = dollars === null || (Number.isFinite(dollars) && dollars >= 0 && dollars <= 1_000_000);
  const dirty = trimmed !== current;
  return (
    <Panel
      title="Custom price"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted">
            {customer.custom_price_cents === null ? "Counts as $0 in MRR until set." : `Now ${formatPrice(customer.custom_price_cents)} a month.`}
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || !valid}
            loading={pending}
            onClick={() => run(() => adminSetCustomPriceAction({ userId: customer.user_id, dollars }), dollars === null ? "Price cleared" : "Price saved")}
          >
            <Save className="size-3.5" /> Save price
          </Button>
        </div>
      }
    >
      <Field label="Monthly price (USD)" hint="The amount agreed with this customer. Leave empty to clear it." error={valid ? undefined : "Enter an amount from 0 to 1,000,000."}>
        {(p) => (
          <div className="relative">
            <BadgeDollarSign aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <Input {...p} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 499" className="pl-8 tabular-nums" />
          </div>
        )}
      </Field>
    </Panel>
  );
}
