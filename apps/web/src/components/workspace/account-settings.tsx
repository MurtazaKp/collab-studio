"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { WORKSPACE_COLORS } from "@collabverse/shared";
import { updateProfileAction } from "@/app/actions/workspace";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Avatar } from "@/components/ui/misc";
import { ThemeSwitcher } from "@/components/shell/theme";
import { cn, colorVar } from "@/lib/utils";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-7 first:border-t-0">
      <h2 className="text-[15px] font-semibold text-text">{title}</h2>
      {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AccountSettings({ email, displayName, avatarColor }: { email: string; displayName: string; avatarColor: string }) {
  const [name, setName] = useState(displayName);
  const [color, setColor] = useState(avatarColor);
  const [pending, start] = useTransition();
  const dirty = name.trim() !== displayName || color !== avatarColor;

  return (
    <div className="mt-6">
      <Section title="Profile" description="How you appear to collaborators.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateProfileAction({ displayName: name, avatarColor: color });
              if (res.ok) toast.success("Profile updated");
              else toast.error(res.error);
            });
          }}
        >
          <div className="flex items-center gap-4">
            <Avatar name={name || "?"} color={color} size={48} />
            <div className="flex gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Avatar colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-bg", color === c && "ring-2 ring-text")}
                  style={{ background: colorVar(c) }}
                />
              ))}
            </div>
          </div>
          <Field label="Display name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
          <Field label="Email" hint="Used for sign-in and invitations.">
            {(p) => <Input {...p} value={email} readOnly disabled />}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={pending} disabled={!dirty || !name.trim()}>
              Save changes
            </Button>
          </div>
        </form>
      </Section>
      <Section title="Appearance">
        <ThemeSwitcher />
      </Section>
      <Section title="Password" description="We'll email you a secure link to set a new password.">
        <Link href="/forgot-password">
          <Button variant="outline">Change password</Button>
        </Link>
      </Section>
      <Section title="Session">
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </Section>
    </div>
  );
}
