import type { PGlite } from "@electric-sql/pglite";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";
import { signCollabToken } from "@collabverse/shared/collab-token";
import type { Db, Queryable } from "../src/db";
import { createCollabServer, type CollabServer } from "../src/server";
import { silentLogger } from "../src/logger";
import type { TestUser } from "../../../supabase/tests/support/db";

export const SECRET = "test-secret-test-secret-test-secret-0123";

/**
 * Db adapter over PGlite that runs every statement as the least-privilege
 * `collab_server` role, proving the server needs nothing more.
 */
export function pgliteDb(pg: PGlite, opts: { failing?: () => boolean } = {}): Db {
  const run = async <T>(fn: (q: Queryable) => Promise<T>) => {
    if (opts.failing?.()) throw new Error("simulated database outage");
    return pg.transaction(async (tx) => {
      await tx.exec("set local role collab_server");
      return fn({
        async query<R>(sql: string, params: unknown[] = []) {
          const r = await tx.query<R>(sql, params);
          return { rows: r.rows };
        },
      });
    });
  };
  return {
    query: (sql, params) => run((q) => q.query(sql, params)),
    transaction: (fn) => run(fn),
    async ping() {
      return !opts.failing?.();
    },
    async close() {},
  };
}

export function startServer(
  db: Db,
  overrides: Partial<Parameters<typeof createCollabServer>[0]> = {},
): Promise<{ collab: CollabServer; url: string; port: number }> {
  const collab = createCollabServer(
    {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: SECRET,
      allowedOrigins: [],
      recheckIntervalMs: 60_000,
      flushIntervalMs: 20,
      compactThreshold: 50,
      maxPayloadBytes: 4 * 1024 * 1024,
      ...overrides,
    },
    db,
    silentLogger,
  );
  return collab.listen().then((port) => ({ collab, port, url: `ws://127.0.0.1:${port}` }));
}

export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  authFailures: string[];
  closes: string[];
  destroy(): void;
}

export function connectClient(
  url: string,
  room: string,
  user: TestUser,
  opts: { token?: () => Promise<string>; doc?: Y.Doc } = {},
): TestClient {
  const doc = opts.doc ?? new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url, delay: 50, minDelay: 50, maxDelay: 200, factor: 1.2 });
  const authFailures: string[] = [];
  const closes: string[] = [];
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: room,
    document: doc,
    token: opts.token ?? (() => signCollabToken({ userId: user.id, room, name: user.email }, SECRET)),
    onAuthenticationFailed: ({ reason }) => authFailures.push(reason),
    onClose: ({ event }) => closes.push(event.reason),
  });
  provider.attach();
  return {
    doc,
    provider,
    socket,
    authFailures,
    closes,
    destroy() {
      provider.destroy();
      socket.destroy();
    },
  };
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function roomId(pg: PGlite, name: string): Promise<string> {
  const r = await pg.query<{ id: string }>(`select id from collaboration_rooms where name = $1`, [name]);
  return r.rows[0]!.id;
}
