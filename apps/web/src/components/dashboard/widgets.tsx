"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toastError } from "@/lib/notify-error";
import { Check, Hash } from "lucide-react";
import { roomName, sortByPosition } from "@collabverse/shared";
import { objectsMap, readWhiteboard, type WbObject } from "@collabverse/shared/whiteboard";
import { nodesMap, normalizeMindmap, readMindmap } from "@collabverse/shared/mindmap";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { useCollabRoom } from "@/lib/collab/react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { ITEM_TABLE, listItems, type ItemModule, type ItemRow } from "@/lib/data/items";
import { loadColumns, loadTasks } from "@/lib/data/kanban";
import { listChannels, loadMessages, type Channel } from "@/lib/data/chat";
import { hostOf, loadPlaylistItems, loadShoppingItems, updateShoppingItem } from "@/lib/data/lists";
import { Avatar } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/spinner";
import { cn, colorVar, timeAgo } from "@/lib/utils";
import { WidgetEmpty, WidgetFrame, type WidgetControls } from "./widget-frame";

export interface WidgetProps {
  controls: WidgetControls;
  items: ItemRow[];
  pinnedId: string | null;
  onPin: (id: string | null) => void;
}

/** Items of a module kept live, so the dashboard reflects renames/creates/deletes. */
function useModuleItems(module: ItemModule, initial: ItemRow[]) {
  const { workspace } = useWorkspace();
  const table = ITEM_TABLE[module];
  const load = useCallback(() => listItems(getBrowserSupabase(), table, workspace.id, 12), [table, workspace.id]);
  const { rows } = useLiveRows({ table, filter: `workspace_id=eq.${workspace.id}`, load: load as never, initial: initial as never });
  return useMemo(
    () =>
      [...(rows as unknown as ItemRow[])].sort((a, b) => ((b.content_updated_at ?? b.updated_at) > (a.content_updated_at ?? a.updated_at) ? 1 : -1)),
    [rows],
  );
}

function focusItem(items: ItemRow[], pinnedId: string | null): ItemRow | undefined {
  return items.find((i) => i.id === pinnedId) ?? items[0];
}

function CreateLink({ module, label }: { module: ItemModule; label: string }) {
  const { href, canEdit } = useWorkspace();
  const seg = { docs: "docs", whiteboard: "whiteboard", mindmap: "mindmap", code: "code", kanban: "kanban", playlist: "playlists", shopping: "shopping" }[module];
  return canEdit ? (
    <Link href={href(seg)} className="text-[12.5px] font-medium text-accent hover:underline">
      {label}
    </Link>
  ) : null;
}

// ---------------------------------------------------------------- Docs

