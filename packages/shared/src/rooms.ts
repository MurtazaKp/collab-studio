import { ROOM_KINDS, type RoomKind } from "./modules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Collaboration rooms are named `<kind>:<entity uuid>`, e.g. `document:3f…`. */
export function roomName(kind: RoomKind, entityId: string): string {
  if (!isUuid(entityId)) throw new Error("Invalid entity id for room name");
  return `${kind}:${entityId}`;
}

export interface ParsedRoom {
  kind: RoomKind;
  entityId: string;
}

export function parseRoomName(name: string): ParsedRoom | null {
  if (typeof name !== "string" || name.length > 64) return null;
  const idx = name.indexOf(":");
  if (idx < 0) return null;
  const kind = name.slice(0, idx);
  const entityId = name.slice(idx + 1);
  if (!(ROOM_KINDS as readonly string[]).includes(kind)) return null;
  if (!isUuid(entityId)) return null;
  return { kind: kind as RoomKind, entityId };
}
