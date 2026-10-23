"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Pin } from "lucide-react";
import { MODULES, type ModuleType } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import type { DashboardSize } from "@/lib/dashboard";
import type { ItemRow } from "@/lib/data/items";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface WidgetControls {
  customizing: boolean;
  size: DashboardSize;
  onResize: (s: DashboardSize) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function WidgetFrame({
  type,
  title,
  href,
  controls,
  items,
  pinnedId,
  onPin,
  children,
  bodyClassName,
}: {
  type: ModuleType;
  title?: string;
  href: string;
  controls: WidgetControls;
  items?: ItemRow[];
  pinnedId?: string | null;
  onPin?: (id: string | null) => void;
  children: ReactNode;
  bodyClassName?: string;
}) {
  const { canManage } = useWorkspace();
  const def = MODULES[type];
  return (
    <article
      className={cn(
        "flex min-h-56 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow",
        controls.customizing && "ring-2 ring-accent/30 ring-offset-2 ring-offset-bg",
      )}
      aria-label={`${def.label} widget`}
    >
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <ModuleIcon type={type} tile />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold text-text">{def.label}</h2>
          {title ? <p className="truncate text-[12px] text-muted">{title}</p> : null}
        </div>
        {controls.customizing ? (
          <div className="flex items-center gap-0.5">
            <div role="radiogroup" aria-label="Widget size" className="flex rounded-md border border-border bg-surface-2 p-0.5">
              {(["sm", "md", "lg"] as const).map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={controls.size === s}
                  onClick={() => controls.onResize(s)}
                  className={cn("h-6 w-7 rounded text-[11px] font-semibold uppercase", controls.size === s ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}
                >
                  {s === "sm" ? "S" : s === "md" ? "M" : "L"}
                </button>
              ))}
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="Move earlier" disabled={!controls.onMoveUp} onClick={controls.onMoveUp}>
              <ArrowUp className="size-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move later" disabled={!controls.onMoveDown} onClick={controls.onMoveDown}>
              <ArrowDown className="size-3.5" />
            </Button>
          </div>
        ) : (
          <>
            {canManage && onPin && items && items.length > 1 ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`Choose which ${def.itemNoun} to show`}>
                    <Pin className="size-3.5" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end" className="max-h-72 w-60 overflow-y-auto">
                  <MenuLabel>Show on dashboard</MenuLabel>
                  <MenuItem onSelect={() => onPin(null)}>
                    <span className="flex-1">Most recent</span>
                    {!pinnedId ? <span className="text-accent">●</span> : null}
                  </MenuItem>
                  <MenuSeparator />
                  {items.slice(0, 12).map((i) => (
                    <MenuItem key={i.id} onSelect={() => onPin(i.id)}>
                      <span className="flex-1 truncate">{i.title}</span>
                      {pinnedId === i.id ? <span className="text-accent">●</span> : null}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : null}
            <Link href={href} className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label={`Open ${def.label}`}>
              <ArrowUpRight className="size-4" />
            </Link>
          </>
        )}
      </header>
      <div className={cn("min-h-0 flex-1 px-4 pb-4", bodyClassName)}>{children}</div>
    </article>
  );
}

export function WidgetEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center text-[13px] text-muted">
      <p className="max-w-56">{children}</p>
      {action}
    </div>
  );
}
