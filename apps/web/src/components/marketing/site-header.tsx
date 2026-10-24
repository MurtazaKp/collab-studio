import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";
import { ctaClass } from "./cta";

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
];

/** Where "Dashboard" takes a signed-in visitor: their workspaces. */
export const DASHBOARD_HREF = "/w";

export function SiteHeader({ current, signedIn = false }: { current?: "pricing"; signedIn?: boolean }) {
  const nav = signedIn ? NAV : [...NAV, { href: "/login", label: "Sign in" }];
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
          <ul className="-mx-2.5 flex items-center gap-1">
            {nav.map((item) => {
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
        {signedIn ? (
          <Link href={DASHBOARD_HREF} className={ctaClass("primary", "md", "ml-auto sm:ml-0")}>
            Dashboard
          </Link>
        ) : (
          <Link href="/signup" className={ctaClass("primary", "md", "ml-auto sm:ml-0")}>
            Start free trial
          </Link>
        )}
      </div>
    </header>
  );
}
