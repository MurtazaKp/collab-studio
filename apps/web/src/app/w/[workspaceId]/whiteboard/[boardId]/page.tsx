import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { Whiteboard } from "@/components/modules/whiteboard/whiteboard";

type Params = Promise<{ workspaceId: string; boardId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, boardId } = await params;
  return { title: (await getItemOr404("whiteboards", boardId, workspaceId)).title };
}

export default async function WhiteboardPage({ params }: { params: Params }) {
  const { workspaceId, boardId } = await params;
  await requireModule(workspaceId, "whiteboard");
  const board = await getItemOr404("whiteboards", boardId, workspaceId);
  return <Whiteboard board={board} />;
}
