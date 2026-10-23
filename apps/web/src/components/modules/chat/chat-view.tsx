"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { toastError, toastPlanError } from "@/lib/notify-error";
import { Hash, MessageSquareReply, MoreHorizontal, Pencil, Plus, SmilePlus, Trash2, X } from "lucide-react";
import { REACTION_EMOJI } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { usePresence, useTypingIndicator } from "@/lib/realtime/presence";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import {
  createChannel,
  deleteChannel,
  editMessage,
  linkify,
  listChannels,
  loadThread,
  markRead,
  removeMessage,
  sendMessage,
  toggleReaction,
  unreadCounts,
  updateChannel,
  type Channel,
  type Message,
  type Reaction,
  type ReactionEmoji,
} from "@/lib/data/chat";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { Avatar, AvatarStack, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/menu";
import { ConfirmDialog, PromptDialog } from "@/components/ui/confirm";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Spinner } from "@/components/ui/spinner";
import { cn, errorMessage } from "@/lib/utils";
import { compareMessages, useChannelMessages } from "./use-channel";

interface Pending {
  id: string;
  body: string;
  parentId: string | null;
  status: "sending" | "failed";
  createdAt: string;
}

export function ChatView({
  channel,
  initialChannels,
  initialMessages,
  initialHasMore,
}: {
  channel: Channel;
  initialChannels: Channel[];
  initialMessages: Message[];
  initialHasMore: boolean;
}) {
  const { workspace, href } = useWorkspace();
  const router = useRouter();
  const sb = getBrowserSupabase();
  const loadChannels = useCallback(() => listChannels(sb, workspace.id), [sb, workspace.id]);
  const channels = useLiveRows({ table: "channels", filter: `workspace_id=eq.${workspace.id}`, load: loadChannels, initial: initialChannels });
  const live = channels.rows.find((c) => c.id === channel.id);

  useEffect(() => {
    if (channels.status === "live" && !live) {
      toast.message(`#${channel.name} was deleted`);
      router.replace(href("chat"));
    }
  }, [channels.status, live, channel.name, router, href]);

  return (
    <div className="flex h-full min-h-0">
      <ChannelList channels={channels.rows} activeId={channel.id} />
      <ChannelPane
        key={channel.id}
        channel={live ?? channel}
        channels={channels.rows}
        initialMessages={initialMessages}
        initialHasMore={initialHasMore}
      />
    </div>
  );
}

