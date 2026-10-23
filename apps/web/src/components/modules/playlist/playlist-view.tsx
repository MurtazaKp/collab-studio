"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toastError } from "@/lib/notify-error";
import { ExternalLink, Music, Pencil, Plus, Trash2 } from "lucide-react";
import { playlistItemInputSchema, positionAtEnd, positionForIndex, sortByPosition } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { usePresence } from "@/lib/realtime/presence";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { addPlaylistItem, hostOf, loadPlaylistItems, removePlaylistItem, updatePlaylistItem, type PlaylistItem } from "@/lib/data/lists";
import type { ItemRow } from "@/lib/data/items";
import { EditableTitle, useLiveItem } from "@/components/modules/collab-chrome";
import { SortableList } from "@/components/modules/sortable";
import { PageHeader } from "@/components/shell/page-header";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Avatar, AvatarStack, EmptyState, Notice } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/menu";
import { errorMessage } from "@/lib/utils";

interface Draft {
  title: string;
  url: string;
  artist: string;
  note: string;
}
const EMPTY: Draft = { title: "", url: "", artist: "", note: "" };

export function PlaylistView({ playlist, initialItems }: { playlist: ItemRow; initialItems: PlaylistItem[] }) {
  const router = useRouter();
  const { workspace, canEdit, href, member } = useWorkspace();
  const { online } = usePresence();
  const sb = getBrowserSupabase();
  const { item, deleted } = useLiveItem("playlist", playlist);
  const load = useCallback(() => loadPlaylistItems(sb, playlist.id), [sb, playlist.id]);
  const { rows, setRows, reload, status } = useLiveRows({ table: "playlist_items", filter: `playlist_id=eq.${playlist.id}`, load, initial: initialItems });
  const items = useMemo(() => sortByPosition(rows), [rows]);
  const [editing, setEditing] = useState<PlaylistItem | "new" | null>(null);
  const viewers = online.filter((o) => o.location === `playlists/${playlist.id}`).map((o) => ({ id: o.userId, name: o.name, color: o.color }));

  if (deleted) {
    return (
      <EmptyState
        icon={<Music />}
        title="This playlist was deleted"
        action={<Button variant="outline" onClick={() => router.push(href("playlists"))}>Back to playlists</Button>}
      />
    );
  }

  const move = async (id: string, to: number) => {
    const position = positionForIndex(items, to, id);
    setRows((r) => r.map((x) => (x.id === id ? { ...x, position } : x)));
    try {
      await updatePlaylistItem(sb, id, { position });
    } catch (err) {
      toastError(err);
      void reload();
    }
  };

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <PageHeader
        crumbs={[{ label: workspace.name, href: href() }, { label: "Playlists", href: href("playlists") }]}
        icon={<ModuleIcon type="playlist" tile />}
        title={<EditableTitle module="playlist" item={item} editable={canEdit} />}
        meta={`${items.length} track${items.length === 1 ? "" : "s"}${status === "reconnecting" ? " · reconnecting…" : ""}`}
        actions={
          <>
            {viewers.length ? <AvatarStack people={viewers} size={24} /> : null}
            {canEdit ? (
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus className="size-4" /> Add track
              </Button>
            ) : null}
          </>
        }
      />
      <div className="px-6 lg:px-10">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong">
            <EmptyState
              icon={<Music />}
              title="No tracks yet"
              description="Add songs, albums, podcasts or video links. Everyone sees the list update live."
              action={canEdit ? <Button variant="primary" onClick={() => setEditing("new")}>Add the first track</Button> : null}
            />
          </div>
        ) : (
          <SortableList
            items={items}
            disabled={!canEdit}
            onMove={(id, to) => void move(id, to)}
            className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
            render={(t, handle, index) => {
              const by = member(t.created_by);
              return (
                <div className="group flex items-center gap-3 border-b border-border bg-surface px-3 py-2.5 last:border-b-0">
                  {handle}
                  <span className="w-6 text-right font-mono text-[12px] text-muted tabular-nums">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-text">{t.title}</p>
                    <p className="truncate text-[12.5px] text-muted">
                      {[t.artist, hostOf(t.url)].filter(Boolean).join(" · ")}
                      {t.note ? ` — ${t.note}` : ""}
                    </p>
                  </div>
                  {by ? (
                    <Tooltip label={`Added by ${by.name}`}>
                      <span>
                        <Avatar name={by.name} color={by.color} size={22} />
                      </span>
                    </Tooltip>
                  ) : null}
                  <a href={t.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open ${t.title}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                    <ExternalLink className="size-4" />
                  </a>
                  {canEdit ? (
                    <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${t.title}`}
                        className="text-danger hover:bg-danger-soft"
                        onClick={async () => {
                          setRows((r) => r.filter((x) => x.id !== t.id));
                          try {
                            await removePlaylistItem(sb, t.id);
                          } catch (err) {
                            toastError(err);
                            void reload();
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
        )}
        <p className="mt-4 text-[12px] text-muted">Links open on the original site. CollabVerse doesn&apos;t stream media.</p>
      </div>

      <TrackDialog
        open={editing !== null}
        initial={editing && editing !== "new" ? { title: editing.title, url: editing.url, artist: editing.artist, note: editing.note } : EMPTY}
        isNew={editing === "new"}
        onClose={() => setEditing(null)}
        onSubmit={async (d) => {
          if (editing === "new") {
            const added = await addPlaylistItem(sb, { workspaceId: workspace.id, playlistId: playlist.id }, d, positionAtEnd(items));
            setRows((r) => (r.some((x) => x.id === added.id) ? r : [...r, added]));
          } else if (editing) {
            await updatePlaylistItem(sb, editing.id, d);
            setRows((r) => r.map((x) => (x.id === editing.id ? { ...x, ...d } : x)));
          }
        }}
      />
    </div>
  );
}

function TrackDialog({
  open,
  initial,
  isNew,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: Draft;
  isNew: boolean;
  onClose: () => void;
  onSubmit: (d: Draft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setDraft(initial);
      setError(null);
    }
  }
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? "Add track" : "Edit track"}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = playlistItemInputSchema.safeParse(draft);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "Check the fields");
              return;
            }
            setBusy(true);
            try {
              await onSubmit(draft);
              onClose();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Field label="Title">{(p) => <Input {...p} value={draft.title} onChange={set("title")} maxLength={200} required autoFocus />}</Field>
          <Field label="Link" hint="Any http(s) link — streaming service, video or store page.">
            {(p) => <Input {...p} type="url" value={draft.url} onChange={set("url")} maxLength={2048} placeholder="https://" required />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Artist">{(p) => <Input {...p} value={draft.artist} onChange={set("artist")} maxLength={120} />}</Field>
            <Field label="Note">{(p) => <Input {...p} value={draft.note} onChange={set("note")} maxLength={500} />}</Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              {isNew ? "Add track" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
