import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { SUBSCRIPTION_STATUSES, workspaceUsageSchema, type WorkspaceBilling, type WorkspaceWriteState } from "@/lib/billing";

/**
 * The workspace's plan, status and usage, for its owner and admins only (the
 * database refuses everyone else), cached per
 * request so the layout and settings page share one query. Null if it can't
 * be loaded (the database still enforces every limit either way).
 */
export const getWorkspaceBilling = cache(async (workspaceId: string): Promise<WorkspaceBilling | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("workspace_usage", { p_workspace_id: workspaceId });
  if (error) {
    console.error("workspace_usage failed", { workspaceId, code: error.code, message: error.message });
    return null;
  }
  const parsed = workspaceUsageSchema.safeParse(data?.[0]);
  if (!parsed.success) {
    console.error("workspace_usage returned an unexpected shape", { workspaceId, issues: parsed.error.issues.slice(0, 3) });
    return null;
  }
  return parsed.data;
});

/**
 * Whether the workspace can be changed right now, and its account status, for
 * every member (drives the read-only banner). Carries no plan details. Null if
 * it can't be loaded; the database still enforces read-only either way.
 */
export const getWorkspaceWriteState = cache(async (workspaceId: string): Promise<WorkspaceWriteState | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("workspace_write_state", { p_workspace_id: workspaceId });
  const row = data?.[0];
  if (error || !row) {
    if (error) console.error("workspace_write_state failed", { workspaceId, code: error.code, message: error.message });
    return null;
  }
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(row.status) ? (row.status as WorkspaceWriteState["status"]) : "active";
  return { writable: row.writable, status };
});
