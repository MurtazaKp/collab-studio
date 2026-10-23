"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type {
  CollabError,
  CollabSession,
  CollabSessionState,
  CollabUser,
  CollaborationProvider,
} from "./types";

/** Server close/denial reasons (see apps/collab/src/server.ts). */
const FATAL: Record<string, CollabError> = {
  forbidden: { code: "forbidden", message: "You don't have access to this item." },
  "access-revoked": { code: "access-revoked", message: "Your access to this workspace was removed." },
  "module-disabled": { code: "module-disabled", message: "This module was disabled by an admin." },
  "invalid-room": { code: "forbidden", message: "This item doesn't exist." },
  "invalid-token": { code: "forbidden", message: "Your access couldn't be verified. Refresh the page to try again." },
  "missing-token": { code: "forbidden", message: "You don't have access to this item." },
};

const SESSION_EXPIRED: CollabError = {
  code: "session-expired",
  message: "Your session has expired. Sign in again to keep editing.",
};

/** The web session is gone (401): retrying won't help until the user signs in. */
export class SessionExpiredError extends Error {}

export type TokenFetcher = (room: string) => Promise<string>;

export async function fetchCollabToken(room: string): Promise<string> {
  const res = await fetch("/api/collab/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room }),
    cache: "no-store",
  });
  if (res.status === 401) throw new SessionExpiredError("session expired");
  if (res.status === 403 || res.status === 404) {
    // An empty token makes the server deny with a clear reason.
    return "";
  }
  if (!res.ok) throw new Error(`token request failed (${res.status})`);
  const body = (await res.json()) as { token?: string };
  return body.token ?? "";
}

function toStatus(status: WebSocketStatus): CollabSessionState["status"] {
  return status === WebSocketStatus.Connected ? "connected" : status === WebSocketStatus.Connecting ? "connecting" : "disconnected";
}

/**
 * One room. The session owns exactly one HocuspocusProvider for its whole
 * life: re-authentication (expired token, role change, manual retry) is a
 * detach + attach, which re-sends a fresh token and re-syncs while editor
 * bindings keep the same doc and awareness. The provider is destroyed only when
 * the session ends or access is permanently denied — destroying it also stops
 * it from sending updates/cursors for a room it may no longer use.
 */
class HocuspocusSession implements CollabSession {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  private readonly provider: HocuspocusProvider;
  private listeners = new Set<(s: CollabSessionState) => void>();
  private state: CollabSessionState;
  private expiredRetries = 0;
  private tokenFetchFailed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2_000;
  stopped = false;
  refs = 0;
  releaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly room: string,
    private readonly socket: HocuspocusProviderWebsocket,
    getToken: TokenFetcher,
    user: CollabUser,
  ) {
    // The provider only reports status *changes*; seed from the shared socket.
    this.state = { status: toStatus(socket.status), synced: false, access: "unknown", unsyncedChanges: 0, error: null };
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalStateField("user", user);
    this.provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: room,
      document: this.doc,
      awareness: this.awareness,
      token: async () => {
        try {
          const token = await getToken(room);
          this.tokenFetchFailed = false;
          return token;
        } catch (err) {
          if (err instanceof SessionExpiredError) {
            this.fail(SESSION_EXPIRED);
            return "";
          }
          this.tokenFetchFailed = true;
          this.set({ error: { code: "token-unavailable", message: "Couldn't authorise the connection. Retrying…" } });
          return "";
        }
      },
      onStatus: ({ status }) => this.set({ status: toStatus(status) }),
      onAuthenticated: ({ scope }) => {
        this.expiredRetries = 0;
        this.retryDelay = 2_000;
        this.set({ access: scope === "readonly" ? "readonly" : "read-write", error: null });
      },
      onAuthenticationFailed: ({ reason }) => {
        if (reason === "token-expired" && this.expiredRetries < 3) {
          this.expiredRetries += 1;
          this.reconnect();
        } else if (this.stopped) {
          // Already failed (e.g. session expired) while fetching the token.
        } else if (this.tokenFetchFailed) {
          // We couldn't get a token (offline, server hiccup): not a denial.
          this.scheduleRetry();
        } else {
          this.fail(FATAL[reason] ?? { code: "forbidden", message: "Access denied." });
        }
      },
      onSynced: ({ state }) => this.set({ synced: state }),
      onUnsyncedChanges: ({ number }) => this.set({ unsyncedChanges: number }),
      onClose: ({ event }) => {
        if (event.reason === "role-changed") {
          // Re-authenticate with a fresh token so the new scope applies.
          this.reconnect();
        } else if (event.reason in FATAL) {
          this.fail(FATAL[event.reason]!);
        }
      },
    });
    this.provider.attach();
  }

  private set(patch: Partial<CollabSessionState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private scheduleRetry() {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.reconnect();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  /** Permanent denial: show the error and stop talking to the server. */
  private fail(error: CollabError) {
    this.set({ error, access: "readonly" });
    this.stop();
  }

  private stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    // Defer: we may be inside the provider's own message handler.
    setTimeout(() => this.provider.destroy(), 0);
  }

  getState() {
    return this.state;
  }

  subscribe(listener: (s: CollabSessionState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reconnect() {
    if (this.stopped) return;
    this.provider.detach();
    // Reset so the provider emits `synced` again after the next handshake.
    this.provider.synced = false;
    // Keep `synced` so open editors stay mounted; access is unknown (read-only)
    // until the server confirms the scope again.
    this.set({ status: toStatus(this.socket.status), access: "unknown", error: null });
    this.provider.attach();
  }

  destroy() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (!this.stopped) {
      this.stopped = true;
      this.provider.destroy(); // also destroys the awareness it was given
    }
    this.doc.destroy();
    this.listeners.clear();
  }
}

/**
 * Hocuspocus implementation of the collaboration contract. All rooms share a
 * single multiplexed WebSocket.
 */
export function createHocuspocusCollaboration(url: string, getToken: TokenFetcher = fetchCollabToken): CollaborationProvider {
  // The provider's retry library rejects any config where delay < minDelay
  // (default minDelay is 1000) and then never connects, so set both.
  // The first attempt is immediate (initialDelay 0); retries back off with jitter.
  const socket = new HocuspocusProviderWebsocket({ url, delay: 1_000, minDelay: 250, maxDelay: 10_000, factor: 2, jitter: true });
  const sessions = new Map<string, HocuspocusSession>();

  return {
    join(room, user) {
      let s = sessions.get(room);
      if (s && s.stopped && s.refs <= 0) {
        // A previously denied room: try again (access may have been granted since).
        if (s.releaseTimer) clearTimeout(s.releaseTimer);
        s.destroy();
        s = undefined;
      }
      if (!s) {
        s = new HocuspocusSession(room, socket, getToken, user);
        sessions.set(room, s);
      }
      if (s.releaseTimer) {
        clearTimeout(s.releaseTimer);
        s.releaseTimer = null;
      }
      s.refs += 1;
      return s;
    },
    release(session) {
      const s = sessions.get(session.room);
      if (!s) return;
      s.refs -= 1;
      if (s.refs <= 0 && !s.releaseTimer) {
        // Grace period avoids reconnect churn on quick navigations/remounts.
        s.releaseTimer = setTimeout(() => {
          if (s.refs <= 0) {
            s.destroy();
            sessions.delete(s.room);
          }
        }, 1500);
      }
    },
    destroy() {
      for (const s of sessions.values()) s.destroy();
      sessions.clear();
      socket.destroy();
    },
  };
}
