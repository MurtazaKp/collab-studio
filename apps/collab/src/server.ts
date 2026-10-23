import { Server, type Connection, type Document } from "@hocuspocus/server";
import * as Y from "yjs";
import { isRole, parseRoomName, type Role, type RoomKind } from "@collabverse/shared";
import { verifyCollabToken } from "@collabverse/shared/collab-token";
import { seedMindmap } from "@collabverse/shared/mindmap";
import { seedCodeProject } from "@collabverse/shared/code";
import type { CollabConfig } from "./config";
import type { Db } from "./db";
import type { Logger } from "./logger";
import { YjsPersistence } from "./persistence";
import { derivePreview } from "./preview";

export interface ConnectionContext {
  userId: string;
  roomId: string;
  workspaceId: string;
  role: Role;
  kind: RoomKind;
  displayName?: string;
}

interface RoomAccess {
  room_id: string;
  workspace_id: string;
  kind: RoomKind;
  entity_id: string;
  title: string;
  role: string;
  module_enabled: boolean;
}

/** Close reasons understood by the web client's collaboration adapter. */
export const CloseReason = {
  revoked: "access-revoked",
  roleChanged: "role-changed",
  shutdown: "server-shutdown",
} as const;

class AuthError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export interface CollabServer {
  server: Server<ConnectionContext>;
  persistence: YjsPersistence;
  listen(): Promise<number>;
  revalidateAll(): Promise<void>;
  stop(): Promise<void>;
}

