"use client";

import { DropdownMenu as M, Popover as P, Tooltip as T } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const panel =
  "z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-lg data-[state=open]:animate-pop-in focus:outline-none";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = "start", sideOffset = 6, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={sideOffset} className={cn(panel, className)} {...props} />
    </M.Portal>
  );
}

export function MenuItem({
  className,
  destructive,
  icon,
  children,
  ...props
}: ComponentProps<typeof M.Item> & { destructive?: boolean; icon?: ReactNode }) {
  return (
    <M.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] outline-none select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        destructive ? "text-danger data-[highlighted]:bg-danger-soft" : "text-text data-[highlighted]:bg-surface-2",
        className,
      )}
      {...props}
    >
      {icon ? <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-4">{icon}</span> : null}
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={sideOffset} className={cn(panel, "p-3", className)} {...props} />
    </P.Portal>
  );
}

export function Tooltip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md bg-text px-2 py-1 text-[12px] font-medium text-bg shadow-md data-[state=delayed-open]:animate-fade-in"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = T.Provider;
