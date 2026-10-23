"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { canEdit, canManage, type ModuleType, type Role } from "@collabverse/shared";
import { COLOR_HEX } from "@/lib/utils";
import type { WorkspaceBilling } from "@/lib/billing";

export interface WorkspaceMember {
  userId: string;
  name: string;
  color: string;
  role: Role;
  email: string | null;
}

export interface WorkspaceModuleInfo {
  type: ModuleType;
  enabled: boolean;
  config: { pinnedId?: string | null };
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  ownerId: string;
}

export interface WorkspaceContextValue {
  workspace: WorkspaceInfo;
  role: Role;
  /** Members and above, unless the workspace is read-only (suspended or canceled). */
  canEdit: boolean;
  canManage: boolean;
  /** Plan, status and usage; null if it couldn't be loaded. */
  billing: WorkspaceBilling | null;
  readOnly: boolean;
  me: { id: string; name: string; color: string; hex: string };
  members: WorkspaceMember[];
  modules: WorkspaceModuleInfo[];
  enabledModules: ModuleType[];
  member(id: string | null | undefined): WorkspaceMember | undefined;
  href(path?: string): string;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspace,
  role,
  me,
  members,
  modules,
  billing = null,
  children,
}: {
  workspace: WorkspaceInfo;
  role: Role;
  me: { id: string; name: string; color: string };
  members: WorkspaceMember[];
  modules: WorkspaceModuleInfo[];
  billing?: WorkspaceBilling | null;
  children: ReactNode;
}) {
  const value = useMemo<WorkspaceContextValue>(() => {
    const byId = new Map(members.map((m) => [m.userId, m]));
    const readOnly = billing ? !billing.writable : false;
    return {
      workspace,
      role,
      canEdit: canEdit(role) && !readOnly,
      canManage: canManage(role),
      billing,
      readOnly,
      me: { ...me, hex: COLOR_HEX[me.color] ?? COLOR_HEX.iris! },
      members,
      modules,
      enabledModules: modules.filter((m) => m.enabled).map((m) => m.type),
      member: (id) => (id ? byId.get(id) : undefined),
      href: (path = "") => `/w/${workspace.id}${path ? `/${path.replace(/^\//, "")}` : ""}`,
    };
  }, [workspace, role, me, members, modules, billing]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
