import Link from "next/link";
import { ArrowRightLeft, CalendarClock, CreditCard, NotebookPen, Power, ShieldCheck, ShieldOff, type LucideIcon } from "lucide-react";
import { describeAuditEntry, type AuditAction, type AuditEntry } from "@/lib/admin-format";
import { cn, timeAgo } from "@/lib/utils";

const ICONS: Record<AuditAction, LucideIcon> = {
  plan_changed: ArrowRightLeft,
  status_changed: Power,
  trial_extended: CalendarClock,
  notes_updated: NotebookPen,
  admin_granted: ShieldCheck,
  admin_revoked: ShieldOff,
  billing_synced: CreditCard,
};

/** Admin audit entries, newest first. `showWorkspace` adds a link to each customer. */
export function AuditList({ entries, showWorkspace = true, empty = "No admin actions yet." }: { entries: AuditEntry[]; showWorkspace?: boolean; empty?: string }) {
  if (entries.length === 0) return <p className="px-5 py-8 text-center text-[13px] text-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-border">
      {entries.map((e) => {
        const Icon = ICONS[e.action];
        const { title, detail } = describeAuditEntry(e);
        const stamp = new Date(e.created_at);
        return (
          <li key={e.id} className="flex items-start gap-3 px-5 py-3.5">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-2",
                e.action === "status_changed" && e.details.to === "suspended" && "bg-danger-soft text-danger",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] text-text">
                <span className="font-medium">{title}</span>
                {showWorkspace && e.workspace_id ? (
                  <>
                    {" "}
                    <span className="text-muted">for</span>{" "}
                    <Link href={`/admin/customers/${e.workspace_id}`} className="font-medium text-accent hover:underline">
                      {e.workspace_name || "a workspace"}
                    </Link>
                  </>
                ) : showWorkspace && e.workspace_name ? (
                  <span className="text-muted"> for {e.workspace_name} (deleted)</span>
                ) : null}
              </p>
              {detail ? <p className="mt-0.5 truncate text-[12.5px] text-text-2">{detail}</p> : null}
              <p className="mt-0.5 text-[12px] text-muted">{e.actor_email || "Database (SQL editor or billing)"}</p>
            </div>
            <time dateTime={e.created_at} title={stamp.toLocaleString()} className="shrink-0 text-[12px] text-muted tabular-nums">
              {timeAgo(e.created_at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
