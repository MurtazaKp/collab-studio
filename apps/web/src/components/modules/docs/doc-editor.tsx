"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { roomName } from "@collabverse/shared";
import { useCollabRoom, useCollabUser } from "@/lib/collab/react";
import type { CollabSession } from "@/lib/collab/types";
import { useWorkspace } from "@/lib/workspace-context";
import type { ItemRow } from "@/lib/data/items";
import { CollabGate, CollabHeader, useLiveItem } from "@/components/modules/collab-chrome";
import { PromptDialog } from "@/components/ui/confirm";
import { Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export function DocEditor({ doc }: { doc: ItemRow }) {
  const { session, state } = useCollabRoom(roomName("document", doc.id));
  const { item, deleted } = useLiveItem("docs", doc);
  return (
    <div className="flex h-full flex-col">
      <CollabHeader module="docs" item={item} session={session} state={state} />
      <CollabGate state={state} deleted={deleted} module="docs">
        {session ? <DocSurface key={session.room} session={session} readOnly={state.access !== "read-write"} /> : null}
      </CollabGate>
    </div>
  );
}

function DocSurface({ session, readOnly }: { session: CollabSession; readOnly: boolean }) {
  const user = useCollabUser();
  const { canEdit } = useWorkspace();
  const editable = canEdit && !readOnly;

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          link: {
            openOnClick: false,
            autolink: true,
            protocols: ["http", "https", "mailto"],
            isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && SAFE_LINK.test(url),
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: editable ? "Start writing, or type # for a heading…" : "This document is empty." }),
        Collaboration.configure({ document: session.doc, field: "default" }),
        CollaborationCaret.configure({ provider: { awareness: session.awareness }, user: { name: user.name, color: user.color } }),
      ],
      editorProps: {
        attributes: { class: "prose-doc min-h-[60vh] pb-32", "aria-label": "Document body" },
      },
    },
    [session],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editable && editor ? <Toolbar editor={editor} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[740px] px-6 pt-10">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  const chain = () => editor.chain().focus();
  const groups: { label: string; icon: React.ReactNode; active?: boolean; run: () => void; kbd?: string }[][] = [
    [
      { label: "Undo", icon: <Undo2 />, run: () => chain().undo().run(), kbd: "Ctrl+Z" },
      { label: "Redo", icon: <Redo2 />, run: () => chain().redo().run(), kbd: "Ctrl+Shift+Z" },
    ],
    [
      { label: "Heading 1", icon: <Heading1 />, active: s.h1, run: () => chain().toggleHeading({ level: 1 }).run() },
      { label: "Heading 2", icon: <Heading2 />, active: s.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
      { label: "Heading 3", icon: <Heading3 />, active: s.h3, run: () => chain().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: "Bold", icon: <Bold />, active: s.bold, run: () => chain().toggleBold().run(), kbd: "Ctrl+B" },
      { label: "Italic", icon: <Italic />, active: s.italic, run: () => chain().toggleItalic().run(), kbd: "Ctrl+I" },
      { label: "Underline", icon: <Underline />, active: s.underline, run: () => chain().toggleUnderline().run(), kbd: "Ctrl+U" },
      { label: "Strikethrough", icon: <Strikethrough />, active: s.strike, run: () => chain().toggleStrike().run() },
      { label: "Inline code", icon: <Code />, active: s.code, run: () => chain().toggleCode().run() },
      { label: "Link", icon: <Link2 />, active: s.link, run: () => setLinking(true), kbd: "Ctrl+K" },
    ],
    [
      { label: "Bulleted list", icon: <List />, active: s.bullet, run: () => chain().toggleBulletList().run() },
      { label: "Numbered list", icon: <ListOrdered />, active: s.ordered, run: () => chain().toggleOrderedList().run() },
      { label: "Checklist", icon: <ListChecks />, active: s.task, run: () => chain().toggleTaskList().run() },
      { label: "Quote", icon: <Quote />, active: s.quote, run: () => chain().toggleBlockquote().run() },
      { label: "Code block", icon: <SquareCode />, active: s.codeBlock, run: () => chain().toggleCodeBlock().run() },
      { label: "Divider", icon: <Minus />, run: () => chain().setHorizontalRule().run() },
    ],
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && editor.isFocused) {
        e.preventDefault();
        setLinking(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface px-4 py-1.5">
      {groups.map((group, gi) => (
        <div key={gi} className={cn("flex items-center gap-0.5", gi > 0 && "ml-1 border-l border-border pl-1.5")}>
          {group.map((b) => (
            <Tooltip key={b.label} label={b.kbd ? `${b.label} · ${b.kbd}` : b.label}>
              <button
                type="button"
                aria-label={b.label}
                aria-pressed={b.active ?? undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={b.run}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-text-2 transition-colors [&>svg]:size-4",
                  b.active ? "bg-accent-soft text-accent" : "hover:bg-surface-2 hover:text-text",
                )}
              >
                {b.icon}
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
      <PromptDialog
        open={linking}
        onOpenChange={setLinking}
        title={s.link ? "Edit link" : "Add link"}
        label="URL"
        placeholder="https://"
        initialValue={s.linkHref}
        maxLength={2048}
        submitLabel={s.link ? "Update" : "Add link"}
        onSubmit={(url) => {
          if (!SAFE_LINK.test(url)) throw new Error("Links must start with https://, http:// or mailto:");
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
      />
    </div>
  );
}
