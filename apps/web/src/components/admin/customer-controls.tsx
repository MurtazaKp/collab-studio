"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarPlus, Check, CreditCard, Pause, Play, Save } from "lucide-react";
import { adminExtendTrialAction, adminSetNotesAction, adminSetPlanAction, adminSetStatusAction } from "@/app/actions/admin";
import type { ActionResult } from "@/app/actions/workspace";
import { PLANS, type PlanId } from "@/components/marketing/plans";
import { STATUS_LABELS, formatStorageMb, type SubscriptionStatus } from "@/lib/billing";
import type { CustomerDetail } from "@/lib/admin-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "./badges";

const TRIAL_STEPS = [7, 14, 30] as const;
const NOTES_MAX = 2000;

type StatusChange = { status: Exclude<SubscriptionStatus, "trialing">; title: string; description: string; confirm: string; danger: boolean };

const STATUS_CHANGES: Record<"suspend" | "cancel" | "past_due" | "reactivate", StatusChange> = {
  suspend: {
    status: "suspended",
    title: "Suspend this workspace?",
    description: "Members keep read access, but nothing can be created, edited or deleted, and live editors switch to read-only.",
    confirm: "Suspend workspace",
    danger: true,
  },
  cancel: {
    status: "canceled",
    title: "Mark the subscription canceled?",
    description: "The workspace becomes read-only until it is reactivated or moved to a plan.",
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
    title: "Reactivate this workspace?",
    description: "Members can edit again straight away, within the limits of the current plan.",
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
          <p className="text-[12px] text-muted">{changed ? "Takes effect immediately." : "Current plan selected."}</p>
          <Button
            variant="primary"
            size="sm"
            disabled={!changed}
            loading={pending}
            onClick={() => run(() => adminSetPlanAction({ workspaceId: customer.workspace_id, planId: plan }), "Plan updated")}
          >
            <Save className="size-3.5" /> Save plan
          </Button>
        </div>
      }
    >
      <div role="radiogroup" aria-label="Plan" className="grid gap-2">
        {PLANS.map((p) => {
          const selected = plan === p.id;
          const over = customer.member_count > p.limits.maxMembers;
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
                  <span className="text-[13px] text-text tabular-nums">${p.monthly}/mo</span>
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  Up to {p.limits.maxMembers} people · {formatStorageMb(p.limits.storageMb)} ·{" "}
                  {p.limits.maxItemsPerModule === null ? "unlimited items" : `${p.limits.maxItemsPerModule} items per tool`} ·{" "}
                  {p.limits.modules.length} tools
                </span>
                {over ? (
                  <span className="mt-1 block text-[12px] text-warning">
                    Has {customer.member_count} people; nobody is removed, but no one new can join.
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
          {STATUS_LABELS[status]}: members can read but not change anything.
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
          {customer.plan_id === "free" ? "Moves the workspace to a Team trial. " : ""}
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
              run(() => adminExtendTrialAction({ workspaceId: customer.workspace_id, days }), trialing ? `Trial extended by ${days} days` : "Trial started")
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
                    () => adminSetStatusAction({ workspaceId: customer.workspace_id, status: change.status, reason }),
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
            onClick={() => run(() => adminSetNotesAction({ workspaceId: customer.workspace_id, notes }), "Notes saved")}
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
