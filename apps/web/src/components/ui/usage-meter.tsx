import type { ReactNode } from "react";
import { meterTone, usagePercent } from "@/lib/billing";
import { cn } from "@/lib/utils";

const BAR: Record<ReturnType<typeof meterTone>, string> = {
  accent: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
};

/**
 * "Used of limit" with a thin bar. An unlimited limit (null) shows the count
 * alone. `format` renders both numbers (e.g. bytes).
 */
export function UsageMeter({
  label,
  icon,
  used,
  limit,
  format = String,
  className,
}: {
  label: string;
  icon?: ReactNode;
  used: number;
  limit: number | null;
  format?: (n: number) => string;
  className?: string;
}) {
  const percent = usagePercent(used, limit);
  const tone = meterTone(percent);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-2 truncate text-text-2 [&>svg]:size-3.5 [&>svg]:shrink-0">
          {icon}
          {label}
        </span>
        <span className={cn("shrink-0 tabular-nums", tone === "danger" ? "font-medium text-danger" : "text-text")}>
          {format(used)}
          <span className="text-muted">{limit === null ? " · unlimited" : ` / ${format(limit)}`}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? used}
        aria-valuenow={used}
        aria-valuetext={limit === null ? `${format(used)}, unlimited` : `${format(used)} of ${format(limit)}`}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", BAR[tone], percent === null && "bg-border-strong")}
          style={{ width: percent === null ? "100%" : `${Math.max(percent, used > 0 ? 3 : 0)}%`, opacity: percent === null ? 0.35 : 1 }}
        />
      </div>
    </div>
  );
}
