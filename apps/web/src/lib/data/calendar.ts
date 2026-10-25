import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { WORKSPACE_COLORS } from "@collabverse/shared";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type CalendarEvent = Tables<"calendar_events">;

export const eventInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a title.").max(200, "Titles can be at most 200 characters."),
    description: z.string().max(2000, "The description can be at most 2000 characters.").default(""),
    location: z.string().trim().max(200, "The location can be at most 200 characters.").default(""),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    all_day: z.boolean().default(false),
    color: z.enum(WORKSPACE_COLORS).default("iris"),
    attendee_ids: z.array(z.uuid()).max(100, "Events can have up to 100 attendees.").default([]),
  })
  .refine((e) => new Date(e.ends_at) >= new Date(e.starts_at), { message: "The event must end after it starts.", path: ["ends_at"] });
export type EventInput = z.input<typeof eventInputSchema>;

/** All events of a calendar (newest few thousand), oldest first. */
export async function loadCalendarEvents(sb: Client, calendarId: string): Promise<CalendarEvent[]> {
  const { data, error } = await sb.from("calendar_events").select("*").eq("calendar_id", calendarId).order("starts_at").limit(3000);
  if (error) throw error;
  return data;
}

export async function createCalendarEvent(sb: Client, ids: { workspaceId: string; calendarId: string }, input: EventInput): Promise<CalendarEvent> {
  const v = eventInputSchema.parse(input);
  const { data, error } = await sb
    .from("calendar_events")
    .insert({ workspace_id: ids.workspaceId, calendar_id: ids.calendarId, ...v })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCalendarEvent(sb: Client, id: string, input: EventInput): Promise<void> {
  const v = eventInputSchema.parse(input);
  const { data, error } = await sb.from("calendar_events").update(v).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this event.");
}

export async function deleteCalendarEvent(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("calendar_events").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to delete this event.");
}
