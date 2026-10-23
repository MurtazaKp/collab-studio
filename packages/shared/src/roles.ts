export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invitation may grant. Ownership is only ever transferred. */
export const INVITABLE_ROLES = ["admin", "member", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[minimum];
}

/** Members and above may change shared content. */
export function canEdit(role: Role | null | undefined): boolean {
  return roleAtLeast(role, "member");
}

/** Owners and admins manage settings, members and modules. */
export function canManage(role: Role | null | undefined): boolean {
  return roleAtLeast(role, "admin");
}

export function isOwner(role: Role | null | undefined): boolean {
  return role === "owner";
}

/**
 * Whether `actor` may assign `target` the role `next`. Mirrors the checks in the
 * `update_member_role` database function, which is the authoritative version.
 */
export function canChangeRole(actor: Role, target: Role, next: Role): boolean {
  if (!canManage(actor)) return false;
  if (target === "owner" || next === "owner") return false;
  if (actor === "admin" && target === "admin" && next !== "admin") return true;
  return true;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full control, including deleting the workspace and transferring ownership.",
  admin: "Manage settings, members and modules.",
  member: "View and edit shared content.",
  viewer: "Read-only access.",
};
