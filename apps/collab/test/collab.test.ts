import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import * as Y from "yjs";
import WebSocket from "ws";
import { signCollabToken } from "@collabverse/shared/collab-token";
import { readMindmap, MINDMAP_ROOT_ID } from "@collabverse/shared/mindmap";
import { readFiles } from "@collabverse/shared/code";
import { addMember, asUser, createTestDb, createUser, createWorkspace, setPlan, type TestUser } from "../../../supabase/tests/support/db";
import { connectClient, pgliteDb, roomId, SECRET, sleep, startServer, waitFor, type TestClient } from "./support";
import type { CollabServer } from "../src/server";

let pg: PGlite;
let owner: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser;
let ws: string;
let collab: CollabServer;
let url: string;
let port: number;
const clients: TestClient[] = [];

async function newEntity(table: "documents" | "mindmaps" | "code_projects" | "whiteboards", title: string, kind: string) {
  const r = await asUser(pg, owner, (tx) =>
    tx.query<{ id: string }>(`insert into ${table} (workspace_id, title) values ($1, $2) returning id`, [ws, title]),
  );
  return `${kind}:${r.rows[0]!.id}`;
}

function client(room: string, user: TestUser, opts?: Parameters<typeof connectClient>[3]) {
  const c = connectClient(url, room, user, opts);
  clients.push(c);
  return c;
}

const synced = (c: TestClient) => waitFor(() => c.provider.isSynced, 10_000, "provider sync");

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "Owner");
  member = await createUser(pg, "Member");
  viewer = await createUser(pg, "Viewer");
  outsider = await createUser(pg, "Outsider");
  ws = await createWorkspace(pg, owner, "Collab Co");
  await createWorkspace(pg, outsider, "Other Co");
  await addMember(pg, ws, member, "member");
  await addMember(pg, ws, viewer, "viewer");
  // Mindmap and Code are outside Free; plan limits are covered in supabase/tests/plans.test.ts.
  await setPlan(pg, ws, "team");
  ({ collab, url, port } = await startServer(pgliteDb(pg)));
});

afterEach(() => {
  while (clients.length) clients.pop()!.destroy();
});

afterAll(async () => {
  await collab.stop();
});

describe("multi-user editing", () => {
  it("two authenticated users editing concurrently converge, and the result is persisted", async () => {
    const room = await newEntity("documents", "Shared", "document");
    const a = client(room, owner);
    const b = client(room, member);
    await Promise.all([synced(a), synced(b)]);

    // Concurrent inserts at the same position from both users.
    a.doc.getText("t").insert(0, "alpha ");
    b.doc.getText("t").insert(0, "beta ");
    await waitFor(() => a.doc.getText("t").toString() === b.doc.getText("t").toString() && a.doc.getText("t").length === 11, 10_000, "convergence");
    const text = a.doc.getText("t").toString();
    expect(text).toContain("alpha");
    expect(text).toContain("beta");

    // Durable: after a flush the database alone reproduces the content.
    await collab.persistence.flushAll();
    const loaded = await collab.persistence.load(await roomId(pg, room));
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, loaded.state!);
    expect(fresh.getText("t").toString()).toBe(text);
  });

  it("offline edits from two clients merge after reconnection without losing either side", async () => {
    const room = await newEntity("documents", "Offline", "document");
    const a = client(room, owner);
    const b = client(room, member);
    await Promise.all([synced(a), synced(b)]);
    a.doc.getText("t").insert(0, "base");
    await waitFor(() => b.doc.getText("t").toString() === "base");

    // Simulate a network drop: the sockets close, the providers stay attached.
    a.socket.disconnect();
    b.socket.disconnect();
    await waitFor(() => a.socket.status === "disconnected" && b.socket.status === "disconnected", 5_000, "disconnect");
    a.doc.getText("t").insert(4, " from-a");
    b.doc.getText("t").insert(0, "from-b ");
    await sleep(200);
    expect(a.doc.getText("t").toString()).toBe("base from-a");

    void a.socket.connect();
    void b.socket.connect();
    await waitFor(
      () => a.doc.getText("t").toString() === b.doc.getText("t").toString() && a.doc.getText("t").toString().includes("from-a") && a.doc.getText("t").toString().includes("from-b"),
      10_000,
      "offline merge",
    );
    expect(a.doc.getText("t").toString()).toBe("from-b base from-a");
  });

  it("a page refresh (new client) restores confirmed changes", async () => {
    const room = await newEntity("documents", "Refresh", "document");
    const a = client(room, owner);
    await synced(a);
    a.doc.getText("t").insert(0, "keep me");
    await waitFor(() => !a.provider.hasUnsyncedChanges, 5_000, "ack");
    a.destroy();
    const again = client(room, owner);
    await synced(again);
    expect(again.doc.getText("t").toString()).toBe("keep me");
  });
});

