"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Check, EyeOff, Lock, LockOpen, Plus, Settings2, Trash2, Vote } from "lucide-react";
import { positionAtEnd, sortByPosition } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { toastError } from "@/lib/notify-error";
import {
  addPollOption,
  castVote,
  loadPollOptions,
  loadPollVotes,
  pollIsOpen,
  removePollOption,
  updatePoll,
  withdrawVote,
  type Poll,
  type PollOption,
  type PollVote,
} from "@/lib/data/polls";
import type { ItemRow } from "@/lib/data/items";
import { EditableTitle, useLiveItem } from "@/components/modules/collab-chrome";
import { PageHeader } from "@/components/shell/page-header";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { AvatarStack, Badge, EmptyState } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Tooltip } from "@/components/ui/menu";
import { cn, formatDate } from "@/lib/utils";

/** A datetime-local value for a Date, in the viewer's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function PollView({ poll: initialPoll, initialOptions, initialVotes }: { poll: ItemRow; initialOptions: PollOption[]; initialVotes: PollVote[] }) {
  const router = useRouter();
  const { workspace, canEdit, href, member, me } = useWorkspace();
  const sb = getBrowserSupabase();
  const { item, deleted } = useLiveItem("polls", initialPoll);
  const poll = item as unknown as Poll;

  const loadOptions = useCallback(() => loadPollOptions(sb, poll.id), [sb, poll.id]);
  const loadVotes = useCallback(() => loadPollVotes(sb, poll.id), [sb, poll.id]);
  const { rows: optionRows, reload: reloadOptions, status } = useLiveRows({
    table: "poll_options",
    filter: `poll_id=eq.${poll.id}`,
    load: loadOptions,
    initial: initialOptions,
  });
  const { rows: votes, reload: reloadVotes } = useLiveRows({ table: "poll_votes", filter: `poll_id=eq.${poll.id}`, load: loadVotes, initial: initialVotes });

  const options = useMemo(() => sortByPosition(optionRows), [optionRows]);
  const total = options.reduce((n, o) => n + o.vote_count, 0);
  const voters = new Set(votes.map((v) => v.user_id)).size;
  const mine = votes.filter((v) => v.user_id === me.id);
  const open = pollIsOpen(poll);
  const [busy, setBusy] = useState<string | null>(null);
  const [newOption, setNewOption] = useState("");
  const [settings, setSettings] = useState(false);
  const [removing, setRemoving] = useState<PollOption | null>(null);

  if (deleted) {
    return (
      <EmptyState
        icon={<Vote />}
        title="This poll was deleted"
        action={<Button variant="outline" onClick={() => router.push(href("polls"))}>Back to polls</Button>}
      />
    );
  }

  const toggleVote = async (option: PollOption) => {
    if (!canEdit || !open || busy) return;
    setBusy(option.id);
    try {
      const existing = mine.find((v) => v.option_id === option.id);
      if (existing) await withdrawVote(sb, existing.id);
      else await castVote(sb, { workspaceId: workspace.id, pollId: poll.id, optionId: option.id, userId: me.id });
      await Promise.all([reloadVotes(), reloadOptions()]);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  const addOption = async () => {
    const label = newOption.trim();
    if (!label) return;
    try {
      await addPollOption(sb, { workspaceId: workspace.id, pollId: poll.id }, label, positionAtEnd(options));
      setNewOption("");
      void reloadOptions();
    } catch (err) {
      toastError(err);
    }
  };

  const setClosed = async (closed: boolean) => {
    try {
      await updatePoll(sb, poll.id, { closed_at: closed ? new Date().toISOString() : null, ...(closed ? {} : { closes_at: null }) });
    } catch (err) {
      toastError(err);
    }
  };

  const leader = total > 0 ? Math.max(...options.map((o) => o.vote_count)) : -1;

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader
        crumbs={[{ label: workspace.name, href: href() }, { label: "Polls", href: href("polls") }]}
        icon={<ModuleIcon type="polls" tile />}
        title={<EditableTitle module="polls" item={item} editable={canEdit} />}
        meta={`${total} vote${total === 1 ? "" : "s"}${poll.anonymous ? "" : ` from ${voters} ${voters === 1 ? "person" : "people"}`}${status === "reconnecting" ? " · reconnecting…" : ""}`}
        actions={
          canEdit ? (
            <>
              <Button variant="ghost" onClick={() => setSettings(true)}>
                <Settings2 className="size-4" /> Settings
              </Button>
              <Button variant="outline" onClick={() => void setClosed(open)}>
                {open ? <Lock className="size-4" /> : <LockOpen className="size-4" />} {open ? "Close poll" : "Reopen"}
              </Button>
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-6 lg:px-10">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={open ? "success" : "neutral"}>{open ? "Open" : "Closed"}</Badge>
          <Badge tone="neutral">{poll.multiple ? "Pick any" : "Pick one"}</Badge>
          {poll.anonymous ? (
            <Badge tone="neutral">
              <EyeOff aria-hidden className="size-3" /> Anonymous
            </Badge>
          ) : null}
          {open && poll.closes_at ? <span className="text-[12.5px] text-muted">Closes {formatDate(poll.closes_at)}</span> : null}
        </div>
        {poll.description ? <p className="max-w-2xl text-[14px] leading-relaxed whitespace-pre-wrap text-text-2">{poll.description}</p> : null}

        {options.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong">
            <EmptyState icon={<Vote />} title="No options yet" description="Add the choices people can vote for." />
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Options">
            {options.map((o) => {
              const pct = total ? Math.round((o.vote_count / total) * 100) : 0;
              const chosen = mine.some((v) => v.option_id === o.id);
              const who = poll.anonymous
                ? []
                : votes
                    .filter((v) => v.option_id === o.id)
                    .map((v) => member(v.user_id))
                    .filter((m): m is NonNullable<typeof m> => Boolean(m))
                    .map((m) => ({ id: m.userId, name: m.name, color: m.color }));
              return (
                <li key={o.id} className="group relative">
                  <button
                    type="button"
                    role={poll.multiple ? "checkbox" : "radio"}
                    aria-checked={chosen}
                    disabled={!canEdit || !open || busy !== null}
                    onClick={() => void toggleVote(o)}
                    className={cn(
                      "relative flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-surface px-4 py-3 text-left transition-[border-color,box-shadow] disabled:cursor-default",
                      chosen ? "border-accent shadow-sm" : "border-border enabled:hover:border-border-strong",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("absolute inset-y-0 left-0 transition-[width] duration-500 motion-reduce:transition-none", chosen ? "bg-accent-soft" : "bg-surface-2")}
                      style={{ width: `${pct}%` }}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "relative flex size-5 shrink-0 items-center justify-center border",
                        poll.multiple ? "rounded-md" : "rounded-full",
                        chosen ? "border-accent bg-accent text-accent-text" : "border-border-strong bg-surface",
                      )}
                    >
                      {chosen ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className={cn("relative min-w-0 flex-1 truncate text-[14.5px]", o.vote_count === leader && total > 0 ? "font-semibold text-text" : "text-text")}>
                      {o.label}
                    </span>
                    {who.length ? (
                      <span className="relative hidden sm:block">
                        <AvatarStack people={who} size={20} max={4} />
                      </span>
                    ) : null}
                    <span className="relative w-20 text-right text-[13px] text-text-2 tabular-nums">
                      {o.vote_count} · {pct}%
                    </span>
                  </button>
                  {canEdit ? (
                    <Tooltip label="Remove option">
                      <button
                        type="button"
                        aria-label={`Remove ${o.label}`}
                        onClick={() => setRemoving(o)}
                        className="absolute top-1/2 -right-9 hidden -translate-y-1/2 rounded-md p-1.5 text-muted group-focus-within:block group-hover:block hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Tooltip>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addOption();
            }}
          >
            <Input aria-label="New option" value={newOption} onChange={(e) => setNewOption(e.target.value)} maxLength={200} placeholder="Add an option…" />
            <Button type="submit" variant="secondary" disabled={!newOption.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </form>
        ) : null}
        {!canEdit ? <p className="text-[13px] text-muted">You have view-only access, so you can see the results but not vote.</p> : null}
      </div>

      <PollSettingsDialog open={settings} onOpenChange={setSettings} poll={poll} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.label ?? ""}”?`}
        description={removing && removing.vote_count > 0 ? `Its ${removing.vote_count} vote(s) are removed too.` : "This option is removed for everyone."}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await removePollOption(sb, removing!.id);
          void reloadOptions();
        }}
      />
    </div>
  );
}

function PollSettingsDialog({ open, onOpenChange, poll }: { open: boolean; onOpenChange: (o: boolean) => void; poll: Poll }) {
  const sb = getBrowserSupabase();
  const [description, setDescription] = useState(poll.description);
  const [multiple, setMultiple] = useState(poll.multiple);
  const [anonymous, setAnonymous] = useState(poll.anonymous);
  const [closesAt, setClosesAt] = useState(toLocalInput(poll.closes_at));
  const [saving, setSaving] = useState(false);
  const [seen, setSeen] = useState(open);
  // Start from the latest values each time the dialog opens.
  if (open !== seen) {
    setSeen(open);
    if (open) {
      setDescription(poll.description);
      setMultiple(poll.multiple);
      setAnonymous(poll.anonymous);
      setClosesAt(toLocalInput(poll.closes_at));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Poll settings" description="Changes apply for everyone straight away.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await updatePoll(sb, poll.id, { description, multiple, anonymous, closes_at: closesAt ? new Date(closesAt).toISOString() : null });
              onOpenChange(false);
            } catch (err) {
              toastError(err);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label="Description" hint="Optional context for voters.">
            {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} />}
          </Field>
          <label className="flex items-start gap-2.5 text-[13.5px] text-text">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Allow several choices
              <span className="block text-[12.5px] text-muted">People can vote for more than one option.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13.5px] text-text">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Anonymous
              <span className="block text-[12.5px] text-muted">Everyone sees the totals, but not who voted for what.</span>
            </span>
          </label>
          <Field label="Closes at" hint="Optional. Voting stops automatically at this time.">
            {(p) => <Input {...p} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
