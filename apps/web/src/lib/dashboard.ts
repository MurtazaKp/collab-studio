import { MODULE_TYPES, type ModuleType } from "@collabverse/shared";

export const DASHBOARD_SIZES = ["sm", "md", "lg"] as const;
export type DashboardSize = (typeof DASHBOARD_SIZES)[number];

export interface DashboardItem {
  module: ModuleType;
  size: DashboardSize;
}

const DEFAULT_SIZE: Record<ModuleType, DashboardSize> = {
  docs: "md",
  whiteboard: "lg",
  kanban: "lg",
  chat: "md",
  mindmap: "md",
  code: "sm",
  playlist: "sm",
  shopping: "sm",
  calendar: "md",
  polls: "sm",
  sheets: "sm",
};

/**
 * Merge a user's saved layout with the currently enabled modules: unknown or
 * disabled modules are dropped, newly enabled ones are appended.
 */
export function resolveLayout(saved: unknown, enabled: readonly ModuleType[]): DashboardItem[] {
  const out: DashboardItem[] = [];
  const seen = new Set<ModuleType>();
  if (Array.isArray(saved)) {
    for (const raw of saved) {
      if (!raw || typeof raw !== "object") continue;
      const m = (raw as { module?: unknown }).module;
      const s = (raw as { size?: unknown }).size;
      if (typeof m !== "string" || !(MODULE_TYPES as readonly string[]).includes(m)) continue;
      const mod = m as ModuleType;
      if (!enabled.includes(mod) || seen.has(mod)) continue;
      seen.add(mod);
      out.push({ module: mod, size: (DASHBOARD_SIZES as readonly unknown[]).includes(s) ? (s as DashboardSize) : DEFAULT_SIZE[mod] });
    }
  }
  for (const mod of enabled) if (!seen.has(mod)) out.push({ module: mod, size: DEFAULT_SIZE[mod] });
  return out;
}
