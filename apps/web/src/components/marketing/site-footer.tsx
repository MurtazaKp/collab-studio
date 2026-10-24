import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
];
const SIGNED_OUT = [
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Start free trial" },
];
const SIGNED_IN = [{ href: "/w", label: "Dashboard" }];

export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-3 text-[13px] leading-relaxed text-text-2">
            One live workspace for small teams. Flat price per account, private by default.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-10 gap-y-2.5 text-[13.5px] sm:grid-cols-1">
            {[...LINKS, ...(signedIn ? SIGNED_IN : SIGNED_OUT)].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="rounded-sm text-text-2 underline-offset-4 hover:text-text hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 text-[12.5px] text-muted sm:px-6">
        © CollabVerse
      </div>
    </footer>
  );
}
