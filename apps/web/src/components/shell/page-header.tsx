import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

/** Consistent page header: breadcrumbs, title, meta line and actions. */
export function PageHeader({
  crumbs,
  title,
  meta,
  actions,
  icon,
  className,
  compact = false,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", compact ? "px-5 pt-4 pb-3" : "px-6 pt-7 pb-5 lg:px-10", className)}>
      <div className="min-w-0">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1 text-[12.5px] text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                {c.href ? (
                  <Link href={c.href} className="hover:text-text">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="flex items-center gap-2.5">
          {icon}
          <h1 className={cn("truncate text-text", compact ? "text-[17px] font-semibold" : "font-display text-[30px] leading-tight tracking-tight")}>
            {title}
          </h1>
        </div>
        {meta ? <div className="mt-1 text-[13px] text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