export function createCollabServer(
  config: Pick<
    CollabConfig,
    "port" | "host" | "jwtSecret" | "allowedOrigins" | "recheckIntervalMs" | "flushIntervalMs" | "compactThreshold" | "maxPayloadBytes"
  >,
  db: Db,
  log: Logger,
): CollabServer {
  const persistence = new YjsPersistence(db, log, {
    flushIntervalMs: config.flushIntervalMs,
    compactThreshold: config.compactThreshold,
  });
  const roomIds = new Map<string, { roomId: string; kind: RoomKind }>();
  const lastEditor = new Map<string, string>();
  const startedAt = Date.now();
  let recheckTimer: NodeJS.Timeout | null = null;
  let stopping = false;

  async function roomAccess(roomName: string, userId: string): Promise<RoomAccess | null> {
    const r = await db.query<RoomAccess>(`select * from collab.room_access($1, $2)`, [roomName, userId]);
    return r.rows[0] ?? null;
  }

  async function savePreview(documentName: string, document: Document): Promise<void> {
    const info = roomIds.get(documentName);
    if (!info) return;
    try {
      const preview = derivePreview(info.kind, document);
      await db.query(`select collab.save_preview($1, $2, $3)`, [info.roomId, preview, lastEditor.get(documentName) ?? null]);
    } catch (err) {
      log.warn("failed to save preview", { room: documentName, err });
    }
  }

  const server = new Server<ConnectionContext>({
    name: "collabverse-collab",
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: false,
    debounce: 2_000,
    maxDebounce: 10_000,
    timeout: 30_000,
    websocketOptions: { maxPayload: config.maxPayloadBytes },

    async onRequest({ request, response }) {
      const url = request.url ?? "/";
      if (url === "/health" || url === "/healthz") {
        const dbOk = await db.ping();
        const body = {
          status: dbOk && !stopping ? "ok" : "degraded",
          db: dbOk ? "ok" : "unreachable",
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          documents: server.hocuspocus.getDocumentsCount(),
          connections: server.hocuspocus.getConnectionsCount(),
          pendingUpdates: persistence.pendingUpdates(),
        };
        response.writeHead(dbOk ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(body));
        throw null; // handled; stop Hocuspocus' default response
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      throw null;
    },

    async onUpgrade({ request, socket }) {
      const origin = request.headers.origin;
      if (config.allowedOrigins.length > 0 && (!origin || !config.allowedOrigins.includes(origin))) {
        log.warn("rejected websocket upgrade from disallowed origin", { origin: origin ?? null });
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        throw null;
      }
    },

    async onAuthenticate({ token, documentName, connectionConfig }) {
      if (!parseRoomName(documentName)) throw new AuthError("invalid-room");
      if (!token) throw new AuthError("missing-token");
      const verified = await verifyCollabToken(token, documentName, config.jwtSecret);
      if (!verified.ok) {
        log.info("rejected collaboration token", { room: documentName, reason: verified.reason });
        throw new AuthError(verified.reason === "expired" ? "token-expired" : "invalid-token");
      }
      // Never trust the token alone: membership is re-derived from the database.
      const access = await roomAccess(documentName, verified.claims.userId);
      if (!access || !isRole(access.role)) {
        log.info("denied room access", { room: documentName, userId: verified.claims.userId });
        throw new AuthError("forbidden");
      }
      if (!access.module_enabled) throw new AuthError("module-disabled");
      connectionConfig.readOnly = access.role === "viewer";
      const context: ConnectionContext = {
        userId: verified.claims.userId,
        roomId: access.room_id,
        workspaceId: access.workspace_id,
        role: access.role,
        kind: access.kind,
        displayName: verified.claims.name,
      };
      log.debug("authenticated", { room: documentName, userId: context.userId, role: context.role });
      return context;
    },

    async onLoadDocument({ document, documentName, context }) {
      const ctx = context as ConnectionContext;
      roomIds.set(documentName, { roomId: ctx.roomId, kind: ctx.kind });
      const { state, rows } = await persistence.load(ctx.roomId);
      if (state) {
        Y.applyUpdate(document, state);
        log.info("loaded room", { room: documentName, logRows: rows, bytes: state.byteLength });
        return;
      }
      // First open: seed server-side so concurrent first visitors cannot race.
      const access = await roomAccess(documentName, ctx.userId);
      const title = access?.title ?? "";
      if (ctx.kind === "mindmap") seedMindmap(document, title);
      if (ctx.kind === "code") seedCodeProject(document);
      const seeded = Y.encodeStateAsUpdate(document);
      if (seeded.byteLength > 2) await persistence.appendNow(ctx.roomId, seeded);
      log.info("created room", { room: documentName });
    },

    async onChange({ documentName, update, context }) {
      const info = roomIds.get(documentName);
      if (!info) {
        log.error("change for unknown room", { room: documentName });
        return;
      }
      persistence.enqueue(info.roomId, update);
      const userId = (context as Partial<ConnectionContext> | undefined)?.userId;
      if (userId) lastEditor.set(documentName, userId);
    },

    async onStoreDocument({ documentName, document }) {
      const info = roomIds.get(documentName);
      if (!info) return;
      await persistence.store(info.roomId);
      await savePreview(documentName, document);
    },

    async afterUnloadDocument({ documentName }) {
      const info = roomIds.get(documentName);
      if (info) await persistence.release(info.roomId);
      roomIds.delete(documentName);
      lastEditor.delete(documentName);
    },
  });

  /**
   * Re-authorize every open session. Removed members (or disabled modules) are
   * disconnected; role changes force a reconnect so the new scope applies.
   */
  async function revalidateAll(): Promise<void> {
    const checks: Promise<void>[] = [];
    for (const [documentName, document] of server.hocuspocus.documents) {
      const connections = document.getConnections() as Connection<ConnectionContext>[];
      const byUser = new Map<string, Connection<ConnectionContext>[]>();
      for (const c of connections) {
        const uid = c.context?.userId;
        if (!uid) continue;
        byUser.set(uid, [...(byUser.get(uid) ?? []), c]);
      }
      for (const [userId, conns] of byUser) {
        checks.push(
          (async () => {
            let access: RoomAccess | null;
            try {
              access = await roomAccess(documentName, userId);
            } catch (err) {
              // Fail open only for transient DB errors on already-authorized
              // sessions; the next pass re-checks.
              log.warn("revalidation query failed", { room: documentName, err });
              return;
            }
            for (const c of conns) {
              if (!access || !access.module_enabled) {
                log.info("revoking session", { room: documentName, userId });
                c.close({ code: 4403, reason: CloseReason.revoked });
              } else if (access.role !== c.context.role) {
                log.info("role changed; forcing reconnect", { room: documentName, userId, role: access.role });
                c.close({ code: 4409, reason: CloseReason.roleChanged });
              }
            }
          })(),
        );
      }
    }
    await Promise.all(checks);
  }

  return {
    server,
    persistence,
    async listen() {
      await server.listen();
      recheckTimer = setInterval(() => {
        revalidateAll().catch((err) => log.error("revalidation failed", { err }));
      }, config.recheckIntervalMs);
      recheckTimer.unref();
      const port = server.address.port;
      log.info("collaboration server listening", { port });
      return port;
    },
    revalidateAll,
    async stop() {
      stopping = true;
      if (recheckTimer) clearInterval(recheckTimer);
      // Persist everything still buffered before connections drop.
      server.hocuspocus.flushPendingStores();
      await persistence.flushAll();
      await server.destroy();
      await persistence.close();
      log.info("collaboration server stopped");
    },
  };
}
