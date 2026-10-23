import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { workspaceUsageSchema, type WorkspaceBilling } from "@/lib/billing";

/**
 * The workspace's plan, status and usage for the signed-in member, cached per
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
