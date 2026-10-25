"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { profileInputSchema } from "@collabverse/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { publicEnv, safeNextPath } from "@/lib/env";
import { siteUrl } from "@/lib/site-url";
import { errorMessage } from "@/lib/utils";

export interface FormState {
  error?: string | null;
  message?: string | null;
  fieldErrors?: Record<string, string>;
}

const emailSchema = z.email("Enter a valid email address").trim().toLowerCase().max(254);
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(128);

export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (/email not confirmed/i.test(error.message)) {
      return { error: "Confirm your email address first — check your inbox for the link." };
    }
    return { error: "That email and password don't match an account." };
  }
  redirect(safeNextPath(formData.get("next")?.toString(), "/w"));
}

export async function signUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: emailSchema, password: passwordSchema, displayName: profileInputSchema.shape.displayName })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      displayName: formData.get("displayName"),
    });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { fieldErrors };
  }
  const next = safeNextPath(formData.get("next")?.toString(), "/onboarding");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: errorMessage(error, "We couldn't create your account. Please try again.") };
  if (data.session) redirect(next);
  // Email confirmation is enabled: never reveal whether the address already existed.
  return { message: `Check ${parsed.data.email} for a confirmation link to finish signing up.` };
}

export async function requestPasswordResetAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address" };
  const supabase = await createServerSupabase();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });
  // Same response whether or not the account exists.
  return { message: "If an account exists for that address, a reset link is on its way." };
}

export async function updatePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: errorMessage(error, "Couldn't update your password.") };
  redirect("/w");
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  if (!publicEnv.googleAuthEnabled) redirect("/login?error=google_disabled");
  const next = safeNextPath(formData.get("next")?.toString(), "/w");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
