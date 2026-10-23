"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Awareness } from "y-protocols/awareness";
import { publicEnv } from "@/lib/env";
import { createHocuspocusCollaboration } from "./hocuspocus";
import type { CollabSession, CollabSessionState, CollabUser, Collaborator, CollaborationProvider } from "./types";

interface CollabContextValue {
  provider: CollaborationProvider | null;
  user: CollabUser;
}

const CollabContext = createContext<CollabContextValue | null>(null);

/**
 * Owns the collaboration provider for a signed-in workspace session. Swapping
 * the transport means changing only the factory used here.
 */
export function CollabRoot({ user, children }: { user: CollabUser; children: ReactNode }) {
  const [provider, setProvider] = useState<CollaborationProvider | null>(null);

  useEffect(() => {
    const p = createHocuspocusCollaboration(publicEnv.collabUrl);
    setProvider(p);
    return () => p.destroy();
  }, []);

  const value = useMemo(() => ({ provider, user }), [provider, user]);
  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}

const INITIAL: CollabSessionState = {
  status: "connecting",
  synced: false,
  access: "unknown",
  unsyncedChanges: 0,
  error: null,
};

/** Join a collaboration room for the lifetime of the calling component. */
export function useCollabRoom(room: string | null): { session: CollabSession | null; state: CollabSessionState } {
  const ctx = useContext(CollabContext);
  if (!ctx) throw new Error("useCollabRoom must be used inside <CollabRoot>");
  const { provider, user } = ctx;
  const [session, setSession] = useState<CollabSession | null>(null);

  useEffect(() => {
    if (!provider || !room) return;
    const s = provider.join(room, user);
    setSession(s);
    return () => {
      provider.release(s);
      setSession(null);
    };
    // The user identity is fixed for the lifetime of the root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, room]);

  const state = useSyncExternalStore(
    (cb) => (session ? session.subscribe(cb) : () => {}),
    () => (session ? session.getState() : INITIAL),
    () => INITIAL,
  );
  return { session, state };
}

export function useCollabUser(): CollabUser {
  const ctx = useContext(CollabContext);
  if (!ctx) throw new Error("useCollabUser must be used inside <CollabRoot>");
  return ctx.user;
}

/** Remote collaborators currently in the room (excluding this client). */
export function useCollaborators(awareness: Awareness | null | undefined): Collaborator[] {
  const [list, setList] = useState<Collaborator[]>([]);
  useEffect(() => {
    if (!awareness) return;
    const read = () => {
      const out: Collaborator[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = (state as { user?: CollabUser }).user;
        if (user && typeof user.id === "string") out.push({ clientId, user, cursor: (state as { cursor?: unknown }).cursor });
      });
      setList(out);
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);
  return list;
}

/** Distinct people (one entry per user id) for avatar stacks. */
export function uniqueUsers(collaborators: Collaborator[]): CollabUser[] {
  const seen = new Map<string, CollabUser>();
  for (const c of collaborators) if (!seen.has(c.user.id)) seen.set(c.user.id, c.user);
  return [...seen.values()];
}