describe("authorization", () => {
  it("viewers get a read-only scope and their writes are rejected by the server", async () => {
    const room = await newEntity("documents", "ReadOnly", "document");
    const writer = client(room, owner);
    const reader = client(room, viewer);
    await Promise.all([synced(writer), synced(reader)]);
    expect(reader.provider.authorizedScope).toBe("readonly");
    writer.doc.getText("t").insert(0, "official");
    await waitFor(() => reader.doc.getText("t").toString() === "official");
    reader.doc.getText("t").insert(0, "vandalism ");
    await sleep(300);
    expect(writer.doc.getText("t").toString()).toBe("official");
    await collab.persistence.flushAll();
    const loaded = await collab.persistence.load(await roomId(pg, room));
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, loaded.state!);
    expect(fresh.getText("t").toString()).toBe("official");
  });

  it("rejects outsiders even with a correctly signed token", async () => {
    const room = await newEntity("documents", "Private", "document");
    const c = client(room, outsider);
    await waitFor(() => c.authFailures.length > 0, 5_000, "auth failure");
    expect(c.authFailures[0]).toBe("forbidden");
    expect(c.provider.isSynced).toBe(false);
  });

  it("rejects forged, expired, wrong-room and missing tokens", async () => {
    const room = await newEntity("documents", "Tokens", "document");
    const other = await newEntity("documents", "Other", "document");
    const cases: [string, () => Promise<string>, string][] = [
      ["forged", () => signCollabToken({ userId: owner.id, room }, "a-different-secret-a-different-secret!!"), "invalid-token"],
      ["expired", () => signCollabToken({ userId: owner.id, room }, SECRET, -10), "token-expired"],
      ["wrong room", () => signCollabToken({ userId: owner.id, room: other }, SECRET), "invalid-token"],
      ["garbage", async () => "not-a-jwt", "invalid-token"],
      ["empty", async () => "", "missing-token"],
    ];
    for (const [label, token, reason] of cases) {
      const c = client(room, owner, { token });
      await waitFor(() => c.authFailures.length > 0, 5_000, `auth failure (${label})`);
      expect(c.authFailures[0], label).toBe(reason);
    }
  });

  it("rejects malformed room names and rooms in disabled modules", async () => {
    const bad = client("document:not-a-uuid", owner, { token: async () => "x" });
    await waitFor(() => bad.authFailures.length > 0);
    expect(bad.authFailures[0]).toBe("invalid-room");

    const room = await newEntity("code_projects", "Disabled", "code");
    await pg.query(`update workspace_modules set enabled = false where workspace_id = $1 and module_type = 'code'`, [ws]);
    try {
      const c = client(room, owner);
      await waitFor(() => c.authFailures.length > 0);
      expect(c.authFailures[0]).toBe("module-disabled");
    } finally {
      await pg.query(`update workspace_modules set enabled = true where workspace_id = $1 and module_type = 'code'`, [ws]);
    }
  });

  it("disconnects a removed member's existing session and refuses their later writes", async () => {
    const temp = await createUser(pg, "Temp");
    await addMember(pg, ws, temp, "member");
    const room = await newEntity("documents", "Revocation", "document");
    const victim = client(room, owner);
    const revoked = client(room, temp);
    await Promise.all([synced(victim), synced(revoked)]);
    revoked.doc.getText("t").insert(0, "before ");
    await waitFor(() => victim.doc.getText("t").toString() === "before ");

    await asUser(pg, owner, (tx) => tx.query(`select remove_member($1, $2)`, [ws, temp.id]));
    await collab.revalidateAll();
    await waitFor(() => revoked.closes.includes("access-revoked"), 5_000, "revocation close");

    // The stale client keeps a local doc but can no longer reach the room.
    revoked.doc.getText("t").insert(0, "after ");
    await sleep(400);
    expect(victim.doc.getText("t").toString()).toBe("before ");
    // A fresh connection attempt with a still-valid token is refused.
    const retry = client(room, temp);
    await waitFor(() => retry.authFailures.length > 0);
    expect(retry.authFailures[0]).toBe("forbidden");
  });

  it("forces a reconnect when a member is downgraded so the new read-only scope applies", async () => {
    const temp = await createUser(pg, "Downgrade");
    await addMember(pg, ws, temp, "member");
    const room = await newEntity("documents", "Downgrade", "document");
    const c = client(room, temp);
    await synced(c);
    expect(c.provider.authorizedScope).toBe("read-write");
    await asUser(pg, owner, (tx) => tx.query(`select update_member_role($1, $2, 'viewer')`, [ws, temp.id]));
    await collab.revalidateAll();
    await waitFor(() => c.closes.includes("role-changed"), 5_000, "role-changed close");
  });

  it("rejects WebSocket upgrades from origins outside the allow-list", async () => {
    const { collab: strict, url: strictUrl } = await startServer(pgliteDb(pg), { allowedOrigins: ["https://app.example.com"] });
    try {
      const outcome = (origin: string) =>
        new Promise<string>((resolve) => {
          const sock = new WebSocket(strictUrl, { headers: { origin } });
          sock.on("open", () => {
            sock.close();
            resolve("open");
          });
          sock.on("error", () => resolve("error"));
          sock.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
        });
      expect(await outcome("https://evil.example.com")).toMatch(/403|error/);
      expect(await outcome("https://app.example.com")).toBe("open");
    } finally {
      await strict.stop();
    }
  });
});

