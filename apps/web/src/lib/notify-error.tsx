import Link from "next/link";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import { PLAN_ERROR_TITLES, planErrorKind, planErrorOffersUpgrade } from "@/lib/plan-errors";

export const UPGRADE_HREF = "/pricing";

/**
 * Whether the person looking at the app may see the workspace's plan (its
 * owner and admins). Members and viewers get a neutral message without the
 * plan's name or an Upgrade link. Set by the workspace provider; defaults to
 * true outside a workspace (onboarding, the workspaces page), where the plan
 * in question is the user's own.
 */
let planAudience = true;
export function setPlanAudience(canSeePlan: boolean): void {
  planAudience = canSeePlan;
}

const MEMBER_MESSAGES: Record<string, string> = {
  inactive: "This workspace is read-only right now. Ask the workspace owner for details.",
  module: "This tool isn't available in this workspace. Ask the workspace owner.",
};
const MEMBER_DEFAULT = "This workspace has reached a limit. Ask the workspace owner or an admin.";

/**
 * For dialogs that show their own inline error: toasts plan limits (with the
 * Upgrade action) and returns true so the caller can close the dialog instead.
 */
export function toastPlanError(err: unknown): boolean {
  return planErrorKind(err) ? toastError(err) : false;
}

/**
 * Shows an error toast. Plan limits get a friendly title, the database's
 * explanation and an "Upgrade" action pointing at the pricing page.
 * Returns true when the error was a plan limit.
 */
export function toastError(err: unknown, fallback?: string): boolean {
  const kind = planErrorKind(err);
  const message = errorMessage(err, fallback);
  if (!kind) {
    toast.error(message);
    return false;
  }
  if (!planAudience) {
    toast.error(PLAN_ERROR_TITLES[kind], { id: `plan-${kind}`, description: MEMBER_MESSAGES[kind] ?? MEMBER_DEFAULT, duration: 8_000 });
    return true;
  }
  toast.error(PLAN_ERROR_TITLES[kind], {
    id: `plan-${kind}`,
    description: message,
    duration: 10_000,
    action: planErrorOffersUpgrade(kind, message) ? (
      <Link
        href={UPGRADE_HREF}
        onClick={() => toast.dismiss(`plan-${kind}`)}
        className="ml-auto shrink-0 rounded-md bg-accent px-2.5 py-1 text-[12.5px] font-medium text-accent-text hover:bg-accent-hover"
      >
        Upgrade
      </Link>
    ) : undefined,
  });
  return true;
}
