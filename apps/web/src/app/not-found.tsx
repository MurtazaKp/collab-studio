import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark href="/w" />
      <div>
        <h1 className="font-display text-[40px] text-text">Nothing here</h1>
        <p className="mt-2 text-[14px] text-muted">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      </div>
      <Link href="/w">
        <Button variant="primary">Go to your workspaces</Button>
      </Link>
    </main>
  );
}
