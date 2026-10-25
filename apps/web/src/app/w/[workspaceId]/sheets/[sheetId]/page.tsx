import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadSheetCells } from "@/lib/data/sheets";
import { SheetView } from "@/components/modules/sheets/sheet-view";

type Params = Promise<{ workspaceId: string; sheetId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, sheetId } = await params;
  return { title: (await getItemOr404("sheets", sheetId, workspaceId)).title };
}

export default async function SheetPage({ params }: { params: Params }) {
  const { workspaceId, sheetId } = await params;
  await requireModule(workspaceId, "sheets");
  const sheet = await getItemOr404("sheets", sheetId, workspaceId);
  const cells = await loadSheetCells(await createServerSupabase(), sheetId);
  return <SheetView sheet={sheet} initialCells={cells} />;
}
