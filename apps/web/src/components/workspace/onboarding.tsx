"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, Lock } from "lucide-react";
import { MODULES, MODULE_TYPES, ROLE_LABELS, WORKSPACE_COLORS, isModuleType, isRole, type ModuleType } from "@collabverse/shared";
import { acceptInvitationByIdAction, completeOnboardingAction, createWorkspaceAction } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Badge, Notice } from "@/components/ui/misc";
import { FREE_MODULES, workspacesLabel } from "@/components/marketing/plans";
import { UPGRADE_HREF, toastError } from "@/lib/notify-error";
import { planErrorKind } from "@/lib/plan-errors";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn, colorVar } from "@/lib/utils";

const ICONS = ["✦", "◆", "●", "▲", "✿", "☀", "⚑", "♫", "☕", "⚡", "✎", "⌘"];

interface PendingInvite {
  id: string;
  workspace_name: string;
  workspace_icon: string;
  workspace_color: string;
  role: string;
  inviter_name: string;
}

interface AccountPlan {
  planName: string;
  writable: boolean;
  modules: ModuleType[];
  maxWorkspaces: number | null;
  workspaceCount: number;
}

/** The signed-in user's own plan: a new workspace runs on it. Null until loaded (or if it can't be). */
function useAccountPlan(): AccountPlan | null {
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  useEffect(() => {
    let live = true;
    void getBrowserSupabase()
      .rpc("my_account_plan")
      .then(({ data, error }) => {
        const row = data?.[0];
        if (!live || error || !row) return;
        setPlan({
          planName: row.plan_name,
          writable: row.writable,
          modules: row.modules.filter(isModuleType),
          maxWorkspaces: row.max_workspaces,
          workspaceCount: row.workspace_count,
        });
      });
    return () => {
      live = false;
    };
  }, []);
  return plan;
}

