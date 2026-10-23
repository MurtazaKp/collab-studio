"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Crown, LogOut, MoreHorizontal, Trash2, UserMinus } from "lucide-react";
import {
  INVITABLE_ROLES,
  MODULES,
  MODULE_TYPES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  WORKSPACE_COLORS,
  canChangeRole,
  type Role,
} from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { usePresence } from "@/lib/realtime/presence";
import {
  changeRoleAction,
  deleteWorkspaceAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  setModuleEnabledAction,
  transferOwnershipAction,
  updateWorkspaceAction,
} from "@/app/actions/workspace";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Avatar, Badge, Notice } from "@/components/ui/misc";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { cn, colorVar, timeAgo } from "@/lib/utils";
import { toastError } from "@/lib/notify-error";
import { planErrorKind } from "@/lib/plan-errors";
import { PlanUsageCard } from "./plan-usage-card";

export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const { workspace, href } = useWorkspace();
  const pathname = usePathname();
  const tabs = [
    { label: "General", path: href("settings") },
    { label: "Members", path: href("settings/members") },
  ];
  return (
    <div className="mx-auto max-w-3xl pb-20">
      <PageHeader crumbs={[{ label: workspace.name, href: href() }, { label: "Settings" }]} title="Settings" />
      <nav className="mx-6 mb-6 flex gap-1 border-b border-border lg:mx-10" aria-label="Settings sections">
        {tabs.map((t) => (
          <Link
            key={t.path}
            href={t.path}
            aria-current={pathname === t.path ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2.5 text-[13.5px] font-medium transition-colors",
              pathname === t.path ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="px-6 lg:px-10">{children}</div>
    </div>
  );
}

function Card({ title, description, children, tone }: { title: string; description?: string; children: React.ReactNode; tone?: "danger" }) {
  return (
    <section className={cn("mb-6 rounded-2xl border bg-surface p-5 shadow-sm", tone === "danger" ? "border-danger/30" : "border-border")}>
      <h2 className={cn("text-[15px] font-semibold", tone === "danger" ? "text-danger" : "text-text")}>{title}</h2>
      {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function GeneralSettings() {
  const router = useRouter();
  const { workspace, canManage, role, modules, me, billing } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description);
  const [icon, setIcon] = useState(workspace.icon);
  const [color, setColor] = useState(workspace.color);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [leaving, setLeaving] = useState(false);
  const dirty = name !== workspace.name || description !== workspace.description || icon !== workspace.icon || color !== workspace.color;

  return (
    <>
      <PlanUsageCard billing={billing} />

      <Card title="Workspace" description={canManage ? "Name, description and appearance." : "Only owners and admins can change these."}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateWorkspaceAction(workspace.id, { name, description, icon, color });
              if (res.ok) {
                toast.success("Workspace updated");
                router.refresh();
              } else toastError(res.error);
            });
          }}
        >
          <div className="flex items-end gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg text-white" style={{ background: colorVar(color) }} aria-hidden>
              {icon}
            </span>
            <Field label="Icon" className="w-20">
              {(p) => <Input {...p} value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} disabled={!canManage} />}
            </Field>
            <Field label="Name" className="flex-1">
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!canManage} required />}
            </Field>
          </div>
          <Field label="Description">{(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} rows={2} disabled={!canManage} />}</Field>
          <div className="flex gap-2" role="radiogroup" aria-label="Colour">
            {WORKSPACE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                disabled={!canManage}
                onClick={() => setColor(c)}
                className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-text")}
                style={{ background: colorVar(c) }}
              />
            ))}
          </div>
          {canManage ? (
            <div>
              <Button type="submit" variant="primary" loading={pending} disabled={!dirty || !name.trim()}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </Card>

      <Card title="Modules" description={canManage ? "Enabled modules show up in the sidebar and dashboard for everyone. Disabling keeps the data." : "Only owners and admins can change modules."}>
        <ul className="divide-y divide-border">
          {MODULE_TYPES.map((m) => {
            const mod = modules.find((x) => x.type === m);
            const onPlan = !billing || billing.modules.includes(m);
            return <ModuleRow key={m} type={m} enabled={Boolean(mod?.enabled)} editable={canManage} onPlan={onPlan} />;
          })}
        </ul>
      </Card>

      {role === "owner" ? (
        <Card title="Delete workspace" description="Permanently deletes the workspace, all its content and memberships. This cannot be undone." tone="danger">
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> Delete workspace
          </Button>
        </Card>
      ) : (
        <Card title="Leave workspace" description="You'll lose access until someone invites you again." tone="danger">
          <Button variant="outline" className="text-danger" onClick={() => setLeaving(true)}>
            <LogOut className="size-4" /> Leave workspace
          </Button>
        </Card>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={`Delete ${workspace.name}?`} description="Type the workspace name to confirm.">
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Workspace name" placeholder={workspace.name} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmName !== workspace.name}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteWorkspaceAction(workspace.id, confirmName);
                  if (res && !res.ok) toastError(res.error);
                })
              }
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave ${workspace.name}?`}
        confirmLabel="Leave"
        destructive
        onConfirm={async () => {
          const res = await removeMemberAction(workspace.id, me.id);
          if (res && !res.ok) throw new Error(res.error);
        }}
      />
    </>
  );
}

function ModuleRow({
  type,
  enabled,
  editable,
  onPlan,
}: {
  type: (typeof MODULE_TYPES)[number];
  enabled: boolean;
  editable: boolean;
  /** False when the plan doesn't include the module: it can be switched off, not on. */
  onPlan: boolean;
}) {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  if (!busy && on !== enabled) setOn(enabled);
  return (
    <li className="flex items-center gap-3 py-3">
      <ModuleIcon type={type} tile />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-text">
          {MODULES[type].label}
          {onPlan ? null : <Badge tone="accent">Team</Badge>}
        </p>
        <p className="truncate text-[12.5px] text-muted">{MODULES[type].description}</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={`${MODULES[type].label} ${on ? "enabled" : "disabled"}`}
        disabled={!editable || busy || (!onPlan && !on)}
        title={!onPlan && !on ? `${MODULES[type].label} is included with Team and Business` : undefined}
        onClick={async () => {
          const next = !on;
          setOn(next);
          setBusy(true);
          const res = await setModuleEnabledAction({ workspaceId: workspace.id, moduleType: type, enabled: next });
          setBusy(false);
          if (!res.ok) {
            setOn(!next);
            toastError(res.error);
          } else router.refresh();
        }}
        className={cn("relative h-5.5 w-9.5 shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-accent" : "bg-surface-3")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4.5 rounded-full bg-white shadow-sm transition-transform", on && "translate-x-4")} />
      </button>
    </li>
  );
}

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

export function MembersSettings({ invitations }: { invitations: InvitationRow[] }) {
  const router = useRouter();
  const { workspace, members, me, role: myRole, canManage, billing } = useWorkspace();
  const seats = billing?.maxMembers ? ` ${members.length} of ${billing.maxMembers} people on ${billing.planName}.` : "";
  const { online } = usePresence();
  const onlineIds = new Set(online.map((o) => o.userId));
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<{ kind: "remove" | "transfer"; userId: string; name: string } | null>(null);

  return (
    <>
      {canManage ? (
        <Card
          title="Invite people"
          description={`Invitations are tied to an email address and expire after 7 days. The recipient must sign in with that address.${seats}`}
        >
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              setLink(null);
              start(async () => {
                const res = await inviteMemberAction({ workspaceId: workspace.id, email, role: inviteRole });
                if (!res.ok) {
                  if (planErrorKind(res.error)) toastError(res.error);
                  else setError(res.error);
                } else {
                  setLink(res.data.link);
                  setEmail("");
                  router.refresh();
                }
              });
            }}
          >
            <Field label="Email" className="min-w-56 flex-1">
              {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="teammate@company.com" />}
            </Field>
            <Field label="Role" className="w-36">
              {(p) => (
                <Select {...p} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" variant="primary" loading={pending}>
              Create invite
            </Button>
          </form>
          {error ? <Notice tone="danger" className="mt-3">{error}</Notice> : null}
          {link ? (
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] text-text-2">
                Share this link with them. It&apos;s shown only once — anyone signed in with the invited email can use it.
              </p>
              <div className="mt-2 flex gap-2">
                <Input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-[12px]" />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="size-4" /> Copy
                </Button>
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-[12px] text-muted">
            {INVITABLE_ROLES.map((r) => `${ROLE_LABELS[r]}: ${ROLE_DESCRIPTIONS[r]}`).join(" ")}
          </p>
        </Card>
      ) : null}

      <Card title={`Members · ${members.length}`}>
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const isMe = m.userId === me.id;
            const assignable = (["admin", "member", "viewer"] as Role[]).filter((r) => canChangeRole(myRole, m.role, r));
            return (
              <li key={m.userId} className="flex items-center gap-3 py-3">
                <Avatar name={m.name} color={m.color} size={32} online={onlineIds.has(m.userId)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-text">
                    {m.name}
                    {isMe ? <span className="text-muted"> (you)</span> : null}
                  </p>
                  {m.email ? <p className="truncate text-[12.5px] text-muted">{m.email}</p> : null}
                </div>
                {m.role === "owner" ? (
                  <Badge tone="accent">
                    <Crown className="size-3" /> Owner
                  </Badge>
                ) : canManage && !isMe ? (
                  <Select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    className="w-32"
                    onChange={async (e) => {
                      const res = await changeRoleAction({ workspaceId: workspace.id, userId: m.userId, role: e.target.value });
                      if (!res.ok) toastError(res.error);
                      else {
                        toast.success(`${m.name} is now ${ROLE_LABELS[e.target.value as Role]}`);
                        router.refresh();
                      }
                    }}
                  >
                    {assignable.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge>{ROLE_LABELS[m.role]}</Badge>
                )}
                {!isMe && (canManage || myRole === "owner") && m.role !== "owner" ? (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${m.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      {myRole === "owner" ? (
                        <>
                          <MenuItem icon={<Crown />} onSelect={() => setConfirm({ kind: "transfer", userId: m.userId, name: m.name })}>
                            Make owner
                          </MenuItem>
                          <MenuSeparator />
                        </>
                      ) : null}
                      <MenuItem icon={<UserMinus />} destructive onSelect={() => setConfirm({ kind: "remove", userId: m.userId, name: m.name })}>
                        Remove from workspace
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {canManage ? (
        <Card title={`Pending invitations · ${invitations.length}`}>
          {invitations.length === 0 ? (
            <p className="text-[13px] text-muted">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-text">{inv.email}</p>
                    <p className="text-[12px] text-muted">
                      {ROLE_LABELS[inv.role as Role] ?? inv.role} · sent {timeAgo(inv.created_at)} · expires {timeAgo(inv.expires_at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const res = await revokeInvitationAction(workspace.id, inv.id);
                      if (!res.ok) toastError(res.error);
                      else router.refresh();
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "transfer" ? `Make ${confirm.name} the owner?` : `Remove ${confirm?.name}?`}
        description={
          confirm?.kind === "transfer"
            ? "They'll get full control, including deleting the workspace. You'll become an admin."
            : "They'll lose access immediately, including any open documents and boards."
        }
        confirmLabel={confirm?.kind === "transfer" ? "Transfer ownership" : "Remove"}
        destructive
        onConfirm={async () => {
          if (!confirm) return;
          const res = confirm.kind === "transfer" ? await transferOwnershipAction(workspace.id, confirm.userId) : await removeMemberAction(workspace.id, confirm.userId);
          if (res && !res.ok) throw new Error(res.error);
          router.refresh();
        }}
      />
    </>
  );
}
