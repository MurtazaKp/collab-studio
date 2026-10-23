"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Activity, Check, ChevronsUpDown, LayoutGrid, LogOut, Mail, Plus, Settings, UserRound } from "lucide-react";
import { MODULES, ROLE_LABELS, type Role } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { usePresence } from "@/lib/realtime/presence";
import { signOutAction } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/menu";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WorkspaceForm } from "@/components/workspace/onboarding";
import { cn, colorVar } from "@/lib/utils";
import { NotificationsBell } from "./notifications";

export interface SwitcherWorkspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  role: Role;
}

function NavLink({
  href,
  active,
  icon,
  children,
  trailing,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
        active ? "bg-surface font-medium text-text shadow-sm" : "text-text-2 hover:bg-surface-3/60 hover:text-text",
      )}
    >
      <span className="flex size-4 items-center justify-center [&>svg]:size-4">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}

export function Sidebar({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { workspace, role, me, enabledModules, href, members } = useWorkspace();
  const { online } = usePresence();
  const [creating, setCreating] = useState(false);

  const base = href();
  const isActive = (p: string) => (p === base ? pathname === base : pathname === p || pathname.startsWith(`${p}/`));

  const onlineIds = useMemo(() => new Set(online.map((o) => o.userId)), [online]);
  const hereBySegment = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }[]>();
    for (const o of online) {
      if (o.userId === me.id) continue;
      const seg = o.location.split("/")[0] ?? "";
      map.set(seg, [...(map.get(seg) ?? []), { id: o.userId, name: o.name, color: o.color }]);
    }
    return map;
  }, [online, me.id]);

  const onlineMembers = members.filter((m) => onlineIds.has(m.userId));

  return (
    <aside className="flex h-full flex-col border-r border-border bg-surface-2">
      <div className="p-2.5">
        <Menu>
          <MenuTrigger asChild>
            <button
              className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-3/70"
              aria-label="Switch workspace"
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[15px] text-white shadow-sm"
                style={{ background: colorVar(workspace.color) }}
              >
                {workspace.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-text">{workspace.name}</span>
                <span className="block text-[11.5px] text-muted">{ROLE_LABELS[role]}</span>
              </span>
              <ChevronsUpDown className="size-4 text-muted" />
            </button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <MenuLabel>Workspaces</MenuLabel>
            {workspaces.map((w) => (
              <MenuItem key={w.id} onSelect={() => router.push(`/w/${w.id}`)}>
                <span className="flex size-5 items-center justify-center rounded text-[11px] text-white" style={{ background: colorVar(w.color) }}>
                  {w.icon}
                </span>
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === workspace.id ? <Check className="size-4 text-accent" /> : null}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<LayoutGrid />} onSelect={() => router.push("/w")}>
              All workspaces
            </MenuItem>
            <MenuItem icon={<Plus />} onSelect={() => setCreating(true)}>
              New workspace
            </MenuItem>
            <MenuItem icon={<Mail />} onSelect={() => router.push("/invitations")}>
              Invitations
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Workspace">
        <div className="flex flex-col gap-0.5">
          <NavLink href={base} active={isActive(base)} icon={<LayoutGrid className="text-muted" />}>
            Dashboard
          </NavLink>
          <NavLink href={href("activity")} active={isActive(href("activity"))} icon={<Activity className="text-muted" />}>
            Activity
          </NavLink>
          <NavLink href={href("settings")} active={isActive(href("settings"))} icon={<Settings className="text-muted" />}>
            Settings
          </NavLink>
        </div>

        <p className="mt-5 mb-1.5 px-2 text-[11px] font-medium tracking-wide text-muted uppercase">Modules</p>
        <div className="flex flex-col gap-0.5">
          {enabledModules.map((type) => {
            const seg = MODULES[type].segment;
            const here = hereBySegment.get(seg) ?? [];
            return (
              <NavLink
                key={type}
                href={href(seg)}
                active={isActive(href(seg))}
                icon={<ModuleIcon type={type} />}
                trailing={
                  here.length ? (
                    <Tooltip label={`${here.map((h) => h.name).join(", ")} here now`}>
                      <span className="flex -space-x-1">
                        {here.slice(0, 3).map((h) => (
                          <Avatar key={h.id} name={h.name} color={h.color} size={16} ring />
                        ))}
                      </span>
                    </Tooltip>
                  ) : null
                }
              >
                {MODULES[type].label}
              </NavLink>
            );
          })}
          {enabledModules.length === 0 ? <p className="px-2 py-1 text-[12.5px] text-muted">No modules enabled.</p> : null}
        </div>

        <p className="mt-5 mb-1.5 flex items-center justify-between px-2 text-[11px] font-medium tracking-wide text-muted uppercase">
          <span>Online</span>
          <span className="font-mono tracking-normal normal-case">
            {onlineMembers.length}/{members.length}
          </span>
        </p>
        <ul className="flex flex-col gap-0.5">
          {members.slice(0, 12).map((m) => (
            <li key={m.userId} className="flex h-7 items-center gap-2 px-2 text-[13px] text-text-2">
              <Avatar name={m.name} color={m.color} size={20} online={onlineIds.has(m.userId)} />
              <span className={cn("truncate", !onlineIds.has(m.userId) && "text-muted")}>
                {m.name}
                {m.userId === me.id ? " (you)" : ""}
              </span>
            </li>
          ))}
          {members.length > 12 ? (
            <li className="px-2 text-[12px] text-muted">
              <Link href={href("settings/members")} className="hover:text-text">
                +{members.length - 12} more
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>

      <div className="flex items-center gap-1 border-t border-border p-2.5">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-surface-3/70" aria-label="Account menu">
              <Avatar name={me.name} color={me.color} size={26} />
              <span className="truncate text-[13px] font-medium text-text">{me.name}</span>
            </button>
          </MenuTrigger>
          <MenuContent side="top" className="w-52">
            <MenuItem icon={<UserRound />} onSelect={() => router.push("/account")}>
              Account &amp; appearance
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onSelect={() => void signOutAction()}>
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
        <NotificationsBell />
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New workspace" description="Workspaces keep their own members, modules and content." wide>
          <WorkspaceForm
            onCreated={(id) => {
              setCreating(false);
              router.push(`/w/${id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </aside>
  );
}
