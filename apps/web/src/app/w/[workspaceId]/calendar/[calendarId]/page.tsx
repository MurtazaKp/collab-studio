import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadCalendarEvents } from "@/lib/data/calendar";
import { CalendarView } from "@/components/modules/calendar/calendar-view";

type Params = Promise<{ workspaceId: string; calendarId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, calendarId } = await params;
  return { title: (await getItemOr404("calendars", calendarId, workspaceId)).title };
}

export default async function CalendarPage({ params }: { params: Params }) {
  const { workspaceId, calendarId } = await params;
  await requireModule(workspaceId, "calendar");
  const calendar = await getItemOr404("calendars", calendarId, workspaceId);
  const events = await loadCalendarEvents(await createServerSupabase(), calendarId);
  return <CalendarView calendar={calendar} initialEvents={events} />;
}
