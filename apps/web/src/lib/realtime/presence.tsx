"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/client";

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  /** Path segment the user is looking at, e.g. "kanban/<id>". */
  location: string;
  onlineAt: string;
}

interface TypingEvent {
  userId: string;
  name: string;
  channelId: string;
}

interface PresenceContextValue {
  online: PresenceUser[];
  setLocation(location: string): void;
  sendTyping(channelId: string): void;
  subscribeTyping(cb: (e: TypingEvent) => void): () => void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * Workspace-wide presence and typing indicators over a *private* Realtime
 * channel (`ws:<workspaceId>`). Join/broadcast authorization is enforced by
 * RLS policies on realtime.messages, so only members can listen or speak.
 */
export function WorkspacePresenceProvider({
  workspaceId,
  me,
  children,
}: {
  workspaceId: string;
  me: { id: string; name: string; color: string };
  children: ReactNode;
}) {
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const locationRef = useRef("dashboard");
  const typingListeners = useRef(new Set<(e: TypingEvent) => void>());
  const lastTypingSent = useRef(0);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    const start = async () => {
      // Private channels need the user's JWT on the realtime socket.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase.channel(`ws:${workspaceId}`, {
        config: { private: true, presence: { key: me.id } },
      });
      channelRef.current = channel;
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState<PresenceUser>();
          const byUser = new Map<string, PresenceUser>();
          for (const metas of Object.values(state)) {
            for (const m of metas) {
              const prev = byUser.get(m.userId);
              if (!prev || prev.onlineAt < m.onlineAt) byUser.set(m.userId, m);
            }
          }
          setOnline([...byUser.values()]);
        })
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          const e = payload as TypingEvent;
          if (e.userId === me.id) return;
          for (const l of typingListeners.current) l(e);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await channel!.track({
              userId: me.id,
              name: me.name,
              color: me.color,
              location: locationRef.current,
              onlineAt: new Date().toISOString(),
            } satisfies PresenceUser);
          }
        });
    };
    void start();
    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [workspaceId, me.id, me.name, me.color]);

  const setLocation = useCallback(
    (location: string) => {
      locationRef.current = location;
      void channelRef.current?.track({
        userId: me.id,
        name: me.name,
        color: me.color,
        location,
        onlineAt: new Date().toISOString(),
      } satisfies PresenceUser);
    },
    [me.id, me.name, me.color],
  );

  const sendTyping = useCallback(
    (channelId: string) => {
      const now = Date.now();
      if (now - lastTypingSent.current < 2000) return;
      lastTypingSent.current = now;
      void channelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: me.id, name: me.name, channelId } satisfies TypingEvent,
      });
    },
    [me.id, me.name],
  );

  const subscribeTyping = useCallback((cb: (e: TypingEvent) => void) => {
    typingListeners.current.add(cb);
    return () => {
      typingListeners.current.delete(cb);
    };
  }, []);

  const value = useMemo(
    () => ({ online, setLocation, sendTyping, subscribeTyping }),
    [online, setLocation, sendTyping, subscribeTyping],
  );
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used inside <WorkspacePresenceProvider>");
  return ctx;
}

/** Report where the user is, for "who's here" indicators. */
export function usePresenceLocation(location: string) {
  const { setLocation } = usePresence();
  useEffect(() => {
    setLocation(location);
    return () => setLocation("dashboard");
  }, [location, setLocation]);
}

/** Names of people currently typing in a chat channel. */
export function useTypingIndicator(channelId: string): string[] {
  const { subscribeTyping } = usePresence();
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  useEffect(() => {
    const unsub = subscribeTyping((e) => {
      if (e.channelId !== channelId) return;
      setTypers((t) => ({ ...t, [e.userId]: { name: e.name, until: Date.now() + 3500 } }));
    });
    const timer = setInterval(() => {
      setTypers((t) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(t).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [channelId, subscribeTyping]);
  return Object.values(typers).map((t) => t.name);
}
