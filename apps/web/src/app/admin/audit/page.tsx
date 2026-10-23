import type { Metadata } from "next";
import { listAuditLog } from "@/lib/admin";
import { AuditList } from "@/components/admin/audit-list";

export const metadata: Metadata = { title: "Audit log" };

const LIMIT = 200;

export default async function AuditPage() {
  const entries = await listAuditLog(LIMIT);
  return (
    <>
      <p className="font-mono text-[11.5px] tracking-wider text-muted uppercase">Compliance</p>
      <h1 className="mt-1 font-display text-[40px] leading-tight tracking-tight text-text">Audit log</h1>
      <p className="mt-1 max-w-2xl text-[14px] text-text-2">
        Every plan, status, trial and notes change made by a platform admin, plus admin grants made in the database. Entries are
        append-only and can&apos;t be edited from the app.
      </p>
      <section aria-label="Audit entries" className="mt-6 rounded-2xl border border-border bg-surface shadow-sm">
        <AuditList entries={entries} />
        {entries.length === LIMIT ? (
          <p className="border-t border-border px-5 py-3 text-[12px] text-muted">Showing the latest {LIMIT} entries.</p>
        ) : null}
      </section>
    </>
  );
}
