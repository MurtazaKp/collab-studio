"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { loadMessages, loadMessagesSince, loadReactions, type Message, type Reaction } from "@/lib/data/chat";

/** Prefer whichever copy reflects more changes (edits, deletion, replies). */
function newerMessage(a: Message, b: Message): Message {
  if (Boolean(a.deleted_at) !== Boolean(b.deleted_at)) return a.deleted_at ? a : b;
  if ((a.edited_at ?? "") !== (b.edited_at ?? "")) return (a.edited_at ?? "") > (b.edited_at ?? "") ? a : b;
  return a.reply_count >= b.reply_count ? a : b;
}

const reactionKey = (r: Pick<Reaction, "message_id" | "user_id" | "emoji">) => `${r.message_id}|${r.user_id}|${r.emoji}`;

function mergeReactions(cur: Reaction[], add: Reaction[]): Reaction[] {
  const seen = new Set(cur.map(reactionKey));
  return [...cur, ...add.filter((r) => !seen.has(reactionKey(r)))];
}

export function compareMessages(a: Message, b: Message): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
}

/**
 * Persisted channel history plus live updates. Postgres is the source of
 * truth: after any (re)subscription we fetch everything newer than the oldest
 * loaded message, so messages sent while we were offline always appear.
 */
export function useChannelMessages(channelId: string, workspaceId: string, initial: Message[], initialHasMore: boolean) {
  const sb = getBrowserSupabase();
  const [messages, setMessages] = useState<Map<string, Message>>(() => new Map(initial.map((m) => [m.id, m])));
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [status, setStatus] = useState<"live" | "connecting" | "reconnecting">("connecting");
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const upsert = useCallback((list: Message[]) => {
    if (!list.length) return;
    setMessages((cur) => {
      const next = new Map(cur);
      for (const m of list) {
        const existing = next.get(m.id);
        next.set(m.id, existing ? newerMessage(m, existing) : m);
      }
      return next;
    });
  }, []);

  const catchUp = useCallback(async () => {
    try {
      const all = [...messagesRef.current.values()].filter((m) => !m.parent_id).sort(compareMessages);
      const since = all[0]?.created_at ?? new Date(Date.now() - 7 * 86400_000).toISOString();
      // Page through everything since the oldest loaded message.
      const fresh: Message[] = [];
      let cursor = since;
      for (let page = 0; page < 20; page++) {
        const batch = await loadMessagesSince(sb, channelId, cursor);
        fresh.push(...batch);
        if (batch.length < 500) break;
        cursor = batch[batch.length - 1]!.created_at;
      }
      const freshIds = new Set(fresh.map((m) => m.id));
      upsert(fresh);
      // Anything we hold in that range that the server no longer has was deleted while we were away.
      setMessages((cur) => {
        let changed = false;
        const next = new Map(cur);
        for (const [id, m] of cur) {
          if (m.created_at >= since && !freshIds.has(id)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : cur;
      });
      setReactions(await loadReactions(sb, [...freshIds, ...messagesRef.current.keys()]));
      setStatus("live");
    } catch (err) {
      setStatus("reconnecting");
      toast.error(`Couldn't load new messages. ${errorMessage(err)}`, { id: `chat-catchup-${channelId}` });
    }
  }, [sb, channelId, upsert]);

  useEffect(() => {
    let first = true;
    const channel = sb
      .channel(`chat:${channelId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, (p) =>
        upsert([p.new as Message]),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, (p) =>
        upsert([p.new as Message]),
      )
      // DELETE events can't be filtered; drop the message only if we hold it.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (!id) return;
        setMessages((cur) => {
          if (!cur.has(id)) return cur;
          const next = new Map(cur);
          next.delete(id);
          return next;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions", filter: `workspace_id=eq.${workspaceId}` }, (p) =>
        setReactions((cur) => mergeReactions(cur, [p.new as Reaction])),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (p) => {
        const o = p.old as Partial<Reaction>;
        setReactions((cur) => cur.filter((x) => !(x.message_id === o.message_id && x.user_id === o.user_id && x.emoji === o.emoji)));
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") {
          void catchUp();
          first = false;
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          setStatus(first ? "connecting" : "reconnecting");
        }
      });
    const onOnline = () => void catchUp();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      void sb.removeChannel(channel);
    };
  }, [sb, channelId, workspaceId, upsert, catchUp]);

  const loadOlder = useCallback(async () => {
    const oldest = [...messagesRef.current.values()].filter((m) => !m.parent_id).sort(compareMessages)[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const older = await loadMessages(sb, channelId, { created_at: oldest.created_at, id: oldest.id });
      upsert(older);
      setHasMore(older.length > 0 && older.length >= 40);
      const rx = await loadReactions(sb, older.map((m) => m.id));
      setReactions((cur) => mergeReactions(cur, rx));
    } catch (err) {
      toast.error(`Couldn't load earlier messages. ${errorMessage(err)}`);
    } finally {
      setLoadingOlder(false);
    }
  }, [sb, channelId, upsert]);

  return { messages, upsert, setMessages, reactions, setReactions, hasMore, loadOlder, loadingOlder, status };
}
