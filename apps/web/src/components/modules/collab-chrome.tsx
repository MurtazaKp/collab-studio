"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toastError } from "@/lib/notify-error";
import { CloudOff, Eye, Lock, RefreshCw } from "lucide-react";
import { MODULES } from "@collabverse/shared";
import type { CollabSession, CollabSessionState } from "@/lib/collab/types";
import { uniqueUsers, useCollaborators } from "@/lib/collab/react";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import { ITEM_TABLE, renameItem, type ItemModule, type ItemRow } from "@/lib/data/items";
import { Avatar } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ModuleIcon } from "@/components/ui/module-icon";
import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/utils";

/** Keep an item row (title etc.) live; reports deletion by someone else. */
export function useLiveItem(module: ItemModule, initial: ItemRow) {
  const table = ITEM_TABLE[module];
  const load = useCallback(async () => {
    const { data, error } = await getBrowserSupabase().from(table).select("*").eq("id", initial.id);
    if (error) throw error;
    return data as never;
  }, [table, initial.id]);
  const { rows } = useLiveRows({ table, filter: `id=eq.${initial.id}`, load, initial: [initial] as never });
  const item = (rows as unknown as ItemRow[])[0];
  return { item: item ?? initial, deleted: !item };
}

export function EditableTitle({ module, item, editable }: { module: ItemModule; item: ItemRow; editable: boolean }) {
  const [value, setValue] = useState(item.title);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setValue(item.title);
  }, [item.title, editing]);

  if (!editable) return <>{item.title}</>;

  const commit = async () => {
    setEditing(false);
    const next = value.trim();
    if (!next || next === item.title) {
      setValue(item.title);
      return;
    }
    try {
      await renameItem(getBrowserSupabase(), ITEM_TABLE[module], item.id, next);
    } catch (err) {
      toastError(err);
      setValue(item.title);
    }
  };

  return (
    <input
      ref={ref}
      value={value}
      aria-label="Title"
      maxLength={120}
      onFocus={() => setEditing(true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") ref.current?.blur();
        if (e.key === "Escape") {
          setValue(item.title);
          setEditing(false);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className="-mx-1 w-full min-w-0 rounded-md bg-transparent px-1 text-inherit outline-none hover:bg-surface-2 focus:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
      style={{ font: "inherit", letterSpacing: "inherit" }}
    />
  );
}

export function CollabStatus({ state, session }: { state: CollabSessionState; session: CollabSession | null }) {
  if (state.error?.code === "token-unavailable") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-warning" role="status">
        <RefreshCw className="size-3.5" /> Reconnecting…
      </span>
    );
  }
  if (state.error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-danger">
        <Lock className="size-3.5" /> No access
      </span>
    );
  }
  if (state.access === "readonly") {
    return (
      <Tooltip label="You have view-only access in this workspace">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-text-2">
          <Eye className="size-3.5" /> View only
        </span>
      </Tooltip>
    );
  }
  if (state.status !== "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-warning" role="status">
        <CloudOff className="size-3.5" />
        {state.status === "connecting" ? "Connecting…" : "Offline — edits will sync when you reconnect"}
        {state.status === "disconnected" && session ? (
          <button className="ml-1 underline" onClick={() => session.reconnect()}>
            Retry
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted" role="status" aria-live="polite">
      <span className={cn("size-1.5 rounded-full", state.unsyncedChanges > 0 ? "bg-warning" : "bg-success")} />
      {state.unsyncedChanges > 0 ? "Saving…" : "Saved"}
    </span>
  );
}

export function PresenceAvatars({ session }: { session: CollabSession | null }) {
  const people = uniqueUsers(useCollaborators(session?.awareness));
  if (!people.length) return null;
  return (
    <div className="flex items-center -space-x-1.5" aria-label={`${people.length} collaborator${people.length === 1 ? "" : "s"} here`}>
      {people.slice(0, 5).map((p) => (
        <Tooltip key={p.id} label={`${p.name} is here`}>
          <span>
            <Avatar name={p.name} color={p.color} size={26} ring />
          </span>
        </Tooltip>
      ))}
      {people.length > 5 ? <span className="pl-2.5 text-[12px] text-muted">+{people.length - 5}</span> : null}
    </div>
  );
}

export function CollabHeader({
  module,
  item,
  session,
  state,
  actions,
}: {
  module: ItemModule;
  item: ItemRow;
  session: CollabSession | null;
  state: CollabSessionState;
  actions?: React.ReactNode;
}) {
  const { workspace, href, canEdit } = useWorkspace();
  const def = MODULES[module];
  return (
    <PageHeader
      compact
      className="border-b border-border bg-surface"
      crumbs={[
        { label: workspace.name, href: href() },
        { label: def.label, href: href(def.segment) },
      ]}
      icon={<ModuleIcon type={module} tile />}
      title={<EditableTitle module={module} item={item} editable={canEdit && state.access !== "readonly"} />}
      actions={
        <>
          <CollabStatus state={state} session={session} />
          <PresenceAvatars session={session} />
          {actions}
        </>
      }
    />
  );
}

/** Blocking states shared by every collaborative surface. */
export function CollabGate({
  state,
  deleted,
  module,
  children,
}: {
  state: CollabSessionState;
  deleted: boolean;
  module: ItemModule;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { href } = useWorkspace();
  const def = MODULES[module];
  if (deleted) {
    return (
      <GateMessage title={`This ${def.itemNoun} was deleted`} body="Someone in the workspace deleted it.">
        <Button variant="outline" onClick={() => router.push(href(def.segment))}>
          Back to {def.label}
        </Button>
      </GateMessage>
    );
  }
  if (state.error?.code === "session-expired") {
    return (
      <GateMessage title="Your session has expired" body={state.error.message}>
        <Button variant="primary" onClick={() => router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`)}>
          Sign in again
        </Button>
      </GateMessage>
    );
  }
  if (state.error && state.error.code !== "token-unavailable") {
    return (
      <GateMessage title="You can't open this right now" body={state.error.message}>
        <Button variant="outline" onClick={() => router.push("/w")}>
          Go to your workspaces
        </Button>
      </GateMessage>
    );
  }
  if (!state.synced) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted">
        <Spinner className="size-5" />
        {state.error?.code === "token-unavailable" ? (
          <span className="flex items-center gap-1.5">
            <RefreshCw className="size-3.5" /> Couldn&apos;t verify your access. Retrying…
          </span>
        ) : state.status === "disconnected" ? (
          <span className="flex items-center gap-1.5">
            <RefreshCw className="size-3.5" /> Can&apos;t reach the collaboration server. Retrying…
          </span>
        ) : (
          <span>Loading the latest version…</span>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

function GateMessage({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-muted shadow-sm">
        <Lock className="size-5" />
      </div>
      <h2 className="font-display text-2xl text-text">{title}</h2>
      <p className="mt-1.5 max-w-sm text-[13.5px] text-muted">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
