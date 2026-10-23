"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { cn, errorMessage, timeAgo } from "@/lib/utils";

export function NotificationsBell() {
  const router = useRouter();
  const { me, member } = useWorkspace();
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getBrowserSupabase()
      .from("notifications")
      .select("*")
      .eq("user_id", me.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return data;
  }, [me.id]);

  const { rows, setRows } = useLiveRows({ table: "notifications", filter: `user_id=eq.${me.id}`, load });
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 30);
  const unread = sorted.filter((n) => !n.read_at).length;

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    const now = new Date().toISOString();
    setRows((cur) => cur.map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)));
    const { error } = await getBrowserSupabase().from("notifications").update({ read_at: now }).in("id", ids);
    if (error) {
      toast.error(errorMessage(error, "Couldn't mark notifications as read."));
      setRows((cur) => cur.map((n) => (ids.includes(n.id) ? { ...n, read_at: null } : n)));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="sr-only" role="status" aria-live="polite">
        {unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : ""}
      </span>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-lg p-2 text-text-2 transition-colors hover:bg-surface-3/70 hover:text-text"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-4" />
          {unread ? (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-4 font-semibold text-accent-text">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-[13.5px] font-semibold text-text">Notifications</p>
          <Button
            size="sm"
            variant="ghost"
            disabled={!unread}
            onClick={() => void markRead(sorted.filter((n) => !n.read_at).map((n) => n.id))}
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
        <ul className="max-h-[420px] overflow-y-auto">
          {sorted.length === 0 ? (
            <li className="px-4 py-10 text-center text-[13px] text-muted">You&apos;re all caught up.</li>
          ) : (
            sorted.map((n) => {
              const actor = member(n.actor_id);
              return (
                <li key={n.id}>
                  <button
                    className={cn(
                      "flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2",
                      !n.read_at && "bg-accent-soft/40",
                    )}
                    onClick={() => {
                      void markRead([n.id]);
                      setOpen(false);
                      if (n.link) router.push(n.link);
                    }}
                  >
                    <Avatar name={actor?.name ?? "CollabVerse"} color={actor?.color ?? "slate"} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-text">{n.title}</span>
                      {n.body ? <span className="mt-0.5 block truncate text-[12.5px] text-muted">{n.body}</span> : null}
                      <span className="mt-0.5 block text-[11.5px] text-muted">{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.read_at ? <span role="img" aria-label="unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
