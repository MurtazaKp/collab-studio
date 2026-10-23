import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { CodeEditor } from "@/components/modules/code/code-editor";

type Params = Promise<{ workspaceId: string; projectId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, projectId } = await params;
  return { title: (await getItemOr404("code_projects", projectId, workspaceId)).title };
}

export default async function CodeProjectPage({ params }: { params: Params }) {
  const { workspaceId, projectId } = await params;
  await requireModule(workspaceId, "code");
  const project = await getItemOr404("code_projects", projectId, workspaceId);
  return <CodeEditor project={project} />;
}
