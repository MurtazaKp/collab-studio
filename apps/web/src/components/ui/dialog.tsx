"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[rgb(20_19_16/0.4)] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed top-[12vh] left-1/2 z-50 max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-lg",
          "data-[state=open]:animate-pop-in focus:outline-none",
          wide ? "max-w-2xl" : "max-w-md",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-[15px] font-semibold text-text">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] leading-relaxed text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close
            className="-m-1 rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-5 flex items-center justify-end gap-2", className)}>{children}</div>;
}
