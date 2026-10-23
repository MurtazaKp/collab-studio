import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const COLOR_VAR: Record<string, string> = {
  iris: "var(--c-iris)",
  teal: "var(--c-teal)",
  amber: "var(--c-amber)",
  rose: "var(--c-rose)",
  sky: "var(--c-sky)",
  lime: "var(--c-lime)",
  violet: "var(--c-violet)",
  slate: "var(--c-slate)",
};

/** Concrete hex colours for places CSS variables can't reach (canvas, carets). */
export const COLOR_HEX: Record<string, string> = {
  iris: "#4b4fd8",
  teal: "#12877a",
  amber: "#c47d0e",
  rose: "#cf4a6b",
  sky: "#2f8fd6",
  lime: "#4c8a1f",
  violet: "#7a4fd0",
  slate: "#5b6573",
};

export function colorVar(name: string | null | undefined): string {
  return COLOR_VAR[name ?? ""] ?? COLOR_VAR.iris!;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return new Date(iso).toLocaleString();
  const sign = diff < 0 ? -1 : 1;
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(sign * Math.max(1, Math.floor(abs / 60)), "minute");
  if (abs < 86400) return rtf.format(sign * Math.floor(abs / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(sign * Math.floor(abs / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human message for a Supabase/Postgres error without leaking internals. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const msg = typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  if (/row-level security|permission denied|42501/i.test(msg)) return "You don't have permission to do that.";
  if (/duplicate key|23505/i.test(msg)) return "That already exists.";
  if (/violates check constraint|23514/i.test(msg)) return "Some of the values aren't valid.";
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return "You're offline or the server is unreachable.";
  if (msg.length > 0 && msg.length < 140 && !/[{}<>]|sql|relation|column/i.test(msg)) return msg;
  return fallback;
}
