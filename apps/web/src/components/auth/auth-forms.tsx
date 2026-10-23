"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordResetAction,
  signInAction,
  signInWithGoogleAction,
  signUpAction,
  updatePasswordAction,
  type FormState,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";

const initial: FormState = {};

function Heading({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-[34px] leading-tight tracking-tight text-text">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-[14px] text-muted">{subtitle}</p> : null}
    </div>
  );
}

function GoogleButton({ next }: { next: string }) {
  return (
    <form action={signInWithGoogleAction}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="outline" size="lg" className="w-full">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
        </svg>
        Continue with Google
      </Button>
      <div className="my-5 flex items-center gap-3 text-[12px] text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
    </form>
  );
}

const LINK_ERRORS: Record<string, string> = {
  link_invalid: "That link is invalid or has expired. Request a new one.",
  oauth: "Google sign-in didn't complete. Please try again.",
  google_disabled: "Google sign-in isn't enabled for this deployment.",
};

export function SignInForm({ next, google, linkError }: { next: string; google: boolean; linkError?: string }) {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <>
      <Heading title="Welcome back" subtitle="Sign in to your workspaces." />
      {google ? <GoogleButton next={next} /> : null}
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        {linkError && LINK_ERRORS[linkError] ? <Notice tone="danger">{LINK_ERRORS[linkError]}</Notice> : null}
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}</Field>
        <Field label="Password">
          {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link href="/forgot-password" className="text-[13px] text-muted hover:text-text">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        New here?{" "}
        <Link href={`/signup${next !== "/w" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-text hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

export function SignUpForm({ next, google }: { next: string; google: boolean }) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  if (state.message) {
    return (
      <>
        <Heading title="Check your inbox" />
        <Notice tone="success">{state.message}</Notice>
        <p className="mt-6 text-[13.5px] text-muted">
          Wrong address?{" "}
          <Link href="/signup" className="font-medium text-text hover:underline">
            Start over
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      <Heading title="Create your account" subtitle="Start a workspace or join your team's." />
      {google ? <GoogleButton next={next} /> : null}
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        <Field label="Your name" error={state.fieldErrors?.displayName}>
          {(p) => <Input {...p} name="displayName" autoComplete="name" required maxLength={60} autoFocus />}
        </Field>
        <Field label="Email" error={state.fieldErrors?.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={state.fieldErrors?.password}>
          {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={8} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-text hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initial);
  return (
    <>
      <Heading title="Reset your password" subtitle="We'll email you a link to choose a new one." />
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}</Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        <Link href="/login" className="font-medium text-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);
  return (
    <>
      <Heading title="Choose a new password" />
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        <Field label="New password" hint="At least 8 characters.">
          {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus />}
        </Field>
        <Field label="Confirm password">
          {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Update password
        </Button>
      </form>
    </>
  );
}
