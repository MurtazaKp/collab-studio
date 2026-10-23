import type { Metadata } from "next";
import { Suspense } from "react";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadColumns, loadTasks } from "@/lib/data/kanban";
import { KanbanBoard } from "@/components/modules/kanban/board";

type Params = Promise<{ workspaceId: string; boardId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, boardId } = await params;
  return { title: (await getItemOr404("boards", boardId, workspaceId)).title };
}

export default async function BoardPage({ params }: { params: Params }) {
  const { workspaceId, boardId } = await params;
  await requireModule(workspaceId, "kanban");
  const board = await getItemOr404("boards", boardId, workspaceId);
  const sb = await createServerSupabase();
  const [columns, tasks] = await Promise.all([loadColumns(sb, boardId), loadTasks(sb, boardId)]);
  return (
    <Suspense>
      <KanbanBoard board={board} initialColumns={columns} initialTasks={tasks} />
    </Suspense>
  );
}
