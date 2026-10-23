import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-6", className)}>
      <rect x="2" y="2" width="12.5" height="12.5" rx="3.5" fill="var(--accent)" />
      <rect x="17.5" y="2" width="12.5" height="12.5" rx="6.25" fill="var(--mod-chat)" />
      <rect x="2" y="17.5" width="12.5" height="12.5" rx="6.25" fill="var(--mod-whiteboard)" />
      <rect x="17.5" y="17.5" width="12.5" height="12.5" rx="3.5" fill="var(--mod-mindmap)" />
    </svg>
  );
}

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 text-text", className)}>
      <Logo />
      <span className="font-display text-[22px] leading-none tracking-tight">CollabVerse</span>
    </Link>
  );
}
