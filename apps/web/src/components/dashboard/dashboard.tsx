"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/notify-error";
import { LayoutGrid, Plus, Settings2, UserPlus } from "lucide-react";
import { MODULES, MODULE_TYPES, type ModuleType } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { usePresence } from "@/lib/realtime/presence";
import { resolveLayout, type DashboardItem, type DashboardSize } from "@/lib/dashboard";
import type { ItemRow } from "@/lib/data/items";
import { saveDashboardLayoutAction, setModuleConfigAction, setModuleEnabledAction } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/ui/misc";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ActivityFeed, type ActivityEvent } from "./activity-feed";
import {
  CalendarWidget,
  ChatWidget,
  CodeWidget,
  DocsWidget,
  KanbanWidget,
  MindmapWidget,
  PlaylistWidget,
  PollsWidget,
  SheetsWidget,
  ShoppingWidget,
  WhiteboardWidget,
  type WidgetProps,
} from "./widgets";

const WIDGETS: Record<ModuleType, (p: WidgetProps) => React.ReactNode> = {
  docs: DocsWidget,
  whiteboard: WhiteboardWidget,
  kanban: KanbanWidget,
  chat: ChatWidget,
  mindmap: MindmapWidget,
  code: CodeWidget,
  playlist: PlaylistWidget,
  shopping: ShoppingWidget,
  calendar: CalendarWidget,
  polls: PollsWidget,
  sheets: SheetsWidget,
};

const SPAN: Record<DashboardSize, string> = {
  sm: "md:col-span-3 xl:col-span-4",
  md: "md:col-span-3 xl:col-span-6",
  lg: "md:col-span-6 xl:col-span-8",
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Dashboard({
  savedLayout,
  itemsByModule,
  activity,
}: {
  savedLayout: unknown;
  itemsByModule: Partial<Record<ModuleType, ItemRow[]>>;
  activity: ActivityEvent[];
}) {
  const router = useRouter();
  const { workspace, me, members, modules, enabledModules, canManage, href } = useWorkspace();
  const { online } = usePresence();
  const [layout, setLayout] = useState<DashboardItem[]>(() => resolveLayout(savedLayout, enabledModules));
  const [customizing, setCustomizing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, startSaving] = useTransition();
  const [hello, setHello] = useState("Welcome");
  useEffect(() => setHello(greeting()), []);

  // Modules enabled/disabled elsewhere flow in without losing the user's order.
  useEffect(() => {
    setLayout((cur) => resolveLayout(cur, enabledModules));
  }, [enabledModules]);

  const persist = (next: DashboardItem[]) => {
    const previous = layout;
    setLayout(next);
    startSaving(async () => {
      const res = await saveDashboardLayoutAction(workspace.id, next);
      if (!res.ok) {
        toastError(res.error);
        setLayout(previous);
      }
    });
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...layout];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    persist(next);
  };

  const disabled = MODULE_TYPES.filter((m) => !enabledModules.includes(m));
  const onlineOthers = online.filter((o) => o.userId !== me.id);

  return (
    <div className="mx-auto max-w-[1400px] px-5 pt-7 pb-16 lg:px-10">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">{workspace.name}</p>
          <h1 className="mt-0.5 font-display text-[34px] leading-tight tracking-tight text-text">
            {hello}, {me.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-[13.5px] text-text-2">
            {workspace.description || `${members.length} member${members.length === 1 ? "" : "s"}`}
            {onlineOthers.length ? ` · ${onlineOthers.length} online now` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AvatarStack people={members.map((m) => ({ id: m.userId, name: m.name, color: m.color }))} max={6} size={28} />
          {canManage ? (
            <Link href={href("settings/members")}>
              <Button variant="outline">
                <UserPlus className="size-4" /> Invite
              </Button>
            </Link>
          ) : null}
          <Button variant={customizing ? "primary" : "outline"} onClick={() => setCustomizing((c) => !c)} loading={saving && customizing}>
            <LayoutGrid className="size-4" /> {customizing ? "Done" : "Customize"}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        {layout.map((item, i) => {
          const Widget = WIDGETS[item.module];
          const config = modules.find((m) => m.type === item.module)?.config ?? {};
          return (
            <div key={item.module} className={cn("animate-pop-in", SPAN[item.size])}>
              <Widget
                items={itemsByModule[item.module] ?? []}
                pinnedId={config.pinnedId ?? null}
                onPin={async (id) => {
                  const res = await setModuleConfigAction({ workspaceId: workspace.id, moduleType: item.module, config: { pinnedId: id } });
                  if (!res.ok) toastError(res.error);
                  else router.refresh();
                }}
                controls={{
                  customizing,
                  size: item.size,
                  onResize: (size) => persist(layout.map((l) => (l.module === item.module ? { ...l, size } : l))),
                  onMoveUp: i > 0 ? () => move(i, -1) : undefined,
                  onMoveDown: i < layout.length - 1 ? () => move(i, 1) : undefined,
                }}
              />
            </div>
          );
        })}

        <section className="md:col-span-3 xl:col-span-4" aria-label="Recent activity">
          <div className="flex min-h-56 flex-col rounded-2xl border border-border bg-surface px-4 pt-3.5 pb-2 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-[13.5px] font-semibold text-text">Recent activity</h2>
              <Link href={href("activity")} className="text-[12.5px] text-muted hover:text-text">
                View all
              </Link>
            </div>
            <ActivityFeed initial={activity} limit={6} compact />
          </div>
        </section>

        {canManage && disabled.length ? (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong text-[13.5px] text-muted transition-colors hover:border-accent hover:bg-surface hover:text-text md:col-span-3 xl:col-span-4"
          >
            <Plus className="size-5" />
            Add a module
          </button>
        ) : null}
      </div>

      {enabledModules.length === 0 ? (
        <p className="mt-6 text-center text-[13.5px] text-muted">
          No modules are enabled.{" "}
          {canManage ? (
            <Link href={href("settings")} className="text-accent hover:underline">
              Configure modules
            </Link>
          ) : (
            "Ask an admin to enable some."
          )}
        </p>
      ) : null}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add a module" description="Enabled modules appear in everyone's sidebar and dashboard." wide>
          <ul className="grid gap-2 sm:grid-cols-2">
            {disabled.map((m) => (
              <li key={m}>
                <AddModuleButton
                  type={m}
                  onAdd={async () => {
                    const res = await setModuleEnabledAction({ workspaceId: workspace.id, moduleType: m, enabled: true });
                    if (!res.ok) toastError(res.error);
                    else {
                      toast.success(`${MODULES[m].label} enabled`);
                      router.refresh();
                      if (disabled.length === 1) setAdding(false);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] text-muted">
            <Link href={href("settings")} className="inline-flex items-center gap-1 hover:text-text">
              <Settings2 className="size-3.5" /> Manage all modules in settings
            </Link>
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddModuleButton({ type, onAdd }: { type: ModuleType; onAdd: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onAdd();
        setBusy(false);
      }}
      className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/30 disabled:opacity-60"
    >
      <ModuleIcon type={type} tile />
      <span>
        <span className="block text-[13.5px] font-semibold text-text">{MODULES[type].label}</span>
        <span className="block text-[12.5px] leading-snug text-muted">{MODULES[type].description}</span>
      </span>
    </button>
  );
}
