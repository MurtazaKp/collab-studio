/**
 * The module registry. A workspace has at most one module of each type; each
 * module contains many items (documents, boards, channels, ...).
 */
export const MODULE_TYPES = [
  "docs",
  "whiteboard",
  "kanban",
  "chat",
  "mindmap",
  "code",
  "playlist",
  "shopping",
  "calendar",
  "polls",
  "sheets",
] as const;

export type ModuleType = (typeof MODULE_TYPES)[number];

/** How a module's shared state is synchronised. */
export type SyncModel = "yjs" | "relational";

export interface ModuleDefinition {
  type: ModuleType;
  label: string;
  /** Singular noun for one item inside the module. */
  itemNoun: string;
  description: string;
  /** URL segment under /w/[workspaceId]/ */
  segment: string;
  sync: SyncModel;
  /** Collaboration room kind for Yjs-backed modules. */
  roomKind?: RoomKind;
}

export const ROOM_KINDS = ["document", "whiteboard", "mindmap", "code"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const MODULES: Record<ModuleType, ModuleDefinition> = {
  docs: {
    type: "docs",
    label: "Docs",
    itemNoun: "document",
    description: "Rich-text documents edited together in real time.",
    segment: "docs",
    sync: "yjs",
    roomKind: "document",
  },
  whiteboard: {
    type: "whiteboard",
    label: "Whiteboard",
    itemNoun: "board",
    description: "An infinite canvas for sticky notes, shapes and sketches.",
    segment: "whiteboard",
    sync: "yjs",
    roomKind: "whiteboard",
  },
  kanban: {
    type: "kanban",
    label: "Kanban",
    itemNoun: "board",
    description: "Plan work across columns with assignees and due dates.",
    segment: "kanban",
    sync: "relational",
  },
  chat: {
    type: "chat",
    label: "Chat",
    itemNoun: "channel",
    description: "Persistent channels with threads, reactions and presence.",
    segment: "chat",
    sync: "relational",
  },
  mindmap: {
    type: "mindmap",
    label: "Mindmap",
    itemNoun: "mindmap",
    description: "Branch ideas from a central topic and arrange them freely.",
    segment: "mindmap",
    sync: "yjs",
    roomKind: "mindmap",
  },
  code: {
    type: "code",
    label: "Code",
    itemNoun: "project",
    description: "Pair on code with a shared Monaco editor. Nothing is executed.",
    segment: "code",
    sync: "yjs",
    roomKind: "code",
  },
  playlist: {
    type: "playlist",
    label: "Playlist",
    itemNoun: "playlist",
    description: "Collect tracks and media links, ordered together.",
    segment: "playlists",
    sync: "relational",
  },
  shopping: {
    type: "shopping",
    label: "TODO List",
    itemNoun: "list",
    description: "Shared to-do lists with assignees, categories and check-offs.",
    segment: "shopping",
    sync: "relational",
  },
  calendar: {
    type: "calendar",
    label: "Calendar",
    itemNoun: "calendar",
    description: "Shared calendars for meetings, deadlines and events, with attendees.",
    segment: "calendar",
    sync: "relational",
  },
  polls: {
    type: "polls",
    label: "Polls",
    itemNoun: "poll",
    description: "Quick team decisions with live results.",
    segment: "polls",
    sync: "relational",
  },
  sheets: {
    type: "sheets",
    label: "Sheets",
    itemNoun: "sheet",
    description: "Spreadsheets edited together, cell by cell, with simple formulas.",
    segment: "sheets",
    sync: "relational",
  },
};

export function isModuleType(value: unknown): value is ModuleType {
  return typeof value === "string" && (MODULE_TYPES as readonly string[]).includes(value);
}

export function moduleForRoomKind(kind: RoomKind): ModuleType {
  switch (kind) {
    case "document":
      return "docs";
    case "whiteboard":
      return "whiteboard";
    case "mindmap":
      return "mindmap";
    case "code":
      return "code";
  }
}
