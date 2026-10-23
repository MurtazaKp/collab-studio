import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";
import { ctaClass } from "./cta";

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/login", label: "Sign in" },
];

export function SiteHeader({ current }: { current?: "pricing" }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
          <ul className="-mx-2.5 flex items-center gap-1">
            {NAV.map((item) => {
              const active = current === "pricing" && item.href === "/pricing";
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={ctaClass("ghost", "md", active ? "text-text" : undefined)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Link href="/signup" className={ctaClass("primary", "md", "ml-auto sm:ml-0")}>
          Start free trial
        </Link>
      </div>
    </header>
  );
}
