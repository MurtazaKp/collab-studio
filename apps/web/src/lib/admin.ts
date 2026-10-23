import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  auditEntrySchema,
  customerDetailSchema,
  customerRowSchema,
  customerWorkspaceSchema,
  overviewSchema,
  type AuditEntry,
  type CustomerDetail,
  type CustomerRow,
  type CustomerWorkspace,
  type Overview,
} from "@/lib/admin-format";

/**
 * Data access for the platform admin console. Everything runs with the
 * signed-in admin's own session through SECURITY DEFINER RPCs that check
 * is_platform_admin() themselves; the service-role key is never used. The
 * page-level gate below only decides between rendering and a 404.
 */

/** 404 for everyone who isn't a platform admin, so the console's existence doesn't leak. */
export const requirePlatformAdmin = cache(async () => {
  const user = await requireUser("/admin");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error || data !== true) notFound();
  return user;
});

/** Hides the admin link from everyone else; never throws. */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("is_platform_admin");
  return !error && data === true;
}

function parseRows<T>(schema: z.ZodType<T>, rows: unknown, what: string): T[] {
  const parsed = z.array(schema).safeParse(rows ?? []);
  if (!parsed.success) throw new Error(`Unexpected ${what} response: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

async function admin() {
  await requirePlatformAdmin();
  return createServerSupabase();
}

export async function getOverview(): Promise<Overview> {
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) throw error;
  const [row] = parseRows(overviewSchema, data, "overview");
  if (!row) throw new Error("Overview returned no row");
  return row;
}

export interface CustomerQuery {
  search?: string;
  planId?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

export async function listCustomers(q: CustomerQuery = {}): Promise<{ rows: CustomerRow[]; total: number }> {
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_list_customers", {
    p_search: q.search ?? "",
    p_plan_id: q.planId ?? undefined,
    p_status: q.status ?? undefined,
    p_limit: q.limit ?? 25,
    p_offset: q.offset ?? 0,
  });
  if (error) throw error;
  const rows = parseRows(customerRowSchema, data, "customer list");
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/** The customer (an account), or a 404 if there is no such account. */
export async function getCustomer(userId: string): Promise<{ detail: CustomerDetail; workspaces: CustomerWorkspace[]; audit: AuditEntry[] }> {
  if (!z.uuid().safeParse(userId).success) notFound();
  const supabase = await admin();
  const [detail, workspaces, audit] = await Promise.all([
    supabase.rpc("admin_get_customer", { p_user_id: userId }),
    supabase.rpc("admin_customer_workspaces", { p_user_id: userId }),
    supabase.rpc("admin_list_audit_log", { p_user_id: userId, p_limit: 50 }),
  ]);
  if (detail.error?.code === "P0002") notFound();
  if (detail.error) throw detail.error;
  if (workspaces.error) throw workspaces.error;
  if (audit.error) throw audit.error;
  const [row] = parseRows(customerDetailSchema, detail.data, "customer");
  if (!row) notFound();
  return {
    detail: row,
    workspaces: parseRows(customerWorkspaceSchema, workspaces.data, "workspace list"),
    audit: parseRows(auditEntrySchema, audit.data, "audit log"),
  };
}

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_list_audit_log", { p_limit: limit });
  if (error) throw error;
  return parseRows(auditEntrySchema, data, "audit log");
}