describe("durability and recovery", () => {
  it("restores state after a graceful restart", async () => {
    const room = await newEntity("documents", "Restart", "document");
    const local = await startServer(pgliteDb(pg));
    const c = connectClient(local.url, room, owner);
    await waitFor(() => c.provider.isSynced);
    c.doc.getText("t").insert(0, "survives restart");
    await waitFor(() => !c.provider.hasUnsyncedChanges);
    c.destroy();
    await local.collab.stop();

    const next = await startServer(pgliteDb(pg));
    const d = connectClient(next.url, room, owner);
    try {
      await waitFor(() => d.provider.isSynced);
      expect(d.doc.getText("t").toString()).toBe("survives restart");
    } finally {
      d.destroy();
      await next.collab.stop();
    }
  });

  it("recovers acknowledged-but-unflushed updates from clients after a crash", async () => {
    const room = await newEntity("documents", "Crash", "document");
    // A huge flush window guarantees the update is only in server memory.
    const crashing = await startServer(pgliteDb(pg), { flushIntervalMs: 600_000 });
    const crashPort = crashing.port;
    const c = connectClient(crashing.url, room, owner);
    await waitFor(() => c.provider.isSynced);
    c.doc.getText("t").insert(0, "in memory only");
    await waitFor(() => !c.provider.hasUnsyncedChanges);
    expect(crashing.collab.persistence.pendingUpdates()).toBeGreaterThan(0);

    // Simulate a crash: tear down sockets without flushing persistence.
    await crashing.collab.server.destroy();

    // Restart on the same port; the client reconnects and re-syncs.
    const revived = await startServer(pgliteDb(pg), { port: crashPort });
    try {
      await waitFor(async () => {
        const loaded = await revived.collab.persistence.load(await roomId(pg, room));
        if (!loaded.state) return false;
        const d = new Y.Doc();
        Y.applyUpdate(d, loaded.state);
        return d.getText("t").toString() === "in memory only";
      }, 15_000, "recovered update persisted");
    } finally {
      c.destroy();
      await revived.collab.stop();
    }
  });

  it("keeps serving and retries when the database is briefly unavailable", async () => {
    let down = false;
    const room = await newEntity("documents", "Outage", "document");
    const flaky = await startServer(pgliteDb(pg, { failing: () => down }));
    const c = connectClient(flaky.url, room, owner);
    try {
      await waitFor(() => c.provider.isSynced);
      down = true;
      c.doc.getText("t").insert(0, "written during outage");
      await sleep(200);
      expect(flaky.collab.persistence.pendingUpdates()).toBeGreaterThan(0);
      down = false;
      await waitFor(() => flaky.collab.persistence.pendingUpdates() === 0, 15_000, "retry flush");
      const loaded = await flaky.collab.persistence.load(await roomId(pg, room));
      const d = new Y.Doc();
      Y.applyUpdate(d, loaded.state!);
      expect(d.getText("t").toString()).toBe("written during outage");
    } finally {
      c.destroy();
      await flaky.collab.stop();
    }
  });
});

describe("room lifecycle", () => {
  it("seeds new mindmap and code rooms once, server-side, even with simultaneous first visitors", async () => {
    const mm = await newEntity("mindmaps", "Launch", "mindmap");
    const a = client(mm, owner);
    const b = client(mm, member);
    await Promise.all([synced(a), synced(b)]);
    const nodes = readMindmap(a.doc);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: MINDMAP_ROOT_ID, label: "Launch" });
    expect(readMindmap(b.doc)).toHaveLength(1);

    const code = await newEntity("code_projects", "Snippets", "code");
    const c = client(code, owner);
    const d = client(code, member);
    await Promise.all([synced(c), synced(d)]);
    expect(readFiles(c.doc).map((f) => f.name)).toEqual(["main.ts"]);
    expect(readFiles(d.doc).map((f) => f.name)).toEqual(["main.ts"]);
  });

  it("writes a derived preview and last editor to the entity row", async () => {
    const room = await newEntity("documents", "Preview", "document");
    const c = client(room, member);
    await synced(c);
    const frag = c.doc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText("Hello preview")]);
    frag.insert(0, [p]);
    const docId = room.split(":")[1];
    await waitFor(async () => {
      const r = await pg.query<{ preview_text: string; last_edited_by: string | null }>(`select preview_text, last_edited_by from documents where id = $1`, [docId]);
      return r.rows[0]!.preview_text === "Hello preview" && r.rows[0]!.last_edited_by === member.id;
    }, 15_000, "preview saved");
  });

  it("serves a health endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", db: "ok" });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });
});