export function DocsWidget({ controls, items: initial }: WidgetProps) {
  const { href, member } = useWorkspace();
  const items = useModuleItems("docs", initial);
  return (
    <WidgetFrame type="docs" href={href("docs")} controls={controls}>
      {items.length === 0 ? (
        <WidgetEmpty action={<CreateLink module="docs" label="Write the first document" />}>No documents yet.</WidgetEmpty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.slice(0, controls.size === "sm" ? 3 : 4).map((d) => {
            const by = member(d.last_edited_by ?? d.created_by);
            return (
              <li key={d.id}>
                <Link href={href(`docs/${d.id}`)} className="-mx-2 block rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2">
                  <p className="truncate text-[13.5px] font-medium text-text">{d.title}</p>
                  {controls.size !== "sm" && d.preview_text ? <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted">{d.preview_text}</p> : null}
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {by ? `${by.name} · ` : ""}
                    {timeAgo(d.content_updated_at ?? d.updated_at)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Whiteboard (live miniature)

const MINI_FILL: Record<string, string> = { yellow: "#fde68a", pink: "#fbcfe8", blue: "#bfdbfe", green: "#bbf7d0", purple: "#ddd6fe", ink: "#3f3f46", white: "#f4f4f5" };

function useYjsMap<T>(room: string | null, read: (doc: import("yjs").Doc) => T, mapName: "objects" | "nodes", empty: T) {
  const { session, state } = useCollabRoom(room);
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    if (!session) return;
    const map = mapName === "objects" ? objectsMap(session.doc) : nodesMap(session.doc);
    const update = () => setValue(read(session.doc));
    update();
    map.observeDeep(update);
    return () => map.unobserveDeep(update);
  }, [session, read, mapName]);
  return { value, state };
}

export function WhiteboardWidget({ controls, items: initial, pinnedId, onPin }: WidgetProps) {
  const { href } = useWorkspace();
  const items = useModuleItems("whiteboard", initial);
  const focus = focusItem(items, pinnedId);
  const { value: objects, state } = useYjsMap<WbObject[]>(focus ? roomName("whiteboard", focus.id) : null, readWhiteboard, "objects", []);
  const shapes = objects.filter((o) => o.type !== "connector");
  const box = useMemo(() => {
    if (!shapes.length) return { x: 0, y: 0, w: 400, h: 240 };
    const minX = Math.min(...shapes.map((o) => o.x));
    const minY = Math.min(...shapes.map((o) => o.y));
    const maxX = Math.max(...shapes.map((o) => o.x + o.w));
    const maxY = Math.max(...shapes.map((o) => o.y + o.h));
    return { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
  }, [shapes]);
  const byId = new Map(objects.map((o) => [o.id, o]));

  return (
    <WidgetFrame type="whiteboard" title={focus?.title} href={focus ? href(`whiteboard/${focus.id}`) : href("whiteboard")} controls={controls} items={items} pinnedId={pinnedId} onPin={onPin}>
      {!focus ? (
        <WidgetEmpty action={<CreateLink module="whiteboard" label="Start a board" />}>No whiteboards yet.</WidgetEmpty>
      ) : (
        <Link href={href(`whiteboard/${focus.id}`)} className="relative block h-full min-h-40 overflow-hidden rounded-xl border border-border bg-bg" aria-label={`Open ${focus.title}`}>
          {!state.synced ? (
            <span className="absolute inset-0 flex items-center justify-center text-muted">
              {state.error ? <span className="text-[12.5px]">{state.error.message}</span> : <Spinner />}
            </span>
          ) : shapes.length === 0 ? (
            <span className="absolute inset-0 flex items-center justify-center text-[12.5px] text-muted">Empty board</span>
          ) : (
            <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
              {objects.map((o) => {
                if (o.type === "connector") {
                  const a = byId.get(o.from!);
                  const b = byId.get(o.to!);
                  if (!a || !b) return null;
                  return <line key={o.id} x1={a.x + a.w / 2} y1={a.y + a.h / 2} x2={b.x + b.w / 2} y2={b.y + b.h / 2} stroke="#71717a" strokeWidth={3} />;
                }
                if (o.type === "ellipse") return <ellipse key={o.id} cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={MINI_FILL[o.color]} stroke="#52525b" strokeWidth={2} />;
                if (o.type === "path") return <rect key={o.id} x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#52525b" strokeWidth={3} strokeDasharray="2 6" rx={6} />;
                if (o.type === "text")
                  return (
                    <text key={o.id} x={o.x + 8} y={o.y + o.h / 2 + 6} fontSize={20} fill="var(--text)">
                      {o.text.slice(0, 30)}
                    </text>
                  );
                return <rect key={o.id} x={o.x} y={o.y} width={o.w} height={o.h} rx={o.type === "sticky" ? 4 : 10} fill={MINI_FILL[o.color]} stroke={o.type === "rect" ? "#52525b" : "none"} strokeWidth={2} />;
              })}
            </svg>
          )}
          <span className="absolute right-2 bottom-2 rounded-md bg-surface/90 px-1.5 py-0.5 font-mono text-[11px] text-muted">{objects.length} objects</span>
        </Link>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Mindmap (live miniature)

const readNormalizedMindmap = (doc: import("yjs").Doc) => normalizeMindmap(readMindmap(doc));
const EMPTY_MAP = { nodes: [], edges: [], repaired: [] };

export function MindmapWidget({ controls, items: initial, pinnedId, onPin }: WidgetProps) {
  const { href } = useWorkspace();
  const items = useModuleItems("mindmap", initial);
  const focus = focusItem(items, pinnedId);
  const { value: map, state } = useYjsMap(focus ? roomName("mindmap", focus.id) : null, readNormalizedMindmap, "nodes", EMPTY_MAP);
  const box = useMemo(() => {
    if (!map.nodes.length) return { x: -200, y: -100, w: 400, h: 200 };
    const xs = map.nodes.map((n) => n.x);
    const ys = map.nodes.map((n) => n.y);
    return { x: Math.min(...xs) - 60, y: Math.min(...ys) - 50, w: Math.max(...xs) - Math.min(...xs) + 280, h: Math.max(...ys) - Math.min(...ys) + 100 };
  }, [map.nodes]);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));

  return (
    <WidgetFrame type="mindmap" title={focus?.title} href={focus ? href(`mindmap/${focus.id}`) : href("mindmap")} controls={controls} items={items} pinnedId={pinnedId} onPin={onPin}>
      {!focus ? (
        <WidgetEmpty action={<CreateLink module="mindmap" label="Start a mindmap" />}>No mindmaps yet.</WidgetEmpty>
      ) : (
        <Link href={href(`mindmap/${focus.id}`)} className="relative block h-full min-h-40 overflow-hidden rounded-xl border border-border bg-bg" aria-label={`Open ${focus.title}`}>
          {!state.synced ? (
            <span className="absolute inset-0 flex items-center justify-center text-muted">{state.error ? <span className="text-[12.5px]">{state.error.message}</span> : <Spinner />}</span>
          ) : (
            <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
              {map.edges.map((e) => {
                const a = byId.get(e.source);
                const b = byId.get(e.target);
                if (!a || !b) return null;
                const x1 = a.x + 120;
                const y1 = a.y + 18;
                const x2 = b.x;
                const y2 = b.y + 18;
                return <path key={e.id} d={`M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`} fill="none" stroke={colorVar(b.color)} strokeOpacity={0.6} strokeWidth={3} />;
              })}
              {map.nodes.map((n) => (
                <g key={n.id}>
                  <rect x={n.x} y={n.y} width={120} height={36} rx={10} fill={n.parentId === null ? colorVar(n.color) : "var(--surface)"} stroke={colorVar(n.color)} strokeWidth={2} />
                  <text x={n.x + 10} y={n.y + 23} fontSize={14} fontWeight={n.parentId === null ? 700 : 500} fill={n.parentId === null ? "#fff" : "var(--text)"}>
                    {n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
                  </text>
                </g>
              ))}
            </svg>
          )}
          <span className="absolute right-2 bottom-2 rounded-md bg-surface/90 px-1.5 py-0.5 font-mono text-[11px] text-muted">{map.nodes.length} topics</span>
        </Link>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Code

export function CodeWidget({ controls, items: initial }: WidgetProps) {
  const { href } = useWorkspace();
  const items = useModuleItems("code", initial);
  return (
    <WidgetFrame type="code" href={href("code")} controls={controls}>
      {items.length === 0 ? (
        <WidgetEmpty action={<CreateLink module="code" label="Create a project" />}>No code projects yet.</WidgetEmpty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.slice(0, 4).map((p) => (
            <li key={p.id}>
              <Link href={href(`code/${p.id}`)} className="-mx-2 block rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                <p className="truncate text-[13.5px] font-medium text-text">{p.title}</p>
                <p className="truncate font-mono text-[11.5px] text-muted">{p.preview_text || "main.ts"}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Kanban

export function KanbanWidget({ controls, items: initial, pinnedId, onPin }: WidgetProps) {
  const { href, member } = useWorkspace();
  const items = useModuleItems("kanban", initial);
  const focus = focusItem(items, pinnedId);
  const sb = getBrowserSupabase();
  const boardId = focus?.id ?? "";
  const loadC = useCallback(() => loadColumns(sb, boardId), [sb, boardId]);
  const loadT = useCallback(() => loadTasks(sb, boardId), [sb, boardId]);
  const cols = useLiveRows({ table: "board_columns", filter: `board_id=eq.${boardId}`, load: loadC, enabled: Boolean(focus) });
  const tasks = useLiveRows({ table: "tasks", filter: `board_id=eq.${boardId}`, load: loadT, enabled: Boolean(focus) });
  const columns = sortByPosition(cols.rows.filter((c) => c.board_id === boardId));
  const maxCols = controls.size === "lg" ? 5 : controls.size === "md" ? 3 : 2;

  return (
    <WidgetFrame type="kanban" title={focus?.title} href={focus ? href(`kanban/${focus.id}`) : href("kanban")} controls={controls} items={items} pinnedId={pinnedId} onPin={onPin}>
      {!focus ? (
        <WidgetEmpty action={<CreateLink module="kanban" label="Create a board" />}>No boards yet.</WidgetEmpty>
      ) : cols.status === "loading" && !columns.length ? (
        <div className="flex h-32 items-center justify-center text-muted">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(maxCols, Math.max(columns.length, 1))}, minmax(0, 1fr))` }}>
          {columns.slice(0, maxCols).map((c) => {
            const list = sortByPosition(tasks.rows.filter((t) => t.column_id === c.id));
            return (
              <div key={c.id} className="min-w-0 rounded-xl bg-surface-2 p-2">
                <p className="mb-1.5 flex items-center justify-between px-1 text-[12px] font-semibold text-text-2">
                  <span className="truncate">{c.title}</span>
                  <span className="font-mono text-muted">{list.length}</span>
                </p>
                <ul className="flex flex-col gap-1">
                  {list.slice(0, 3).map((t) => {
                    const a = member(t.assignee_id);
                    return (
                      <li key={t.id}>
                        <Link href={href(`kanban/${focus.id}?task=${t.id}`)} className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text hover:border-border-strong">
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          {a ? <Avatar name={a.name} color={a.color} size={16} /> : null}
                        </Link>
                      </li>
                    );
                  })}
                  {list.length > 3 ? <li className="px-1 text-[11.5px] text-muted">+{list.length - 3} more</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Chat

export function ChatWidget({ controls }: WidgetProps) {
  const { href, workspace, member } = useWorkspace();
  const sb = getBrowserSupabase();
  const [channel, setChannel] = useState<Channel | null | undefined>(undefined);
  useEffect(() => {
    void listChannels(sb, workspace.id)
      .then((list) => setChannel(list.find((c) => c.name === "general") ?? list[0] ?? null))
      .catch(() => setChannel(null));
  }, [sb, workspace.id]);
  const channelId = channel?.id ?? "";
  const load = useCallback(() => loadMessages(sb, channelId), [sb, channelId]);
  const { rows } = useLiveRows({ table: "messages", filter: `channel_id=eq.${channelId}`, load, enabled: Boolean(channel) });
  const recent = rows
    .filter((m) => !m.parent_id && !m.deleted_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .slice(controls.size === "sm" ? -3 : -5);

  return (
    <WidgetFrame type="chat" title={channel ? `#${channel.name}` : undefined} href={channel ? href(`chat/${channel.id}`) : href("chat")} controls={controls}>
      {channel === undefined ? (
        <div className="flex h-32 items-center justify-center text-muted">
          <Spinner />
        </div>
      ) : !channel ? (
        <WidgetEmpty>No channels yet.</WidgetEmpty>
      ) : recent.length === 0 ? (
        <WidgetEmpty action={<Link className="text-[12.5px] font-medium text-accent hover:underline" href={href(`chat/${channel.id}`)}>Say hello</Link>}>
          <Hash className="mx-auto mb-1 size-4" /> #{channel.name} is quiet.
        </WidgetEmpty>
      ) : (
        <Link href={href(`chat/${channel.id}`)} className="flex flex-col gap-2.5">
          {recent.map((m) => {
            const a = member(m.author_id);
            return (
              <div key={m.id} className="flex gap-2">
                <Avatar name={a?.name ?? "?"} color={a?.color} size={22} />
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-text">
                  <span className="font-semibold">{a?.name ?? "Former member"}</span> <span className="text-muted">{timeAgo(m.created_at)}</span>
                  <span className="mt-0.5 line-clamp-2 block text-text-2">{m.body}</span>
                </p>
              </div>
            );
          })}
        </Link>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Playlist

export function PlaylistWidget({ controls, items: initial, pinnedId, onPin }: WidgetProps) {
  const { href } = useWorkspace();
  const items = useModuleItems("playlist", initial);
  const focus = focusItem(items, pinnedId);
  const sb = getBrowserSupabase();
  const id = focus?.id ?? "";
  const load = useCallback(() => loadPlaylistItems(sb, id), [sb, id]);
  const { rows } = useLiveRows({ table: "playlist_items", filter: `playlist_id=eq.${id}`, load, enabled: Boolean(focus) });
  const tracks = sortByPosition(rows.filter((r) => r.playlist_id === id));
  return (
    <WidgetFrame type="playlist" title={focus?.title} href={focus ? href(`playlists/${focus.id}`) : href("playlists")} controls={controls} items={items} pinnedId={pinnedId} onPin={onPin}>
      {!focus ? (
        <WidgetEmpty action={<CreateLink module="playlist" label="Start a playlist" />}>No playlists yet.</WidgetEmpty>
      ) : tracks.length === 0 ? (
        <WidgetEmpty>This playlist is empty.</WidgetEmpty>
      ) : (
        <ol className="flex flex-col">
          {tracks.slice(0, 5).map((t, i) => (
            <li key={t.id} className="flex items-center gap-2.5 py-1.5">
              <span className="w-4 text-right font-mono text-[11px] text-muted">{i + 1}</span>
              <a href={t.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-[13px] text-text">{t.title}</span>
                <span className="block truncate text-[11.5px] text-muted">{t.artist || hostOf(t.url)}</span>
              </a>
            </li>
          ))}
          {tracks.length > 5 ? <li className="pl-6 text-[11.5px] text-muted">+{tracks.length - 5} more</li> : null}
        </ol>
      )}
    </WidgetFrame>
  );
}

// ---------------------------------------------------------------- Shopping

export function ShoppingWidget({ controls, items: initial, pinnedId, onPin }: WidgetProps) {
  const { href, canEdit } = useWorkspace();
  const items = useModuleItems("shopping", initial);
  const focus = focusItem(items, pinnedId);
  const sb = getBrowserSupabase();
  const id = focus?.id ?? "";
  const load = useCallback(() => loadShoppingItems(sb, id), [sb, id]);
  const { rows, setRows, reload } = useLiveRows({ table: "shopping_items", filter: `list_id=eq.${id}`, load, enabled: Boolean(focus) });
  const open = sortByPosition(rows.filter((r) => r.list_id === id && !r.checked));
  const doneCount = rows.filter((r) => r.list_id === id && r.checked).length;
  return (
    <WidgetFrame type="shopping" title={focus?.title} href={focus ? href(`shopping/${focus.id}`) : href("shopping")} controls={controls} items={items} pinnedId={pinnedId} onPin={onPin}>
      {!focus ? (
        <WidgetEmpty action={<CreateLink module="shopping" label="Create a list" />}>No to-do lists yet.</WidgetEmpty>
      ) : open.length === 0 ? (
        <WidgetEmpty>{doneCount ? "All done." : "The list is empty."}</WidgetEmpty>
      ) : (
        <ul className="flex flex-col">
          {open.slice(0, 5).map((it) => (
            <li key={it.id} className="flex items-center gap-2.5 py-1.5">
              <button
                role="checkbox"
                aria-checked={false}
                aria-label={`Check ${it.name}`}
                disabled={!canEdit}
                onClick={async () => {
                  setRows((r) => r.map((x) => (x.id === it.id ? { ...x, checked: true } : x)));
                  try {
                    await updateShoppingItem(sb, it.id, { checked: true });
                  } catch (err) {
                    toastError(err);
                    void reload();
                  }
                }}
                className={cn("flex size-4.5 shrink-0 items-center justify-center rounded border-2 border-border-strong transition-colors enabled:hover:border-success")}
              >
                <Check className="size-3 opacity-0" />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px] text-text">{it.name}</span>
              <span className="font-mono text-[11.5px] text-muted">
                {Number(it.quantity)}
                {it.unit ? ` ${it.unit}` : ""}
              </span>
            </li>
          ))}
          <li className="pt-1 text-[11.5px] text-muted">
            {open.length > 5 ? `+${open.length - 5} more · ` : ""}
            {doneCount} done
          </li>
        </ul>
      )}
    </WidgetFrame>
  );
}
