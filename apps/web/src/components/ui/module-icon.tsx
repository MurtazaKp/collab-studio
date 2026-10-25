import {
  CalendarDays,
  CodeXml,
  FileSpreadsheet,
  FileText,
  KanbanSquare,
  MessagesSquare,
  Music,
  Network,
  PenTool,
  ListTodo,
  Vote,
  type LucideIcon,
} from "lucide-react";
import type { ModuleType } from "@collabverse/shared";
import { cn } from "@/lib/utils";

export const MODULE_ICONS: Record<ModuleType, LucideIcon> = {
  docs: FileText,
  whiteboard: PenTool,
  kanban: KanbanSquare,
  chat: MessagesSquare,
  mindmap: Network,
  code: CodeXml,
  playlist: Music,
  shopping: ListTodo,
  calendar: CalendarDays,
  polls: Vote,
  sheets: FileSpreadsheet,
};

export const MODULE_COLOR: Record<ModuleType, string> = {
  docs: "var(--mod-docs)",
  whiteboard: "var(--mod-whiteboard)",
  kanban: "var(--mod-kanban)",
  chat: "var(--mod-chat)",
  mindmap: "var(--mod-mindmap)",
  code: "var(--mod-code)",
  playlist: "var(--mod-playlist)",
  shopping: "var(--mod-shopping)",
  calendar: "var(--mod-calendar)",
  polls: "var(--mod-polls)",
  sheets: "var(--mod-sheets)",
};

export function ModuleIcon({ type, className, tile = false }: { type: ModuleType; className?: string; tile?: boolean }) {
  const Icon = MODULE_ICONS[type];
  if (!tile) return <Icon aria-hidden className={cn("size-4", className)} style={{ color: MODULE_COLOR[type] }} />;
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-7 items-center justify-center rounded-lg", className)}
      style={{ background: `color-mix(in oklab, ${MODULE_COLOR[type]} 14%, transparent)`, color: MODULE_COLOR[type] }}
    >
      <Icon className="size-4" />
    </span>
  );
}
