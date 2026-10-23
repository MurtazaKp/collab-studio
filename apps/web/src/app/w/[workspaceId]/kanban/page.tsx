import type { Metadata } from "next";
import { MODULES } from "@collabverse/shared";
import { requireModule } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { ITEM_TABLE, listItems } from "@/lib/data/items";
import { ItemIndex } from "@/components/modules/item-index";

export const metadata: Metadata = { title: MODULES.kanban.label };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireModule(workspaceId, "kanban");
  const items = await listItems(await createServerSupabase(), ITEM_TABLE.kanban, workspaceId);
  return <ItemIndex module="kanban" initial={items} />;
}
