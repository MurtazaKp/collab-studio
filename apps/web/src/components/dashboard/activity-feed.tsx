"use client";

import Link from "next/link";
import { useCallback } from "react";
import { MODULES } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";
import { Avatar } from "@/components/ui/misc";
import { timeAgo } from "@/lib/utils";

export type ActivityEvent = Tables<"activity_events">;

const ENTITY: Record<ActivityEvent["entity_type"], { noun: string; segment?: string }> = {
  document: { noun: "document", segment: MODULES.docs.segment },
  whiteboard: { noun: "whiteboard", segment: MODULES.whiteboard.segment },
  mindmap: { noun: "mindmap", segment: MODULES.mindmap.segment },
  code_project: { noun: "code project", segment: MODULES.code.segment },
  board: { noun: "board", segment: MODULES.kanban.segment },
  task: { noun: "card" },
  channel: { noun: "channel", segment: MODULES.chat.segment },
  playlist: { noun: "playlist", segment: MODULES.playlist.segment },
  playlist_item: { noun: "track" },
  shopping_list: { noun: "to-do list", segment: MODULES.shopping.segment },
  shopping_item: { noun: "task" },
  member: { noun: "member" },
};

function describe(e: ActivityEvent): string {
  const noun = ENTITY[e.entity_type].noun;
  switch (e.verb) {
    case "joined":
      return `joined as ${e.detail || "member"}`;
    case "left":
      return "left the workspace";
    case "moved":
      return `moved “${e.title}” to ${e.detail}`;
    case "checked":
      return `checked off “${e.title}”${e.detail ? ` in ${e.detail}` : ""}`;
    case "added":
      return `added ${noun} “${e.title}”${e.detail ? ` to ${e.detail}` : ""}`;
    default:
      return `created ${noun} “${e.title}”${e.detail ? ` in ${e.detail}` : ""}`;
  }
}

export function ActivityFeed({ initial, limit = 12, compact = false }: { initial: ActivityEvent[]; limit?: number; compact?: boolean }) {
  const { workspace, member, href } = useWorkspace();
  const load = useCallback(async () => {
    const { data, error } = await getBrowserSupabase()
      .from("activity_events")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }, [workspace.id, limit]);
  const { rows } = useLiveRows({ table: "activity_events", filter: `workspace_id=eq.${workspace.id}`, load, initial });
  const events = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);

  if (!events.length) return <p className="py-6 text-center text-[13px] text-muted">Nothing has happened yet.</p>;

  return (
    <ol className="flex flex-col">
      {events.map((e) => {
        const actor = member(e.actor_id);
        const seg = ENTITY[e.entity_type].segment;
        const link = seg && e.entity_id && e.verb === "created" ? href(`${seg}/${e.entity_id}`) : null;
        const text = (
          <>
            <span className="font-medium text-text">{actor?.name ?? (e.entity_type === "member" ? e.title : "Someone")}</span>{" "}
            <span className="text-text-2">{describe(e)}</span>
          </>
        );
        return (
          <li key={e.id} className="flex gap-2.5 py-2">
            <Avatar name={actor?.name ?? e.title ?? "?"} color={actor?.color ?? "slate"} size={compact ? 20 : 24} />
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              {link ? (
                <Link href={link} className="hover:underline">
                  {text}
                </Link>
              ) : (
                text
              )}
              <p className="text-[11.5px] text-muted">{timeAgo(e.created_at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
