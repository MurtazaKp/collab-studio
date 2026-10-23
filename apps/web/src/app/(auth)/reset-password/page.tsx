import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "New password" };

export default async function ResetPasswordPage() {
  await requireUser();
  return <ResetPasswordForm />;
}
