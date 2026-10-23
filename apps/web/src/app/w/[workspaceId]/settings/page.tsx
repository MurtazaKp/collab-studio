import type { Metadata } from "next";
import { getWorkspaceAccess } from "@/lib/auth";
import { GeneralSettings, SettingsFrame } from "@/components/workspace/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await getWorkspaceAccess((await params).workspaceId);
  return (
    <SettingsFrame>
      <GeneralSettings />
    </SettingsFrame>
  );
}
