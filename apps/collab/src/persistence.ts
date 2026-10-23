import * as Y from "yjs";
import { toBytes, type Db } from "./db";
import type { Logger } from "./logger";

/**
 * Durable Yjs persistence: an append-only update log plus a compacted snapshot.
 *
 * Write path
 *   Every document update is buffered per room and appended as one merged row
 *   at most `flushIntervalMs` later. Writes for a room are serialised, and a
 *   failed write puts the updates back at the front of the buffer and retries.
 *
 * Compaction
 *   In one transaction, under a per-room advisory lock (so two servers, e.g.
 *   during a zero-downtime deploy, never compact the same room at once): read
 *   the snapshot and the log rows that exist at that moment, merge, upsert the
 *   snapshot, and delete exactly those row ids. Rows appended concurrently are not in the id list, so they
 *   survive and are applied on the next load. Re-applying an update already in
 *   the snapshot is a no-op in Yjs, so load = snapshot + every remaining row is
 *   always correct, regardless of commit order.
 *
 * Crash window
 *   The server acknowledges updates once applied in memory, before the batched
 *   append. If the process dies within that window, clients still hold those
 *   updates and re-send them during the next sync handshake (state-vector
 *   exchange), so they are only lost if the server and every client holding
 *   them die together.
 */
export interface PersistenceOptions {
  flushIntervalMs: number;
  compactThreshold: number;
}

interface RoomBuffer {
  updates: Uint8Array[];
  timer: NodeJS.Timeout | null;
  chain: Promise<void>;
  appendedSinceCompact: number;
  failures: number;
}

