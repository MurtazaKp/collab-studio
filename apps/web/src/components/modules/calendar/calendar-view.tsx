"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Trash2, Users } from "lucide-react";
import { WORKSPACE_COLORS } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { toastError } from "@/lib/notify-error";
import { createCalendarEvent, deleteCalendarEvent, loadCalendarEvents, updateCalendarEvent, type CalendarEvent } from "@/lib/data/calendar";
import type { ItemRow } from "@/lib/data/items";
import { EditableTitle, useLiveItem } from "@/components/modules/collab-chrome";
import { PageHeader } from "@/components/shell/page-header";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { cn, colorVar, errorMessage } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad = (n: number) => String(n).padStart(2, "0");
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The 6 × 7 grid of days shown for a month, starting on Monday. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function eventsOn(day: Date, events: CalendarEvent[]): CalendarEvent[] {
  const from = startOfDay(day).getTime();
  const to = addDays(day, 1).getTime();
  return events.filter((e) => new Date(e.starts_at).getTime() < to && new Date(e.ends_at).getTime() >= from);
}

type Editing = { event: CalendarEvent | null; day: Date };

export function CalendarView({ calendar, initialEvents }: { calendar: ItemRow; initialEvents: CalendarEvent[] }) {
  const router = useRouter();
  const { workspace, canEdit, href } = useWorkspace();
  const sb = getBrowserSupabase();
  const { item, deleted } = useLiveItem("calendar", calendar);
  const load = useCallback(() => loadCalendarEvents(sb, calendar.id), [sb, calendar.id]);
  const { rows: events, reload, status } = useLiveRows({ table: "calendar_events", filter: `calendar_id=eq.${calendar.id}`, load, initial: initialEvents });
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editing, setEditing] = useState<Editing | null>(null);
  const today = startOfDay(new Date());
  const days = useMemo(() => monthGrid(month), [month]);
  const sorted = useMemo(() => [...events].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)), [events]);
  const upcoming = sorted.filter((e) => new Date(e.ends_at) >= new Date()).slice(0, 8);

  if (deleted) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="This calendar was deleted"
        action={<Button variant="outline" onClick={() => router.push(href("calendar"))}>Back to calendars</Button>}
      />
    );
  }

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="mx-auto max-w-6xl pb-16">
      <PageHeader
        crumbs={[{ label: workspace.name, href: href() }, { label: "Calendar", href: href("calendar") }]}
        icon={<ModuleIcon type="calendar" tile />}
        title={<EditableTitle module="calendar" item={item} editable={canEdit} />}
        meta={`${events.length} event${events.length === 1 ? "" : "s"}${status === "reconnecting" ? " · reconnecting…" : ""}`}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setEditing({ event: null, day: today })}>
              <Plus className="size-4" /> New event
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 px-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:px-10">
        <section aria-label="Month" className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1 font-display text-[24px] leading-none tracking-tight text-text" aria-live="polite">
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </h2>
            <Button variant="outline" size="sm" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="grid grid-cols-7 border-b border-border bg-surface-2/60 text-center text-[11.5px] font-medium text-muted">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const list = eventsOn(day, sorted);
                const inMonth = day.getMonth() === month.getMonth();
                const isToday = sameDay(day, today);
                return (
                  <div
                    key={i}
                    className={cn(
                      "group relative min-h-24 border-b border-border p-1.5 [&:nth-child(7n)]:border-r-0",
                      "border-r",
                      !inMonth && "bg-surface-2/40",
                      i >= 35 && "border-b-0",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full text-[12px] tabular-nums",
                          isToday ? "bg-accent font-semibold text-accent-text" : inMonth ? "text-text" : "text-muted",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {canEdit ? (
                        <button
                          type="button"
                          aria-label={`Add event on ${day.toLocaleDateString()}`}
                          onClick={() => setEditing({ event: null, day })}
                          className="hidden rounded p-0.5 text-muted group-focus-within:block group-hover:block hover:bg-surface-2 hover:text-text"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {list.slice(0, 3).map((e) => (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setEditing({ event: e, day })}
                            className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11.5px] text-text hover:brightness-95"
                            style={{ background: `color-mix(in oklab, ${colorVar(e.color)} 18%, transparent)` }}
                          >
                            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: colorVar(e.color) }} />
                            {!e.all_day && sameDay(new Date(e.starts_at), day) ? <span className="text-text-2 tabular-nums">{timeLabel(e.starts_at)}</span> : null}
                            <span className="truncate">{e.title}</span>
                          </button>
                        </li>
                      ))}
                      {list.length > 3 ? <li className="px-1 text-[11px] text-muted">+{list.length - 3} more</li> : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside aria-labelledby="upcoming" className="min-w-0">
          <h2 id="upcoming" className="mb-3 text-[14px] font-semibold text-text">
            Upcoming
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing scheduled.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ event: e, day: new Date(e.starts_at) })}
                    className="w-full rounded-xl border border-border bg-surface p-3 text-left shadow-sm transition-colors hover:border-border-strong"
                  >
                    <p className="flex items-center gap-2 truncate text-[13.5px] font-medium text-text">
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorVar(e.color) }} />
                      {e.title}
                    </p>
                    <p className="mt-1 text-[12px] text-muted">
                      {new Date(e.starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      {e.all_day ? " · all day" : ` · ${timeLabel(e.starts_at)}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {editing ? (
        <EventDialog
          key={editing.event?.id ?? `new-${editing.day.toISOString()}`}
          editing={editing}
          calendarId={calendar.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

function EventDialog({ editing, calendarId, onClose, onSaved }: { editing: Editing; calendarId: string; onClose: () => void; onSaved: () => void }) {
  const { workspace, canEdit, members, me } = useWorkspace();
  const sb = getBrowserSupabase();
  const e = editing.event;
  const start = e ? new Date(e.starts_at) : (() => {
    const d = new Date(editing.day);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const end = e ? new Date(e.ends_at) : new Date(start.getTime() + 60 * 60_000);
  const [title, setTitle] = useState(e?.title ?? "");
  const [allDay, setAllDay] = useState(e?.all_day ?? false);
  const [startDate, setStartDate] = useState(dateInput(start));
  const [startTime, setStartTime] = useState(timeInput(start));
  const [endDate, setEndDate] = useState(dateInput(end));
  const [endTime, setEndTime] = useState(timeInput(end));
  const [location, setLocation] = useState(e?.location ?? "");
  const [description, setDescription] = useState(e?.description ?? "");
  const [color, setColor] = useState<string>(e?.color ?? "iris");
  const [attendees, setAttendees] = useState<string[]>(e?.attendee_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = !canEdit;

  const save = async () => {
    setError(null);
    const s = allDay ? new Date(`${startDate}T00:00`) : new Date(`${startDate}T${startTime}`);
    const en = allDay ? new Date(`${endDate}T23:59:59`) : new Date(`${endDate}T${endTime}`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) {
      setError("Enter a valid start and end.");
      return;
    }
    const input = {
      title,
      description,
      location,
      starts_at: s.toISOString(),
      ends_at: en.toISOString(),
      all_day: allDay,
      color: color as (typeof WORKSPACE_COLORS)[number],
      attendee_ids: attendees,
    };
    setSaving(true);
    try {
      if (e) await updateCalendarEvent(sb, e.id, input);
      else await createCalendarEvent(sb, { workspaceId: workspace.id, calendarId }, input);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={readOnly ? (e?.title ?? "Event") : e ? "Edit event" : "New event"} wide>
        <form
          className="flex flex-col gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!readOnly) void save();
          }}
        >
          {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
          <Field label="Title">
            {(p) => <Input {...p} value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={200} required autoFocus={!readOnly} disabled={readOnly} />}
          </Field>
          <label className="flex items-center gap-2 text-[13.5px] text-text">
            <input type="checkbox" checked={allDay} onChange={(ev) => setAllDay(ev.target.checked)} disabled={readOnly} className="size-4 accent-[var(--accent)]" />
            All day
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-text-2">
                <Clock aria-hidden className="size-3.5" /> Starts
              </legend>
              <div className="flex gap-2">
                <Input type="date" aria-label="Start date" value={startDate} onChange={(ev) => setStartDate(ev.target.value)} disabled={readOnly} required />
                {!allDay ? <Input type="time" aria-label="Start time" value={startTime} onChange={(ev) => setStartTime(ev.target.value)} disabled={readOnly} required /> : null}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[13px] font-medium text-text-2">Ends</legend>
              <div className="flex gap-2">
                <Input type="date" aria-label="End date" value={endDate} onChange={(ev) => setEndDate(ev.target.value)} disabled={readOnly} required />
                {!allDay ? <Input type="time" aria-label="End time" value={endTime} onChange={(ev) => setEndTime(ev.target.value)} disabled={readOnly} required /> : null}
              </div>
            </fieldset>
          </div>
          <Field label="Location">
            {(p) => (
              <div className="relative">
                <MapPin aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
                <Input {...p} value={location} onChange={(ev) => setLocation(ev.target.value)} maxLength={200} placeholder="Room, address or link" className="pl-8" disabled={readOnly} />
              </div>
            )}
          </Field>
          <Field label="Notes">
            {(p) => <Textarea {...p} value={description} onChange={(ev) => setDescription(ev.target.value)} maxLength={2000} rows={3} disabled={readOnly} />}
          </Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-text-2">Colour</legend>
            <div className="flex gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  disabled={readOnly}
                  onClick={() => setColor(c)}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-text")}
                  style={{ background: colorVar(c) }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-text-2">
              <Users aria-hidden className="size-3.5" /> Attendees
              <span className="font-normal text-muted">· they get a notification</span>
            </legend>
            <ul className="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">
              {members.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-text hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={attendees.includes(m.userId)}
                      disabled={readOnly}
                      onChange={(ev) => setAttendees((cur) => (ev.target.checked ? [...cur, m.userId] : cur.filter((x) => x !== m.userId)))}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <Avatar name={m.name} color={m.color} size={20} />
                    <span className="truncate">
                      {m.name}
                      {m.userId === me.id ? <span className="text-muted"> (you)</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <DialogFooter>
            {e && !readOnly ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-danger"
                onClick={async () => {
                  try {
                    await deleteCalendarEvent(sb, e.id);
                    onSaved();
                  } catch (err) {
                    toastError(err);
                  }
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly ? (
              <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
                {e ? "Save" : "Add event"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
