import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { signCollabToken } from "@collabverse/shared/collab-token";
import { addMember, asUser, createTestDb, createUser, createWorkspace, type TestUser } from "../../../supabase/tests/support/db";
import { pgliteDb, SECRET, sleep, startServer, waitFor } from "./support";
import type { CollabServer } from "../src/server";
// The exact client module the web app ships (lib/collab/hocuspocus.ts), driven
// against a real collaboration server. Earlier server tests used hand-built
// provider clients and missed that the app's socket options never connected.
import { createHocuspocusCollaboration } from "../../web/src/lib/collab/hocuspocus";
import type { CollaborationProvider } from "../../web/src/lib/collab/types";

let pg: PGlite;
let owner: TestUser, member: TestUser, outsider: TestUser;
let ws: string;
let collab: CollabServer;
let url: string;
const providers: CollaborationProvider[] = [];

const tokenFor = (user: TestUser) => (room: string) => signCollabToken({ userId: user.id, room }, SECRET);

function app(user: TestUser): CollaborationProvider {
  const p = createHocuspocusCollaboration(url, tokenFor(user));
  providers.push(p);
  return p;
}

const asCollabUser = (u: TestUser) => ({ id: u.id, name: u.email, color: "#4b4fd8" });

async function newDocRoom(): Promise<string> {
  const r = await asUser(pg, owner, (tx) => tx.query<{ id: string }>(`insert into documents (workspace_id, title) values ($1, 'Doc') returning id`, [ws]));
  return `document:${r.rows[0]!.id}`;
}

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "Owner");
  member = await createUser(pg, "Member");
  outsider = await createUser(pg, "Outsider");
  ws = await createWorkspace(pg, owner);
  await addMember(pg, ws, member, "member");
  ({ collab, url } = await startServer(pgliteDb(pg)));
});

afterEach(() => {
  while (providers.length) providers.pop()!.destroy();
});

afterAll(() => collab.stop());

describe("web collaboration adapter", () => {
  it("syncs when the shared socket is already open before a room is joined (app page-load order)", async () => {
    const room = await newDocRoom();
    const p = app(owner);
    await sleep(600); // the app opens the socket on mount; rooms join on a later render
    const s = p.join(room, asCollabUser(owner));
    await waitFor(() => s.getState().synced, 8_000, "adapter sync");
    expect(s.getState()).toMatchObject({ status: "connected", access: "read-write", error: null });
  });

  it("two users' adapters converge on the same document", async () => {
    const room = await newDocRoom();
    const a = app(owner).join(room, asCollabUser(owner));
    const b = app(member).join(room, asCollabUser(member));
    await waitFor(() => a.getState().synced && b.getState().synced, 8_000, "both synced");
    a.doc.getText("t").insert(0, "from owner ");
    b.doc.getText("t").insert(0, "from member ");
    await waitFor(() => a.doc.getText("t").toString() === b.doc.getText("t").toString() && a.doc.getText("t").length === 23, 8_000, "convergence");
    // Awareness flows through the adapter too (presence avatars, cursors).
    await waitFor(() => [...a.awareness.getStates().values()].some((st) => (st as { user?: { id?: string } }).user?.id === member.id), 8_000, "awareness");
  });

  it("shares one session per room and keeps it alive while any component still uses it", async () => {
    const room = await newDocRoom();
    const p = app(owner);
    const first = p.join(room, asCollabUser(owner));
    const second = p.join(room, asCollabUser(owner));
    expect(second).toBe(first);
    await waitFor(() => first.getState().synced, 8_000, "sync");
    p.release(first);
    await sleep(1_800); // longer than the release grace period
    first.doc.getText("t").insert(0, "still live");
    const other = app(member).join(room, asCollabUser(member));
    await waitFor(() => other.doc.getText("t").toString() === "still live", 8_000, "shared session still connected");
  });

  it("surfaces a clear error instead of loading forever when access is denied", async () => {
    const room = await newDocRoom();
    const s = app(outsider).join(room, asCollabUser(outsider));
    await waitFor(() => s.getState().error !== null, 8_000, "error state");
    expect(s.getState().error?.code).toBe("forbidden");
    expect(s.getState().synced).toBe(false);
  });

  it("reports revocation for an open session", async () => {
    const temp = await createUser(pg, "Temp");
    await addMember(pg, ws, temp, "member");
    const room = await newDocRoom();
    const s = app(temp).join(room, asCollabUser(temp));
    await waitFor(() => s.getState().synced, 8_000, "sync");
    await asUser(pg, owner, (tx) => tx.query(`select remove_member($1, $2)`, [ws, temp.id]));
    await collab.revalidateAll();
    await waitFor(() => s.getState().error?.code === "access-revoked", 8_000, "revoked state");
  });

  it("reconnects with the new scope after a role change", async () => {
    const temp = await createUser(pg, "Downgraded");
    await addMember(pg, ws, temp, "member");
    const room = await newDocRoom();
    const s = app(temp).join(room, asCollabUser(temp));
    await waitFor(() => s.getState().access === "read-write", 8_000, "read-write");
    await asUser(pg, owner, (tx) => tx.query(`select update_member_role($1, $2, 'viewer')`, [ws, temp.id]));
    await collab.revalidateAll();
    await waitFor(() => s.getState().access === "readonly" && s.getState().synced, 10_000, "readonly after reconnect");
    expect(s.getState().error).toBeNull();
  });
});
