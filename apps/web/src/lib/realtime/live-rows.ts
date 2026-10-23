"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { toast } from "sonner";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import type { Database } from "@/lib/supabase/database.types";

type TableName = keyof Database["public"]["Tables"];
type Row<T extends TableName> = Database["public"]["Tables"][T]["Row"];

export type LiveStatus = "loading" | "live" | "reconnecting" | "error";

interface Options<T extends TableName> {
  table: T;
  /** Postgres Changes filter, e.g. `board_id=eq.<uuid>`. */
  filter?: string;
  /** Full (re)load; used initially and after any reconnect to recover missed events. */
  load: () => Promise<Row<T>[]>;
  /** Return false to ignore an incoming row older than what we have. */
  isNewer?: (incoming: Row<T>, current: Row<T>) => boolean;
  enabled?: boolean;
  /** Server-rendered rows to show before the first client load. */
  initial?: Row<T>[];
}

function defaultIsNewer(incoming: Record<string, unknown>, current: Record<string, unknown>): boolean {
  if (typeof incoming.version === "number" && typeof current.version === "number") {
    return incoming.version >= current.version;
  }
  if (typeof incoming.updated_at === "string" && typeof current.updated_at === "string") {
    return incoming.updated_at >= current.updated_at;
  }
  return true;
}

/**
 * A collection of rows kept live with Supabase Postgres Changes.
 *
 * RLS is evaluated by Realtime for each event, so only rows the user can read
 * arrive. Persisted rows are the source of truth: whenever the channel
 * (re)subscribes, or the tab regains connectivity, we reload, so events missed
 * while disconnected are never lost.
 */
export function useLiveRows<T extends TableName>({ table, filter, load, isNewer, enabled = true, initial }: Options<T>) {
  const [rows, setRows] = useState<Row<T>[]>(initial ?? []);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  const newerRef = useRef(isNewer);
  // Bumped on every applied change so a slower, older reload can't overwrite it.
  const versionRef = useRef(0);
  const subscribedRef = useRef(false);
  const reloadRef = useRef<() => Promise<boolean>>(async () => false);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; delay: number; notified: boolean }>({
    timer: null,
    delay: 2_000,
    notified: false,
  });
  useEffect(() => {
    loadRef.current = load;
    newerRef.current = isNewer;
  });

  const reload = useCallback(async (): Promise<boolean> => {
    const startedAt = versionRef.current;
    const retry = retryRef.current;
    try {
      const data = await loadRef.current();
      if (versionRef.current === startedAt) setRows(data);
      setError(null);
      if (subscribedRef.current) setStatus("live");
      if (retry.timer) clearTimeout(retry.timer);
      retry.timer = null;
      retry.delay = 2_000;
      retry.notified = false;
      return true;
    } catch (err) {
      setError(errorMessage(err));
      setStatus("error");
      // Tell the user once (not on every retry), then keep retrying with backoff.
      if (!retry.notified) {
        retry.notified = true;
        toast.error(`Couldn't load the latest data. Retrying… (${errorMessage(err)})`, { id: `live-${table}` });
      }
      if (!retry.timer) {
        retry.timer = setTimeout(() => {
          retry.timer = null;
          void reloadRef.current();
        }, retry.delay);
        retry.delay = Math.min(retry.delay * 2, 30_000);
      }
      return false;
    }
  }, [table]);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const applyLocal: typeof setRows = useCallback((update) => {
    versionRef.current += 1;
    setRows(update);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let subscribedOnce = false;
    const removeById = (payload: RealtimePostgresChangesPayload<Row<T>>) => {
      const id = (payload.old as { id?: string }).id;
      if (!id) return;
      setRows((current) => {
        if (!current.some((r) => (r as { id?: string }).id === id)) return current;
        versionRef.current += 1;
        return current.filter((r) => (r as { id?: string }).id !== id);
      });
    };

    const channel = supabase
      .channel(`live:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<Row<T>>) => upsert(payload),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<Row<T>>) => upsert(payload),
      )
      // Supabase can't filter DELETE events (the old row only carries its key),
      // so listen unfiltered and drop the row only if we have it.
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, removeById)
      .subscribe((s) => {
        if (cancelled) return;
        if (s === "SUBSCRIBED") {
          subscribedRef.current = true;
          // Initial load happens after subscribing so no change can slip
          // between the snapshot and the stream.
          void reload();
          subscribedOnce = true;
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          subscribedRef.current = false;
          setStatus(subscribedOnce ? "reconnecting" : "loading");
        }
      });

    function upsert(payload: RealtimePostgresChangesPayload<Row<T>>) {
          setRows((current) => {
            const incoming = payload.new as Row<T>;
            const id = (incoming as { id?: string }).id;
            const idx = current.findIndex((r) => (r as { id?: string }).id === id);
            if (idx === -1) {
              versionRef.current += 1;
              return [...current, incoming];
            }
            const check = newerRef.current ?? (defaultIsNewer as unknown as (a: Row<T>, b: Row<T>) => boolean);
            if (!check(incoming, current[idx]!)) return current;
            versionRef.current += 1;
            const next = current.slice();
            next[idx] = incoming;
            return next;
          });
    }

    const onOnline = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const retry = retryRef.current;
    return () => {
      cancelled = true;
      subscribedRef.current = false;
      if (retry.timer) clearTimeout(retry.timer);
      retry.timer = null;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [table, filter, enabled, reload]);

  return { rows, setRows: applyLocal, status, error, reload };
}
