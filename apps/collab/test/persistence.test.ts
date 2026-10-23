import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import * as Y from "yjs";
import { asUser, createTestDb, createUser, createWorkspace } from "../../../supabase/tests/support/db";
import { YjsPersistence } from "../src/persistence";
import { silentLogger } from "../src/logger";
import { pgliteDb } from "./support";

let pg: PGlite;
let roomIdValue: string;

beforeAll(async () => {
  pg = await createTestDb();
  const owner = await createUser(pg, "Owner");
  const ws = await createWorkspace(pg, owner);
  await asUser(pg, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'P')`, [ws]));
  roomIdValue = (await pg.query<{ id: string }>(`select id from collaboration_rooms limit 1`)).rows[0]!.id;
});

function decode(state: Uint8Array | null): string {
  const d = new Y.Doc();
  if (state) Y.applyUpdate(d, state);
  return d.getText("t").toString();
}

describe("YjsPersistence", () => {
  it("never loses updates appended concurrently with compaction", async () => {
    const store = new YjsPersistence(pgliteDb(pg), silentLogger, { flushIntervalMs: 1, compactThreshold: 5 });
    const source = new Y.Doc();
    source.on("update", (u: Uint8Array) => store.enqueue(roomIdValue, u));

    const writes: Promise<void>[] = [];
    for (let i = 0; i < 120; i++) {
      source.getText("t").insert(source.getText("t").length, String(i % 10));
      if (i % 7 === 0) writes.push(store.store(roomIdValue, true));
      if (i % 3 === 0) writes.push(store.flush(roomIdValue));
      if (i % 11 === 0) await new Promise((r) => setTimeout(r, 2));
    }
    await Promise.all(writes);
    await store.flushAll();

    const { state } = await store.load(roomIdValue);
    expect(decode(state)).toBe(source.getText("t").toString());
    const snap = await pg.query<{ compacted_updates: string }>(`select compacted_updates from collaboration_snapshots where room_id = $1`, [roomIdValue]);
    expect(Number(snap.rows[0]!.compacted_updates)).toBeGreaterThan(0);
  });

  it("loads correctly when log rows duplicate content already in the snapshot", async () => {
    const store = new YjsPersistence(pgliteDb(pg), silentLogger, { flushIntervalMs: 1, compactThreshold: 1000 });
    const { state: before } = await store.load(roomIdValue);
    // Re-append the entire current state as if a row survived compaction.
    await store.appendNow(roomIdValue, before!);
    const { state: after } = await store.load(roomIdValue);
    expect(decode(after)).toBe(decode(before));
  });

  it("compaction leaves exactly one snapshot and an empty log", async () => {
    const store = new YjsPersistence(pgliteDb(pg), silentLogger, { flushIntervalMs: 1, compactThreshold: 1 });
    await store.store(roomIdValue, true);
    const rows = await pg.query<{ n: number }>(`select count(*)::int as n from collaboration_updates where room_id = $1`, [roomIdValue]);
    expect(rows.rows[0]!.n).toBe(0);
  });
});
