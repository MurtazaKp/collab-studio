"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Gauge, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview", icon: Gauge, exact: true },
  { href: "/admin/customers", label: "Customers", icon: Building2, exact: false },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, exact: false },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="-mb-px flex gap-1 overflow-x-auto">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[13.5px] font-medium transition-colors",
              active ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
