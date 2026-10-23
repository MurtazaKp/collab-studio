"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { PLANS } from "@/components/marketing/plans";
import { SUBSCRIPTION_STATUSES, STATUS_LABELS } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

/**
 * A plain GET form, so filters live in the URL (shareable, back-button
 * friendly) and work without JavaScript; the selects submit on change.
 */
export function CustomerFilters({ q, plan, status }: { q: string; plan: string; status: string }) {
  const submit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const filtered = Boolean(q || plan || status);
  return (
    <form method="get" action="/admin/customers" role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-60 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by workspace, owner email or id"
          aria-label="Search customers"
          maxLength={100}
          className="pl-8"
        />
      </div>
      <Select name="plan" defaultValue={plan} onChange={submit} aria-label="Plan" className="w-36">
        <option value="">All plans</option>
        {PLANS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select name="status" defaultValue={status} onChange={submit} aria-label="Status" className="w-36">
        <option value="">All statuses</option>
        {SUBSCRIPTION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline">
        Search
      </Button>
      {filtered ? (
        <Link href="/admin/customers" className="inline-flex h-8.5 items-center gap-1 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-text">
          <X aria-hidden className="size-3.5" /> Clear
        </Link>
      ) : null}
    </form>
  );
}
