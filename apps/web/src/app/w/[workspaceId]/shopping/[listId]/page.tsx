import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadShoppingItems } from "@/lib/data/lists";
import { ShoppingView } from "@/components/modules/shopping/shopping-view";

type Params = Promise<{ workspaceId: string; listId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, listId } = await params;
  return { title: (await getItemOr404("shopping_lists", listId, workspaceId)).title };
}

export default async function ShoppingListPage({ params }: { params: Params }) {
  const { workspaceId, listId } = await params;
  await requireModule(workspaceId, "shopping");
  const list = await getItemOr404("shopping_lists", listId, workspaceId);
  const items = await loadShoppingItems(await createServerSupabase(), listId);
  return <ShoppingView list={list} initialItems={items} />;
}
