import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/auth-forms";
import { publicEnv, safeNextPath } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <SignInForm next={safeNextPath(next, "/w")} google={publicEnv.googleAuthEnabled} linkError={error} />;
}
