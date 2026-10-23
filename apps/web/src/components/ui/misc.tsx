import type { ReactNode } from "react";
import { cn, colorVar, initials } from "@/lib/utils";

export function Avatar({
  name,
  color,
  size = 28,
  online,
  className,
  ring = false,
}: {
  name: string;
  color?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span
        aria-hidden
        className={cn(
          "inline-flex size-full items-center justify-center rounded-full font-semibold text-white select-none",
          ring && "ring-2 ring-surface",
        )}
        style={{ background: color?.startsWith("#") ? color : colorVar(color), fontSize: Math.max(9, size * 0.38) }}
      >
        {initials(name)}
      </span>
      <span className="sr-only">{name}</span>
      {online !== undefined ? (
        <span
          aria-label={online ? "online" : "offline"}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-surface",
            online ? "bg-success" : "bg-border-strong",
          )}
          style={{ width: Math.max(8, size * 0.32), height: Math.max(8, size * 0.32) }}
        />
      ) : null}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = 24,
}: {
  people: { id: string; name: string; color?: string | null }[];
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5" aria-label={`${people.length} people`}>
      {shown.map((p) => (
        <span key={p.id} title={p.name}>
          <Avatar name={p.name} color={p.color} size={size} ring />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="inline-flex items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-text-2 ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-2",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-md bg-surface-3 motion-reduce:animate-none", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon ? (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-muted shadow-sm [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-xl text-text">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function Notice({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg px-3 py-2.5 text-[13px] leading-relaxed", TONES[tone], className)}>
      {children}
    </div>
  );
}
