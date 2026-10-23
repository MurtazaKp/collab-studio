import { STATUS_TONES, statusSummary, trialOver, type SubscriptionStatus } from "@/lib/billing";
import { planById } from "@/components/marketing/plans";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const PLAN_STYLE: Record<string, string> = {
  free: "border-border bg-surface text-text-2",
  team: "border-accent/30 bg-accent-soft text-accent",
  business: "border-transparent bg-text text-bg",
};

export function PlanBadge({ planId, className }: { planId: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md border px-1.5 text-[11.5px] font-medium",
        PLAN_STYLE[planId] ?? PLAN_STYLE.free,
        className,
      )}
    >
      {planById(planId)?.name ?? planId}
    </span>
  );
}

export function StatusBadge({
  status,
  trialEndsAt = null,
  trialExpired = false,
}: {
  status: SubscriptionStatus;
  trialEndsAt?: string | null;
  trialExpired?: boolean;
}) {
  const expired = trialExpired || (status === "trialing" && trialOver(trialEndsAt));
  return (
    <Badge tone={expired ? "warning" : STATUS_TONES[status]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {statusSummary({ status, trialEndsAt, trialExpired: expired })}
    </Badge>
  );
}
