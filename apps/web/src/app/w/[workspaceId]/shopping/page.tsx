import type { Metadata } from "next";
import { MODULES } from "@collabverse/shared";
import { requireModule } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { ITEM_TABLE, listItems } from "@/lib/data/items";
import { ItemIndex } from "@/components/modules/item-index";

export const metadata: Metadata = { title: MODULES.shopping.label };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireModule(workspaceId, "shopping");
  const items = await listItems(await createServerSupabase(), ITEM_TABLE.shopping, workspaceId);
  return <ItemIndex module="shopping" initial={items} />;
}
