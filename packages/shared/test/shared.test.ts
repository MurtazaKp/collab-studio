import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  canChangeRole,
  canEdit,
  canManage,
  comparePositioned,
  initialPositions,
  parseRoomName,
  positionAtEnd,
  positionForIndex,
  roomName,
  safeStorageName,
  safeUrlSchema,
  sortByPosition,
  taskInputSchema,
  playlistItemInputSchema,
  channelNameSchema,
  inviteInputSchema,
} from "../src";
import { signCollabToken, verifyCollabToken } from "../src/collab-token";
import {
  addChildNode,
  deleteNode,
  MINDMAP_ROOT_ID,
  normalizeMindmap,
  readMindmap,
  reparentNode,
  seedMindmap,
  updateNode,
  type MindmapNodeData,
} from "../src/mindmap";
import { addObject, deleteObjects, readWhiteboard, updateObjects } from "../src/whiteboard";
import { addFile, deleteFile, readFiles, renameFile, seedCodeProject, validateFileName } from "../src/code";

const SECRET = "x".repeat(40);
const UUID = "3f1c2b8e-7a4d-4e5f-9a6b-1c2d3e4f5a6b";

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("roles", () => {
  it("encodes the permission matrix", () => {
    expect([canEdit("viewer"), canEdit("member"), canEdit("admin"), canEdit("owner")]).toEqual([false, true, true, true]);
    expect([canManage("member"), canManage("admin"), canManage("owner")]).toEqual([false, true, true]);
    expect(canEdit(null)).toBe(false);
    expect(canChangeRole("member", "viewer", "member")).toBe(false);
    expect(canChangeRole("admin", "owner", "admin")).toBe(false);
    expect(canChangeRole("admin", "member", "owner")).toBe(false);
    expect(canChangeRole("admin", "member", "viewer")).toBe(true);
  });
});

describe("room names", () => {
  it("round-trips valid names and rejects everything else", () => {
    expect(parseRoomName(roomName("document", UUID))).toEqual({ kind: "document", entityId: UUID });
    for (const bad of ["", "document", "document:", `docs:${UUID}`, "document:../etc", `document:${UUID}x`, `${"a".repeat(80)}`]) {
      expect(parseRoomName(bad)).toBeNull();
    }
    expect(() => roomName("code", "nope")).toThrow();
  });
});