function ChannelList({ channels, activeId }: { channels: Channel[]; activeId: string }) {
  const { workspace, href, canEdit } = useWorkspace();
  const router = useRouter();
  const sb = getBrowserSupabase();
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  // Unread counts are computed server-side per user; refresh on new messages.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void unreadCounts(sb, workspace.id).then(setUnread).catch(() => {}), 400);
    };
    refresh();
    const ch = sb
      .channel(`unread:${workspace.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `workspace_id=eq.${workspace.id}` }, refresh)
      .subscribe((s) => s === "SUBSCRIBED" && refresh());
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(ch);
    };
  }, [sb, workspace.id, activeId]);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex" aria-label="Channels">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <ModuleIcon type="chat" tile />
        <p className="flex-1 text-[14px] font-semibold text-text">Chat</p>
        {canEdit ? (
          <Tooltip label="New channel">
            <Button size="icon-sm" variant="ghost" aria-label="New channel" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        ) : null}
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {[...channels].sort((a, b) => a.name.localeCompare(b.name)).map((c) => {
          const n = c.id === activeId ? 0 : (unread[c.id] ?? 0);
          return (
            <Link
              key={c.id}
              href={href(`chat/${c.id}`)}
              aria-current={c.id === activeId ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors",
                c.id === activeId ? "bg-surface-2 font-medium text-text" : n ? "font-semibold text-text hover:bg-surface-2" : "text-text-2 hover:bg-surface-2",
              )}
            >
              <Hash className="size-3.5 text-muted" />
              <span className="flex-1 truncate">{c.name}</span>
              {n ? (
                <span className="rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-accent-text" aria-label={`${n} unread`}>
                  {n > 99 ? "99+" : n}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <PromptDialog
        open={creating}
        onOpenChange={setCreating}
        title="New channel"
        description="Lowercase letters, numbers, dashes and underscores."
        label="Channel name"
        placeholder="design-reviews"
        maxLength={40}
        submitLabel="Create channel"
        onSubmit={async (name) => {
          try {
            const c = await createChannel(sb, workspace.id, name);
            router.push(href(`chat/${c.id}`));
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </aside>
  );
}

function ChannelPane({
  channel,
  channels,
  initialMessages,
  initialHasMore,
}: {
  channel: Channel;
  channels: Channel[];
  initialMessages: Message[];
  initialHasMore: boolean;
}) {
  const { workspace, me, canEdit, canManage, href, members } = useWorkspace();
  const { online } = usePresence();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const sb = getBrowserSupabase();
  const { messages, upsert, reactions, setReactions, hasMore, loadOlder, loadingOlder, status } = useChannelMessages(
    channel.id,
    workspace.id,
    initialMessages,
    initialHasMore,
  );
  const [pending, setPending] = useState<Pending[]>([]);
  const [editingChannel, setEditingChannel] = useState<"topic" | "delete" | null>(null);
  const threadId = search.get("thread");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const topLevel = useMemo(() => [...messages.values()].filter((m) => !m.parent_id).sort(compareMessages), [messages]);
  const here = online.filter((o) => o.location === `chat/${channel.id}`);
  const typers = useTypingIndicator(channel.id);

  // Mark read while the channel is open.
  const lastId = topLevel[topLevel.length - 1]?.id;
  useEffect(() => {
    if (document.visibilityState === "visible") void markRead(sb, channel.id);
  }, [sb, channel.id, lastId]);

  // Keep the view pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [topLevel.length, pending.length]);

  const send = async (body: string, parentId: string | null = null) => {
    const id = crypto.randomUUID();
    const p: Pending = { id, body, parentId, status: "sending", createdAt: new Date().toISOString() };
    setPending((cur) => [...cur, p]);
    stickToBottom.current = true;
    try {
      const saved = await sendMessage(sb, { id, workspaceId: workspace.id, channelId: channel.id, body, parentId });
      upsert([saved]);
      setPending((cur) => cur.filter((x) => x.id !== id));
    } catch (err) {
      toastError(err, "Message not sent.");
      setPending((cur) => cur.map((x) => (x.id === id ? { ...x, status: "failed" } : x)));
    }
  };

  const retry = async (p: Pending) => {
    setPending((cur) => cur.filter((x) => x.id !== p.id));
    await send(p.body, p.parentId);
  };

  const setThread = (id: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (id) params.set("thread", id);
    else params.delete("thread");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const react = async (m: Message, emoji: ReactionEmoji) => {
    const mine = reactions.some((r) => r.message_id === m.id && r.user_id === me.id && r.emoji === emoji);
    // Optimistic toggle; realtime confirms for everyone else.
    setReactions((cur) =>
      mine
        ? cur.filter((r) => !(r.message_id === m.id && r.user_id === me.id && r.emoji === emoji))
        : [...cur, { message_id: m.id, user_id: me.id, emoji, workspace_id: workspace.id, created_at: new Date().toISOString() }],
    );
    try {
      await toggleReaction(sb, workspace.id, m.id, emoji, mine, me.id);
    } catch (err) {
      toastError(err);
      // Undo the optimistic toggle so nobody sees a reaction that wasn't saved.
      setReactions((cur) =>
        mine
          ? [...cur, { message_id: m.id, user_id: me.id, emoji, workspace_id: workspace.id, created_at: new Date().toISOString() }]
          : cur.filter((r) => !(r.message_id === m.id && r.user_id === me.id && r.emoji === emoji)),
      );
    }
  };

  const creatorOrAdmin = channel.created_by === me.id || canManage;
  const threadParent = threadId ? messages.get(threadId) : undefined;

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-bg" aria-label={`#${channel.name}`}>
        <header className="flex items-center gap-3 border-b border-border bg-surface px-5 py-3">
          <div className="min-w-0 flex-1">
            {/* Phones: the channel list is hidden, so switch channels here. */}
            <label className="mb-1 block md:hidden">
              <span className="sr-only">Switch channel</span>
              <Select
                value={channel.id}
                onChange={(e) => router.push(href(`chat/${e.target.value}`))}
                className="max-w-56"
              >
                {[...channels]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </Select>
            </label>
            <h1 className="flex items-center gap-1 text-[15px] font-semibold text-text max-md:sr-only">
              <Hash className="size-4 text-muted" />
              {channel.name}
            </h1>
            <p className="truncate text-[12.5px] text-muted">{channel.topic || `${members.length} members`}</p>
          </div>
          {status === "reconnecting" ? <span className="text-[12px] text-warning">Reconnecting… new messages will catch up</span> : null}
          {here.length ? (
            <Tooltip label={`${here.map((h) => h.name).join(", ")} viewing`}>
              <span>
                <AvatarStack people={here.map((h) => ({ id: h.userId, name: h.name, color: h.color }))} size={22} />
              </span>
            </Tooltip>
          ) : null}
          {creatorOrAdmin ? (
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Channel options">
                  <MoreHorizontal className="size-4" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<Pencil />} onSelect={() => setEditingChannel("topic")}>
                  Edit topic
                </MenuItem>
                {channel.name !== "general" ? (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} destructive onSelect={() => setEditingChannel("delete")}>
                      Delete channel
                    </MenuItem>
                  </>
                ) : null}
              </MenuContent>
            </Menu>
          ) : null}
        </header>

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {hasMore ? (
            <div className="mb-4 flex justify-center">
              <Button size="sm" variant="outline" loading={loadingOlder} onClick={() => {
                stickToBottom.current = false;
                void loadOlder();
              }}>
                Load earlier messages
              </Button>
            </div>
          ) : (
            <div className="mb-6">
              <p className="font-display text-2xl text-text">Welcome to #{channel.name}</p>
              <p className="text-[13px] text-muted">This is the beginning of the channel.</p>
            </div>
          )}
          <MessageList
            items={topLevel}
            reactions={reactions}
            pending={pending.filter((p) => !p.parentId)}
            onReply={(m) => setThread(m.id)}
            onReact={react}
            onRetry={retry}
            onEdited={(m) => upsert([m])}
          />
        </div>

        <div className="px-5 pb-4">
          <p className="h-5 text-[12px] text-muted" aria-live="polite">
            {typers.length ? `${typers.slice(0, 3).join(", ")} ${typers.length === 1 ? "is" : "are"} typing…` : ""}
          </p>
          {canEdit ? (
            <Composer channelId={channel.id} placeholder={`Message #${channel.name}`} onSend={(b) => void send(b)} />
          ) : (
            <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] text-muted">You have view-only access to this workspace.</p>
          )}
        </div>
      </section>

      {threadParent ? (
        <ThreadPanel
          parent={threadParent}
          messages={messages}
          reactions={reactions}
          pending={pending.filter((p) => p.parentId === threadParent.id)}
          onClose={() => setThread(null)}
          onSend={(b) => void send(b, threadParent.id)}
          onReact={react}
          onRetry={retry}
          onLoaded={upsert}
          onEdited={(m) => upsert([m])}
        />
      ) : null}

      <PromptDialog
        open={editingChannel === "topic"}
        onOpenChange={(o) => !o && setEditingChannel(null)}
        title="Channel topic"
        label="Topic"
        initialValue={channel.topic}
        maxLength={250}
        onSubmit={async (topic) => {
          try {
            await updateChannel(sb, channel.id, { topic });
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
      <ConfirmDialog
        open={editingChannel === "delete"}
        onOpenChange={(o) => !o && setEditingChannel(null)}
        title={`Delete #${channel.name}?`}
        description="All of its messages are permanently deleted for everyone."
        confirmLabel="Delete channel"
        destructive
        onConfirm={async () => {
          try {
            await deleteChannel(sb, channel.id);
            router.replace(href("chat"));
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </div>
  );
}

function sameGroup(a: Message | undefined, b: Message): boolean {
  if (!a) return false;
  return a.author_id === b.author_id && new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < 5 * 60_000;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function MessageList({
  items,
  reactions,
  pending,
  onReply,
  onReact,
  onRetry,
  onEdited,
  inThread = false,
}: {
  items: Message[];
  reactions: Reaction[];
  pending: Pending[];
  onReply?: (m: Message) => void;
  onReact: (m: Message, e: ReactionEmoji) => void;
  onRetry: (p: Pending) => void;
  onEdited: (m: Message) => void;
  inThread?: boolean;
}) {
  const pendingNotSaved = pending.filter((p) => !items.some((m) => m.id === p.id));
  return (
    <ol className="flex flex-col" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
      {items.map((m, i) => {
        const prev = items[i - 1];
        const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
        return (
          <Fragment key={m.id}>
            {newDay && !inThread ? (
              <li className="my-3 flex items-center gap-3 text-[11.5px] font-medium text-muted" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                {dayLabel(m.created_at)}
                <span className="h-px flex-1 bg-border" />
              </li>
            ) : null}
            <MessageItem
              m={m}
              grouped={!newDay && sameGroup(prev, m)}
              reactions={reactions.filter((r) => r.message_id === m.id)}
              onReply={onReply}
              onReact={onReact}
              onEdited={onEdited}
            />
          </Fragment>
        );
      })}
      {pendingNotSaved.map((p) => (
        <li key={p.id} className="flex gap-3 py-1 pl-11 opacity-70">
          <p className="text-[14px] whitespace-pre-wrap text-text">{p.body}</p>
          {p.status === "failed" ? (
            <button className="shrink-0 text-[12px] text-danger underline" onClick={() => onRetry(p)}>
              Failed — retry
            </button>
          ) : (
            <Spinner className="size-3 shrink-0 text-muted" label="Sending" />
          )}
        </li>
      ))}
    </ol>
  );
}

function MessageItem({
  m,
  grouped,
  reactions,
  onReply,
  onReact,
  onEdited,
}: {
  m: Message;
  grouped: boolean;
  reactions: Reaction[];
  onReply?: (m: Message) => void;
  onReact: (m: Message, e: ReactionEmoji) => void;
  onEdited: (m: Message) => void;
}) {
  const { me, member, canEdit, canManage } = useWorkspace();
  const sb = getBrowserSupabase();
  const author = member(m.author_id);
  const mine = m.author_id === me.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = Boolean(m.deleted_at);
  const time = new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const grouped_reactions = REACTION_EMOJI.map((e) => ({
    emoji: e,
    users: reactions.filter((r) => r.emoji === e).map((r) => r.user_id),
  })).filter((g) => g.users.length);

  return (
    <li className={cn("group relative flex gap-3 rounded-lg px-2 py-1 -mx-2 hover:bg-surface-2/60", !grouped && "mt-2")}>
      <div className="w-8 shrink-0">
        {!grouped ? (
          <Avatar name={author?.name ?? "Former member"} color={author?.color ?? "slate"} size={32} />
        ) : (
          <span className="hidden pt-1 text-right font-mono text-[10px] text-muted group-hover:block">{time}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <p className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold text-text">{author?.name ?? "Former member"}</span>
            <time className="text-[11.5px] text-muted" dateTime={m.created_at}>
              {time}
            </time>
          </p>
        ) : null}
        {editing ? (
          <form
            className="mt-1"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                onEdited(await editMessage(sb, m.id, draft));
                setEditing(false);
              } catch (err) {
                toastError(err);
              }
            }}
          >
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} rows={2} autoFocus aria-label="Edit message" />
            <div className="mt-1.5 flex gap-1.5">
              <Button size="sm" type="submit" variant="primary" disabled={!draft.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : deleted ? (
          <p className="text-[13.5px] text-muted italic">This message was deleted.</p>
        ) : (
          <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-text">
            {linkify(m.body).map((seg, i) =>
              seg.href ? (
                <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
                  {seg.text}
                </a>
              ) : (
                <Fragment key={i}>{seg.text}</Fragment>
              ),
            )}
            {m.edited_at ? <span className="ml-1 text-[11px] text-muted">(edited)</span> : null}
          </p>
        )}
        {grouped_reactions.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {grouped_reactions.map((g) => (
              <Tooltip key={g.emoji} label={g.users.map((u) => member(u)?.name ?? "Someone").join(", ")}>
                <button
                  disabled={!canEdit}
                  aria-pressed={g.users.includes(me.id)}
                  onClick={() => onReact(m, g.emoji)}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] transition-colors",
                    g.users.includes(me.id) ? "border-accent/40 bg-accent-soft text-accent" : "border-border bg-surface text-text-2 hover:border-border-strong",
                  )}
                >
                  {g.emoji} <span className="font-medium">{g.users.length}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        ) : null}
        {onReply && m.reply_count > 0 ? (
          <button onClick={() => onReply(m)} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
            <MessageSquareReply className="size-3.5" />
            {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>
      {!deleted && !editing && canEdit ? (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-sm group-focus-within:flex group-hover:flex [@media(hover:none)]:flex">
          <Popover>
            <PopoverTrigger asChild>
              <button aria-label="Add reaction" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2">
                <SmilePlus className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex gap-0.5 p-1">
              {REACTION_EMOJI.map((e) => (
                <button key={e} aria-label={`React ${e}`} onClick={() => onReact(m, e)} className="flex size-8 items-center justify-center rounded-md text-[17px] hover:bg-surface-2">
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          {onReply ? (
            <button aria-label="Reply in thread" onClick={() => onReply(m)} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2">
              <MessageSquareReply className="size-4" />
            </button>
          ) : null}
          {mine ? (
            <button
              aria-label="Edit message"
              onClick={() => {
                setDraft(m.body);
                setEditing(true);
              }}
              className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
            >
              <Pencil className="size-4" />
            </button>
          ) : null}
          {mine || canManage ? (
            <button aria-label="Delete message" onClick={() => setConfirmDelete(true)} className="flex size-7 items-center justify-center rounded-md text-danger hover:bg-danger-soft">
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete message?"
        description="It will be removed for everyone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await removeMessage(sb, m, mine);
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </li>
  );
}

function Composer({ channelId, placeholder, onSend }: { channelId: string; placeholder: string; onSend: (body: string) => void }) {
  const { sendTyping } = usePresence();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    const body = value.trim();
    if (!body) return;
    onSend(body);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm focus-within:border-accent focus-within:ring-3 focus-within:ring-[var(--ring)]"
    >
      <textarea
        ref={ref}
        value={value}
        rows={1}
        maxLength={4000}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          if (e.target.value) sendTyping(channelId);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-[200px] min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-[14px] text-text outline-none placeholder:text-muted"
      />
      <Button type="submit" variant="primary" size="sm" disabled={!value.trim()}>
        Send
      </Button>
    </form>
  );
}

function ThreadPanel({
  parent,
  messages,
  reactions,
  pending,
  onClose,
  onSend,
  onReact,
  onRetry,
  onLoaded,
  onEdited,
}: {
  parent: Message;
  messages: Map<string, Message>;
  reactions: Reaction[];
  pending: Pending[];
  onClose: () => void;
  onSend: (b: string) => void;
  onReact: (m: Message, e: ReactionEmoji) => void;
  onRetry: (p: Pending) => void;
  onLoaded: (m: Message[]) => void;
  onEdited: (m: Message) => void;
}) {
  const { canEdit } = useWorkspace();
  const sb = getBrowserSupabase();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadThread(sb, parent.id)
      .then((r) => alive && onLoaded(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sb, parent.id, onLoaded]);
  const replies = [...messages.values()].filter((m) => m.parent_id === parent.id).sort(compareMessages);

  return (
    <aside className="flex w-full max-w-sm shrink-0 flex-col border-l border-border bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-lg" aria-label="Thread">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-[14px] font-semibold text-text">Thread</p>
        <Button size="icon-sm" variant="ghost" aria-label="Close thread" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MessageList items={[parent]} reactions={reactions} pending={[]} onReact={onReact} onRetry={onRetry} onEdited={onEdited} inThread />
        <p className="my-3 flex items-center gap-3 text-[11.5px] text-muted">
          <span className="h-px flex-1 bg-border" />
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
          <span className="h-px flex-1 bg-border" />
        </p>
        {loading && !replies.length ? <Spinner className="mx-auto" /> : null}
        <MessageList items={replies} reactions={reactions} pending={pending} onReact={onReact} onRetry={onRetry} onEdited={onEdited} inThread />
      </div>
      {canEdit ? (
        <div className="p-3">
          <Composer channelId={parent.channel_id} placeholder="Reply…" onSend={onSend} />
        </div>
      ) : null}
    </aside>
  );
}

export function ChatEmpty() {
  const { workspace, canEdit, href } = useWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <EmptyState
        className="h-full"
        icon={<Hash />}
        title="No channels yet"
        description="Channels keep conversations organised by topic."
        action={canEdit ? <Button variant="primary" onClick={() => setOpen(true)}>Create a channel</Button> : null}
      />
      <PromptDialog
        open={open}
        onOpenChange={setOpen}
        title="New channel"
        label="Channel name"
        placeholder="general"
        maxLength={40}
        onSubmit={async (name) => {
          try {
            const c = await createChannel(getBrowserSupabase(), workspace.id, name);
            router.push(href(`chat/${c.id}`));
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