export class YjsPersistence {
  private rooms = new Map<string, RoomBuffer>();
  private closed = false;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly opts: PersistenceOptions,
  ) {}

  private room(roomId: string): RoomBuffer {
    let r = this.rooms.get(roomId);
    if (!r) {
      r = { updates: [], timer: null, chain: Promise.resolve(), appendedSinceCompact: 0, failures: 0 };
      this.rooms.set(roomId, r);
    }
    return r;
  }

  /** Run `fn` after every earlier operation for this room has settled. */
  private serial(roomId: string, fn: () => Promise<void>): Promise<void> {
    const r = this.room(roomId);
    const next = r.chain.then(fn, fn);
    r.chain = next.catch(() => undefined);
    return next;
  }

  /** Merged state for a room, or null when nothing was ever stored. */
  async load(roomId: string): Promise<{ state: Uint8Array | null; rows: number }> {
    // Read the log BEFORE the snapshot. If a compaction commits in between,
    // the rows it removed are already in the snapshot we read afterwards, so
    // nothing is missed (re-applying an update is a no-op in Yjs).
    const log = await this.db.query<{ data: unknown }>(
      `select data from public.collaboration_updates where room_id = $1 order by id`,
      [roomId],
    );
    const snap = await this.db.query<{ state: unknown }>(
      `select state from public.collaboration_snapshots where room_id = $1`,
      [roomId],
    );
    const parts: Uint8Array[] = [];
    if (snap.rows[0]) parts.push(toBytes(snap.rows[0].state));
    for (const row of log.rows) parts.push(toBytes(row.data));
    this.room(roomId).appendedSinceCompact = log.rows.length;
    if (parts.length === 0) return { state: null, rows: 0 };
    return { state: parts.length === 1 ? parts[0]! : Y.mergeUpdates(parts), rows: log.rows.length };
  }

  /** Persist an update immediately (used for server-side seeding). */
  async appendNow(roomId: string, update: Uint8Array): Promise<void> {
    await this.serial(roomId, async () => {
      await this.db.query(`insert into public.collaboration_updates (room_id, data) values ($1, $2)`, [
        roomId,
        Buffer.from(update),
      ]);
      this.room(roomId).appendedSinceCompact += 1;
    });
  }

  enqueue(roomId: string, update: Uint8Array): void {
    if (this.closed) {
      this.log.error("update received after persistence closed", { roomId });
    }
    const r = this.room(roomId);
    r.updates.push(update);
    if (!r.timer) {
      r.timer = setTimeout(() => {
        r.timer = null;
        this.flush(roomId).catch(() => undefined);
      }, this.opts.flushIntervalMs);
    }
  }

  pendingUpdates(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.updates.length;
    return n;
  }

  flush(roomId: string): Promise<void> {
    const r = this.room(roomId);
    if (r.timer) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    return this.serial(roomId, async () => {
      if (r.updates.length === 0) return;
      const batch = r.updates;
      r.updates = [];
      try {
        const merged = batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch);
        await this.db.query(`insert into public.collaboration_updates (room_id, data) values ($1, $2)`, [
          roomId,
          Buffer.from(merged),
        ]);
        r.appendedSinceCompact += 1;
        r.failures = 0;
      } catch (err) {
        // Keep the data; retry with backoff. Never drop confirmed updates.
        r.updates = batch.concat(r.updates);
        r.failures += 1;
        const delay = Math.min(30_000, this.opts.flushIntervalMs * 2 ** r.failures);
        this.log.error("failed to append updates; will retry", { roomId, updates: batch.length, delay, err });
        if (!r.timer && !this.closed) {
          r.timer = setTimeout(() => {
            r.timer = null;
            this.flush(roomId).catch(() => undefined);
          }, delay);
        }
        throw err;
      }
    });
  }

  /** Flush, then compact if the log has grown past the threshold (or `force`). */
  async store(roomId: string, force = false): Promise<void> {
    await this.flush(roomId).catch(() => undefined);
    const r = this.room(roomId);
    if (!force && r.appendedSinceCompact < this.opts.compactThreshold) return;
    await this.serial(roomId, () => this.compact(roomId));
  }

  private async compact(roomId: string): Promise<void> {
    const started = Date.now();
    const result = await this.db.transaction(async (q) => {
      // Serialise compaction of this room across every server and connection.
      // A row lock alone isn't enough: before the first snapshot exists there
      // is no row to lock, and a slower compaction could overwrite a newer
      // snapshot. Held until commit/rollback.
      await q.query(`select pg_advisory_xact_lock(hashtextextended($1, 7))`, [roomId]);
      const snap = await q.query<{ state: unknown }>(
        `select state from public.collaboration_snapshots where room_id = $1 for update`,
        [roomId],
      );
      const rows = await q.query<{ id: string | number; data: unknown }>(
        `select id, data from public.collaboration_updates where room_id = $1 order by id`,
        [roomId],
      );
      if (rows.rows.length === 0) return 0;
      const parts: Uint8Array[] = [];
      if (snap.rows[0]) parts.push(toBytes(snap.rows[0].state));
      for (const row of rows.rows) parts.push(toBytes(row.data));
      // Round-trip through a Y.Doc so deleted content is garbage-collected.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.mergeUpdates(parts));
      const state = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      await q.query(
        `insert into public.collaboration_snapshots (room_id, state, compacted_updates, updated_at)
         values ($1, $2, $3, now())
         on conflict (room_id) do update
           set state = excluded.state,
               compacted_updates = public.collaboration_snapshots.compacted_updates + excluded.compacted_updates,
               updated_at = now()`,
        [roomId, Buffer.from(state), rows.rows.length],
      );
      await q.query(`delete from public.collaboration_updates where room_id = $1 and id = any($2::bigint[])`, [
        roomId,
        rows.rows.map((x) => String(x.id)),
      ]);
      return rows.rows.length;
    });
    this.room(roomId).appendedSinceCompact = 0;
    if (result > 0) this.log.info("compacted room", { roomId, rows: result, ms: Date.now() - started });
  }

  /** Drop in-memory bookkeeping after a document is unloaded and flushed. */
  async release(roomId: string): Promise<void> {
    await this.flush(roomId).catch(() => undefined);
    const r = this.rooms.get(roomId);
    if (r && r.updates.length === 0 && !r.timer) this.rooms.delete(roomId);
  }

  async flushAll(): Promise<void> {
    await Promise.allSettled([...this.rooms.keys()].map((id) => this.flush(id)));
  }

  async close(): Promise<void> {
    await this.flushAll();
    this.closed = true;
    for (const r of this.rooms.values()) if (r.timer) clearTimeout(r.timer);
  }
}
