import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/auth-forms";
import { publicEnv, safeNextPath } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <SignUpForm next={safeNextPath(next, "/onboarding")} google={publicEnv.googleAuthEnabled} />;
}
