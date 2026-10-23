"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-[30px] text-text">Something went wrong</h1>
      <p className="max-w-sm text-[13.5px] text-muted">
        We couldn&apos;t load this page. Your saved work is safe. {error.digest ? `Reference: ${error.digest}` : ""}
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
