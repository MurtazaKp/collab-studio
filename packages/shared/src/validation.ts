import { z } from "zod";
import { INVITABLE_ROLES, ROLES } from "./roles";
import { MODULE_TYPES } from "./modules";

/**
 * Input schemas shared by the web app (forms, server actions, data access) and
 * mirrored by CHECK constraints in the database, which remain authoritative.
 */

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const uuidSchema = z.uuid();

export const WORKSPACE_COLORS = [
  "iris",
  "teal",
  "amber",
  "rose",
  "sky",
  "lime",
  "violet",
  "slate",
] as const;
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

export const workspaceInputSchema = z.object({
  name: trimmed(1, 60),
  description: z.string().trim().max(280).default(""),
  icon: z.string().trim().min(1).max(8).default("✦"),
  color: z.enum(WORKSPACE_COLORS).default("iris"),
});
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;

export const profileInputSchema = z.object({
  displayName: trimmed(1, 60),
});

export const inviteInputSchema = z.object({
  workspaceId: uuidSchema,
  email: z.email().trim().toLowerCase().max(254),
  role: z.enum(INVITABLE_ROLES),
});

export const roleChangeSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema,
  role: z.enum(ROLES).exclude(["owner"]),
});

export const moduleToggleSchema = z.object({
  workspaceId: uuidSchema,
  moduleType: z.enum(MODULE_TYPES),
  enabled: z.boolean(),
});

export const titleSchema = trimmed(1, 120);

export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  // Round-trip so impossible dates like 2026-02-30 are rejected (Date.parse rolls them over).
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");

export const taskInputSchema = z.object({
  title: trimmed(1, 200),
  description: z.string().max(10_000).default(""),
  priority: z.enum(TASK_PRIORITIES).default("none"),
  dueDate: dateOnlySchema.nullable().default(null),
  assigneeId: uuidSchema.nullable().default(null),
  labels: z.array(trimmed(1, 24)).max(10).default([]),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const columnTitleSchema = trimmed(1, 60);
export const commentBodySchema = trimmed(1, 4000);
export const messageBodySchema = trimmed(1, 4000);

export const channelNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, "Use lowercase letters, numbers, - and _");

/** Only http(s) links are accepted, so `javascript:` and `data:` URLs never render. */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    // Same rule as the database CHECK: http(s)://, no whitespace.
    if (!/^https?:\/\/\S+$/i.test(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a valid http(s) URL");

export const playlistItemInputSchema = z.object({
  title: trimmed(1, 200),
  url: safeUrlSchema,
  artist: z.string().trim().max(120).default(""),
  note: z.string().trim().max(500).default(""),
});
export type PlaylistItemInput = z.infer<typeof playlistItemInputSchema>;

export const shoppingItemInputSchema = z.object({
  name: trimmed(1, 120),
  // Stored as numeric(10,2) with CHECK (quantity > 0): round, then require >= 0.01.
  quantity: z.coerce.number().transform((n) => Math.round(n * 100) / 100).pipe(z.number().min(0.01).max(9999)).default(1),
  unit: z.string().trim().max(16).default(""),
  category: z.string().trim().max(40).default(""),
  assigneeId: uuidSchema.nullable().default(null),
});
export type ShoppingItemInput = z.infer<typeof shoppingItemInputSchema>;

export const REACTION_EMOJI = ["👍", "❤️", "🎉", "😄", "👀", "🚀"] as const;
export const reactionSchema = z.enum(REACTION_EMOJI);

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/zip",
] as const;

export const attachmentInputSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((n) => !/[\\/\u0000-\u001f]/.test(n), "Invalid file name"),
  mimeType: z.enum(ATTACHMENT_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
});

/** Strip path components and unsafe characters for storage object names. */
export function safeStorageName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 120);
}
