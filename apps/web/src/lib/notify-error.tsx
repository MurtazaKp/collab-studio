import Link from "next/link";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import { PLAN_ERROR_TITLES, planErrorKind, planErrorOffersUpgrade } from "@/lib/plan-errors";

export const UPGRADE_HREF = "/pricing";

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
