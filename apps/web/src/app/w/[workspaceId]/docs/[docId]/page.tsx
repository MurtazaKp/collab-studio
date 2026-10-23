import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { DocEditor } from "@/components/modules/docs/doc-editor";

type Params = Promise<{ workspaceId: string; docId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, docId } = await params;
  const doc = await getItemOr404("documents", docId, workspaceId);
  return { title: doc.title };
}

export default async function DocumentPage({ params }: { params: Params }) {
  const { workspaceId, docId } = await params;
  await requireModule(workspaceId, "docs");
  const doc = await getItemOr404("documents", docId, workspaceId);
  return <DocEditor doc={doc} />;
}