describe("collab tokens", () => {
  it("verify only for the right room, secret and lifetime", async () => {
    const room = roomName("document", UUID);
    const token = await signCollabToken({ userId: UUID, room }, SECRET);
    expect(await verifyCollabToken(token, room, SECRET)).toMatchObject({ ok: true, claims: { userId: UUID, room } });
    expect(await verifyCollabToken(token, roomName("code", UUID), SECRET)).toEqual({ ok: false, reason: "room_mismatch" });
    expect(await verifyCollabToken(token, room, "y".repeat(40))).toEqual({ ok: false, reason: "invalid" });
    const expired = await signCollabToken({ userId: UUID, room }, SECRET, -5);
    expect(await verifyCollabToken(expired, room, SECRET)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyCollabToken("garbage", room, SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses weak secrets and invalid rooms", async () => {
    await expect(signCollabToken({ userId: UUID, room: roomName("document", UUID) }, "short")).rejects.toThrow();
    await expect(signCollabToken({ userId: UUID, room: "bad" }, SECRET)).rejects.toThrow();
  });
});

describe("fractional ordering", () => {
  it("inserts between neighbours and moves without touching other rows", () => {
    const keys = initialPositions(3);
    const items = keys.map((position, i) => ({ id: `i${i}`, position }));
    const front = positionForIndex(items, 0);
    expect(front < items[0]!.position).toBe(true);
    const middle = positionForIndex(items, 1, "i2");
    expect(middle > items[0]!.position && middle < items[1]!.position).toBe(true);
    expect(positionAtEnd(items) > items[2]!.position).toBe(true);
  });

  it("recovers from duplicate keys created concurrently", () => {
    const items = [
      { id: "a", position: "a0" },
      { id: "b", position: "a0" },
      { id: "c", position: "a1" },
    ];
    const key = positionForIndex(items, 2, "x");
    expect(sortByPosition([...items, { id: "x", position: key }]).map((i) => i.id)).toEqual(["a", "b", "x", "c"]);
    expect(comparePositioned({ id: "a", position: "a0" }, { id: "b", position: "a0" })).toBe(-1);
  });
});

describe("validation", () => {
  it("accepts only http(s) URLs", () => {
    expect(safeUrlSchema.safeParse("https://example.com/x").success).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.b", "not a url", "//example.com"]) {
      expect(safeUrlSchema.safeParse(bad).success).toBe(false);
    }
    expect(playlistItemInputSchema.safeParse({ title: "t", url: "javascript:x" }).success).toBe(false);
  });

  it("validates tasks, channels and invites", () => {
    expect(taskInputSchema.parse({ title: "  Ship  " })).toMatchObject({ title: "Ship", priority: "none", labels: [] });
    expect(taskInputSchema.safeParse({ title: "" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", priority: "critical" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", dueDate: "2026-13-45" }).success).toBe(false);
    expect(channelNameSchema.parse("Design-Crit")).toBe("design-crit");
    expect(channelNameSchema.safeParse("has space").success).toBe(false);
    expect(inviteInputSchema.safeParse({ workspaceId: UUID, email: "A@B.co", role: "owner" }).success).toBe(false);
    expect(inviteInputSchema.parse({ workspaceId: UUID, email: "A@B.co", role: "viewer" }).email).toBe("a@b.co");
  });

  it("sanitises storage names", () => {
    expect(safeStorageName("../../etc/passwd")).toBe("passwd");
    expect(safeStorageName("my report (final).pdf")).toBe("my_report_final_.pdf");
    expect(safeStorageName("..hidden")).toBe("hidden");
  });
});

describe("mindmap model", () => {
  it("seeds a single root and builds a tree with derived edges", () => {
    const doc = new Y.Doc();
    seedMindmap(doc, "Launch");
    seedMindmap(doc, "Again");
    const a = addChildNode(doc, MINDMAP_ROOT_ID, { label: "Marketing", x: 200, y: 0 });
    const b = addChildNode(doc, a, { label: "Blog post", x: 400, y: 0 });
    const { nodes, edges } = normalizeMindmap(readMindmap(doc));
    expect(nodes.map((n) => n.label)).toContain("Launch");
    expect(nodes).toHaveLength(3);
    expect(edges).toEqual(expect.arrayContaining([
      { id: `root->${a}`, source: "root", target: a },
      { id: `${a}->${b}`, source: a, target: b },
    ]));
    expect(() => addChildNode(doc, "missing", { x: 0, y: 0 })).toThrow();
  });

  it("refuses cycles and root moves; deletes whole subtrees", () => {
    const doc = new Y.Doc();
    seedMindmap(doc, "R");
    const a = addChildNode(doc, MINDMAP_ROOT_ID, { x: 0, y: 0 });
    const b = addChildNode(doc, a, { x: 0, y: 0 });
    expect(reparentNode(doc, a, b)).toBe(false);
    expect(reparentNode(doc, MINDMAP_ROOT_ID, a)).toBe(false);
    expect(reparentNode(doc, b, MINDMAP_ROOT_ID)).toBe(true);
    reparentNode(doc, b, a);
    expect(deleteNode(doc, a).sort()).toEqual([a, b].sort());
    expect(deleteNode(doc, MINDMAP_ROOT_ID)).toEqual([]);
    expect(readMindmap(doc)).toHaveLength(1);
  });

  it("resolves concurrent cycles and orphans identically on every replica", () => {
    const d1 = new Y.Doc();
    seedMindmap(d1, "R");
    const x = addChildNode(d1, MINDMAP_ROOT_ID, { label: "X", x: 0, y: 0 });
    const y = addChildNode(d1, MINDMAP_ROOT_ID, { label: "Y", x: 0, y: 0 });
    const d2 = new Y.Doc();
    sync(d1, d2);
    // Concurrent: d1 puts X under Y, d2 puts Y under X → a cycle after merge.
    expect(reparentNode(d1, x, y)).toBe(true);
    expect(reparentNode(d2, y, x)).toBe(true);
    // Concurrent: d1 deletes Y's subtree... while d2 adds a child to Y.
    const orphan = addChildNode(d2, y, { label: "child", x: 0, y: 0 });
    sync(d1, d2);
    const n1 = normalizeMindmap(readMindmap(d1));
    const n2 = normalizeMindmap(readMindmap(d2));
    expect(n1).toEqual(n2);
    // Every node reaches the root.
    const byId = new Map(n1.nodes.map((n) => [n.id, n] as const));
    for (const n of n1.nodes) {
      let cur: MindmapNodeData | undefined = n;
      const seen = new Set<string>();
      while (cur && cur.parentId) {
        expect(seen.has(cur.id)).toBe(false);
        seen.add(cur.id);
        cur = byId.get(cur.parentId);
      }
      expect(cur?.id).toBe(MINDMAP_ROOT_ID);
    }
    expect(n1.nodes.some((n) => n.id === orphan)).toBe(true);
  });

  it("can add topics again after every other topic was deleted", () => {
    const doc = new Y.Doc();
    seedMindmap(doc, "R");
    const a = addChildNode(doc, MINDMAP_ROOT_ID, { x: 0, y: 0 });
    const b = addChildNode(doc, MINDMAP_ROOT_ID, { x: 0, y: 50 });
    addChildNode(doc, a, { x: 0, y: 0 });
    deleteNode(doc, a);
    deleteNode(doc, b);
    expect(readMindmap(doc).map((n) => n.id)).toEqual([MINDMAP_ROOT_ID]);
    addChildNode(doc, MINDMAP_ROOT_ID, { label: "Again", x: 200, y: 0 });
    expect(readMindmap(doc)).toHaveLength(2);
  });

  it("recreates a missing root instead of failing when adding under it", () => {
    const doc = new Y.Doc();
    // A map whose root was lost: the canvas shows a placeholder root.
    expect(normalizeMindmap(readMindmap(doc)).nodes.map((n) => n.id)).toEqual([MINDMAP_ROOT_ID]);
    const id = addChildNode(doc, MINDMAP_ROOT_ID, { label: "First", x: 200, y: 0 });
    const nodes = readMindmap(doc);
    expect(nodes.map((n) => n.id).sort()).toEqual([id, MINDMAP_ROOT_ID].sort());
    expect(nodes.find((n) => n.id === id)!.parentId).toBe(MINDMAP_ROOT_ID);
  });

  it("merges concurrent edits to different fields of one node", () => {
    const d1 = new Y.Doc();
    seedMindmap(d1, "R");
    const a = addChildNode(d1, MINDMAP_ROOT_ID, { label: "old", x: 0, y: 0 });
    const d2 = new Y.Doc();
    sync(d1, d2);
    updateNode(d1, a, { label: "renamed" });
    updateNode(d2, a, { x: 123, y: 45 });
    sync(d1, d2);
    const node = readMindmap(d1).find((n) => n.id === a)!;
    expect(node).toMatchObject({ label: "renamed", x: 123, y: 45 });
    updateNode(d1, a, { x: Number.NaN, label: "z".repeat(500) });
    const sanitized = readMindmap(d1).find((n) => n.id === a)!;
    expect(sanitized.x).toBe(0);
    expect(sanitized.label.length).toBe(200);
  });
});

describe("whiteboard model", () => {
  it("keeps concurrent move and text edits of one object", () => {
    const d1 = new Y.Doc();
    const id = addObject(d1, { type: "sticky", x: 0, y: 0, w: 160, h: 120, text: "idea", color: "yellow" });
    const d2 = new Y.Doc();
    sync(d1, d2);
    updateObjects(d1, { [id]: { x: 300, y: 200 } });
    updateObjects(d2, { [id]: { text: "better idea", color: "pink" } });
    sync(d1, d2);
    expect(readWhiteboard(d1)).toEqual(readWhiteboard(d2));
    expect(readWhiteboard(d1)[0]).toMatchObject({ x: 300, y: 200, text: "better idea", color: "pink" });
  });

  it("drops connectors whose endpoints vanish, and deletes attached connectors", () => {
    const d = new Y.Doc();
    const a = addObject(d, { type: "rect", x: 0, y: 0, w: 10, h: 10, text: "", color: "blue" });
    const b = addObject(d, { type: "ellipse", x: 50, y: 0, w: 10, h: 10, text: "", color: "green" });
    addObject(d, { type: "connector", x: 0, y: 0, w: 4, h: 4, text: "", color: "ink", from: a, to: b });
    expect(readWhiteboard(d)).toHaveLength(3);
    deleteObjects(d, [a]);
    expect(readWhiteboard(d).map((o) => o.id)).toEqual([b]);
  });

  it("ignores malformed objects written by a misbehaving client", () => {
    const d = new Y.Doc();
    const bad = new Y.Map<unknown>();
    bad.set("type", "<script>");
    d.getMap("objects").set("x", bad);
    const path = new Y.Map<unknown>();
    path.set("type", "path");
    path.set("points", "not-an-array");
    d.getMap("objects").set("y", path);
    expect(readWhiteboard(d)).toEqual([]);
  });

  it("stores an optional, clamped text size", () => {
    const d = new Y.Doc();
    const id = addObject(d, { type: "text", x: 0, y: 0, w: 220, h: 48, text: "hi", color: "ink" });
    expect(readWhiteboard(d)[0]!.fontSize).toBeUndefined();
    updateObjects(d, { [id]: { fontSize: 32 } });
    expect(readWhiteboard(d)[0]!.fontSize).toBe(32);
    updateObjects(d, { [id]: { fontSize: 9999 } });
    expect(readWhiteboard(d)[0]!.fontSize).toBe(120);
  });
});

describe("code model", () => {
  it("manages files with validation", () => {
    const d = new Y.Doc();
    seedCodeProject(d);
    seedCodeProject(d);
    expect(readFiles(d).map((f) => f.name)).toEqual(["main.ts"]);
    expect(addFile(d, "main.ts")).toEqual({ error: "duplicate_name" });
    expect(addFile(d, "../evil")).toEqual({ error: "invalid_name" });
    const r = addFile(d, "app.py", "print('hi')");
    expect("id" in r).toBe(true);
    const id = (r as { id: string }).id;
    expect(readFiles(d).find((f) => f.id === id)!.language).toBe("python");
    expect(renameFile(d, id, "app.rs")).toBeNull();
    expect(readFiles(d).find((f) => f.id === id)!.language).toBe("rust");
    expect(validateFileName(d, "MAIN.TS")).toBe("duplicate_name");
    deleteFile(d, id);
    expect(readFiles(d)).toHaveLength(1);
  });

  it("merges concurrent edits to the same file buffer", () => {
    const d1 = new Y.Doc();
    seedCodeProject(d1);
    const d2 = new Y.Doc();
    sync(d1, d2);
    const t1 = d1.getMap<Y.Text>("contents").get("main")!;
    const t2 = d2.getMap<Y.Text>("contents").get("main")!;
    t1.insert(0, "// top\n");
    t2.insert(t2.length, "// bottom\n");
    sync(d1, d2);
    expect(t1.toString()).toBe(t2.toString());
    expect(t1.toString().startsWith("// top\n")).toBe(true);
    expect(t1.toString().endsWith("// bottom\n")).toBe(true);
  });
});
