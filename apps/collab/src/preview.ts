import * as Y from "yjs";
import type { RoomKind } from "@collabverse/shared";
import { readWhiteboard } from "@collabverse/shared/whiteboard";
import { normalizeMindmap, readMindmap, MINDMAP_ROOT_ID } from "@collabverse/shared/mindmap";
import { readFiles } from "@collabverse/shared/code";

const MAX = 500;

/** Plain text of a Tiptap/ProseMirror Y.XmlFragment, one line per block. */
export function xmlFragmentText(fragment: Y.XmlFragment): string {
  const lines: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook, line: string[]): void => {
    if (node instanceof Y.XmlText) {
      line.push(node.toString().replace(/<[^>]+>/g, ""));
    } else if (node instanceof Y.XmlElement) {
      const isBlock = node.nodeName !== "text" && node.length >= 0;
      const inner: string[] = [];
      node.toArray().forEach((child) => walk(child as Y.XmlElement | Y.XmlText, inner));
      if (isBlock && ["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock"].includes(node.nodeName)) {
        const text = inner.join("").trim();
        if (text) lines.push(text);
      } else {
        line.push(...inner);
      }
    }
  };
  fragment.toArray().forEach((child) => {
    const line: string[] = [];
    walk(child as Y.XmlElement | Y.XmlText, line);
    const text = line.join("").trim();
    if (text) lines.push(text);
  });
  return lines.join("\n");
}

/** Short derived preview stored on the entity row for list views and search. */
export function derivePreview(kind: RoomKind, doc: Y.Doc): string {
  switch (kind) {
    case "document":
      return xmlFragmentText(doc.getXmlFragment("default")).slice(0, MAX);
    case "whiteboard": {
      const objects = readWhiteboard(doc);
      const texts = objects.filter((o) => (o.type === "sticky" || o.type === "text") && o.text.trim()).map((o) => o.text.trim());
      const summary = `${objects.length} object${objects.length === 1 ? "" : "s"}`;
      return [summary, ...texts].join(" · ").slice(0, MAX);
    }
    case "mindmap": {
      const { nodes } = normalizeMindmap(readMindmap(doc));
      const root = nodes.find((n) => n.id === MINDMAP_ROOT_ID);
      const children = nodes.filter((n) => n.parentId === MINDMAP_ROOT_ID).map((n) => n.label);
      return [root?.label ?? "", ...children].filter(Boolean).join(" · ").slice(0, MAX);
    }
    case "code":
      return readFiles(doc).map((f) => f.name).join(", ").slice(0, MAX);
  }
}
