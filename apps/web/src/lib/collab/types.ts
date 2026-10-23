import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

/**
 * Provider-neutral collaboration contract.
 *
 * Module components depend only on these types (via `useCollabRoom`). The
 * concrete transport (currently Hocuspocus, see ./hocuspocus.ts) can be
 * replaced without touching any module, as long as it:
 *   1. authenticates with a short-lived token from /api/collab/token,
 *   2. synchronises the room's Y.Doc and awareness,
 *   3. reports status/sync/errors through `CollabSessionState`,
 *   4. reconnects automatically and re-syncs (state-vector exchange),
 *   5. tears everything down on `release`/`destroy`.
 */

export type CollabStatus = "connecting" | "connected" | "disconnected";

/** What the server granted for this room. `unknown` until authenticated. */
export type CollabAccess = "read-write" | "readonly" | "unknown";

export type CollabErrorCode =
  | "forbidden"
  | "access-revoked"
  | "module-disabled"
  | "token-unavailable"
  | "session-expired"
  | "unknown";

export interface CollabError {
  code: CollabErrorCode;
  message: string;
}

export interface CollabUser {
  id: string;
  name: string;
  color: string;
}

export interface CollabSessionState {
  status: CollabStatus;
  /** True once the initial sync with the server finished. */
  synced: boolean;
  access: CollabAccess;
  /** Local updates not yet acknowledged by the server. */
  unsyncedChanges: number;
  /** Fatal errors stop the session; it will not reconnect by itself. */
  error: CollabError | null;
}

export interface CollabSession {
  readonly room: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  getState(): CollabSessionState;
  subscribe(listener: (state: CollabSessionState) => void): () => void;
  /** Tear down the transport and connect again with a fresh token. */
  reconnect(): void;
}

export interface CollaborationProvider {
  /** Join a room (reference counted; joining the same room shares the session). */
  join(room: string, user: CollabUser): CollabSession;
  /** Release a reference obtained from `join`. */
  release(session: CollabSession): void;
  /** Close every session and the underlying connection. */
  destroy(): void;
}

/** Remote presence entry derived from awareness. */
export interface Collaborator {
  clientId: number;
  user: CollabUser;
  /** Module-specific cursor payload (canvas coordinates, selection, ...). */
  cursor?: unknown;
}