export function WorkspaceForm({ onCreated, submitLabel = "Create workspace" }: { onCreated: (id: string) => void; submitLabel?: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("✦");
  const [color, setColor] = useState<string>("iris");
  const plan = useAccountPlan();
  // Until the plan loads, assume Free; the database decides either way.
  const allowed: readonly ModuleType[] = plan?.modules ?? FREE_MODULES;
  const [modules, setModules] = useState<ModuleType[]>([...FREE_MODULES]);
  const touched = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const atLimit = plan !== null && plan.maxWorkspaces !== null && plan.workspaceCount >= plan.maxWorkspaces;
  const blocked = plan !== null && (!plan.writable || atLimit);

  // Once the plan is known, switch on every tool it includes (unless the user already chose).
  const [seeded, setSeeded] = useState<AccountPlan | null>(null);
  if (plan && plan !== seeded) {
    setSeeded(plan);
    if (!touched.current) setModules([...plan.modules]);
  }

  const toggle = (m: ModuleType) => {
    if (!allowed.includes(m)) return;
    touched.current = true;
    setModules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createWorkspaceAction({ name, description, icon, color, modules });
          if (!res.ok) setError(res.error);
          else onCreated(res.data.id);
        });
      }}
    >
      {blocked ? (
        <Notice tone="warning">
          {!plan.writable
            ? "Your account is read-only, so you can't create workspaces. Contact support to reactivate it."
            : `Your ${plan.planName} plan includes ${workspacesLabel(plan.maxWorkspaces).toLowerCase()}, and you're using ${plan.workspaceCount}.`}{" "}
          {plan.writable ? (
            <Link href={UPGRADE_HREF} className="font-medium underline">
              See plans
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger">
          {error}{" "}
          {planErrorKind(error) && planErrorKind(error) !== "inactive" ? (
            <Link href={UPGRADE_HREF} className="font-medium underline">
              See plans
            </Link>
          ) : null}
        </Notice>
      ) : null}
      <div className="flex items-end gap-3">
        <div
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-xl text-xl text-white shadow-sm"
          style={{ background: colorVar(color) }}
        >
          {icon}
        </div>
        <Field label="Workspace name" className="flex-1">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. Northwind Design" autoFocus />}
        </Field>
      </div>
      <Field label="Description" hint="Optional — what is this workspace for?">
        {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} rows={2} />}
      </Field>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-text-2">Icon and colour</legend>
        <div className="flex flex-wrap gap-1.5">
          {ICONS.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={icon === i}
              aria-label={`Icon ${i}`}
              onClick={() => setIcon(i)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border text-[15px] transition-colors",
                icon === i ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex gap-2">
          {WORKSPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={color === c}
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface transition-shadow", color === c && "ring-2 ring-text")}
              style={{ background: colorVar(c) }}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-text-2">Modules</legend>
        <p className="-mt-1 mb-2.5 text-[12.5px] text-muted">
          You can change these any time in settings.{" "}
          {plan === null || allowed.length < MODULE_TYPES.length
            ? `New workspaces use your ${plan?.planName ?? "account's"} plan; the tools marked Team come with paid plans.`
            : `Your ${plan.planName} plan includes every tool.`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MODULE_TYPES.map((m) => {
            const on = modules.includes(m);
            const locked = !allowed.includes(m);
            return (
              <button
                key={m}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-disabled={locked || undefined}
                aria-label={locked ? `${MODULES[m].label} (included with Team and Business)` : undefined}
                onClick={() => toggle(m)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  locked
                    ? "cursor-not-allowed border-dashed border-border bg-surface-2/40"
                    : on
                      ? "border-accent/50 bg-accent-soft/50"
                      : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                <ModuleIcon type={m} tile className={locked ? "opacity-60" : undefined} />
                <span className={cn("flex-1 text-[13.5px] font-medium", locked ? "text-text-2" : "text-text")}>{MODULES[m].label}</span>
                {locked ? (
                  <Badge tone="accent">
                    <Lock aria-hidden className="size-3" /> Team
                  </Badge>
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 items-center justify-center rounded border",
                    on ? "border-accent bg-accent text-accent-text" : "border-border-strong",
                  )}
                >
                  {on ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={!name.trim() || modules.length === 0 || blocked}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function Onboarding({
  initialName,
  hasWorkspaces,
  invitations,
}: {
  initialName: string;
  hasWorkspaces: boolean;
  invitations: PendingInvite[];
}) {
  const router = useRouter();
  // Invited people who already gave their name at sign-up go straight to the invitation.
  const invited = invitations.length > 0;
  const [step, setStep] = useState<"name" | "workspace">(hasWorkspaces || (invited && initialName.trim()) ? "workspace" : "name");
  const [name, setName] = useState(initialName);
  const [pending, start] = useTransition();
  const [joining, setJoining] = useState<string | null>(null);
  // With an invitation waiting, creating a workspace is the secondary path.
  const [creating, setCreating] = useState(!invited);

  if (step === "name") {
    return (
      <div className="animate-pop-in">
        <p className="text-[13px] font-medium text-muted">Step 1 of 2</p>
        <h1 className="mt-2 font-display text-[40px] leading-tight text-text">What should we call you?</h1>
        <p className="mt-2 text-[14.5px] text-text-2">This is how teammates see you next to cursors, messages and tasks.</p>
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await completeOnboardingAction(name);
              if (!res.ok) toastError(res.error);
              else setStep("workspace");
            });
          }}
        >
          <Field label="Display name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={pending} disabled={!name.trim()}>
            Continue <ArrowRight className="size-4" />
          </Button>
        </form>
      </div>
    );
  }

  const accept = async (id: string) => {
    setJoining(id);
    const res = await acceptInvitationByIdAction(id);
    if (!res.ok) {
      setJoining(null);
      toastError(res.error);
      return;
    }
    router.push(`/w/${res.data.workspaceId}`);
  };

  if (invited && !creating) {
    const only = invitations.length === 1 ? invitations[0]! : null;
    return (
      <div className="animate-pop-in">
        <p className="text-[13px] font-medium text-accent">You&apos;ve been invited</p>
        <h1 className="mt-2 font-display text-[40px] leading-tight text-text">{only ? `Join ${only.workspace_name}` : "Join your team"}</h1>
        <p className="mt-2 text-[14.5px] text-text-2">
          {only
            ? `${only.inviter_name} invited you as ${isRole(only.role) ? ROLE_LABELS[only.role] : only.role}. Accept to start working together.`
            : "These workspaces are waiting for you. Accept the ones you want to join."}
        </p>

        <ul className="mt-8 flex flex-col gap-3">
          {invitations.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg text-white"
                style={{ background: colorVar(inv.workspace_color) }}
              >
                {inv.workspace_icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-text">{inv.workspace_name}</p>
                <p className="text-[12.5px] text-muted">
                  {inv.inviter_name} invited you as {isRole(inv.role) ? ROLE_LABELS[inv.role] : inv.role}
                </p>
              </div>
              <Button variant="primary" size={only ? "lg" : "md"} loading={joining === inv.id} disabled={joining !== null && joining !== inv.id} onClick={() => void accept(inv.id)}>
                Accept invitation <ArrowRight className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        <button type="button" onClick={() => setCreating(true)} className="mt-8 text-[13px] text-text-2 underline-offset-4 hover:text-text hover:underline">
          Create my own workspace instead
        </button>
      </div>
    );
  }

  return (
    <div className="animate-pop-in">
      {!hasWorkspaces && !invited ? <p className="text-[13px] font-medium text-muted">Step 2 of 2</p> : null}
      {invited ? (
        <button type="button" onClick={() => setCreating(false)} className="mb-2 text-[13px] text-accent underline-offset-4 hover:underline">
          ← Back to your invitation{invitations.length === 1 ? "" : "s"}
        </button>
      ) : null}
      <h1 className="mt-2 font-display text-[40px] leading-tight text-text">Create a workspace</h1>
      <p className="mt-2 text-[14.5px] text-text-2">A workspace holds your modules and the people you collaborate with.</p>
      <div className="mt-8" />
      <WorkspaceForm onCreated={(id) => router.push(`/w/${id}`)} />
    </div>
  );
}
