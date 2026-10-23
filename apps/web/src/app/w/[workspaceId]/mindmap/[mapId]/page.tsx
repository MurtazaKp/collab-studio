import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { Mindmap } from "@/components/modules/mindmap/mindmap";

type Params = Promise<{ workspaceId: string; mapId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, mapId } = await params;
  return { title: (await getItemOr404("mindmaps", mapId, workspaceId)).title };
}

export default async function MindmapPage({ params }: { params: Params }) {
  const { workspaceId, mapId } = await params;
  await requireModule(workspaceId, "mindmap");
  const map = await getItemOr404("mindmaps", mapId, workspaceId);
  return <Mindmap map={map} />;
}
