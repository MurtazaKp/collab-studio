"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Columns3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  SquareCode,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Trash2,
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
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const BLOCK_STYLES = [
  { value: "p", label: "Normal text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
] as const;

const FONTS = [
  { value: "", label: "Default font" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: '"Times New Roman", Times, serif', label: "Times New Roman" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: '"Trebuchet MS", sans-serif', label: "Trebuchet MS" },
  { value: '"Courier New", ui-monospace, monospace', label: "Courier New" },
] as const;

const SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "40px", "48px"] as const;

// Text colours read well on both themes; highlights are soft fills.
const TEXT_COLORS = ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280"] as const;
const HIGHLIGHTS = ["#fef08a", "#fed7aa", "#fecaca", "#bbf7d0", "#a5f3fc", "#bfdbfe", "#ddd6fe", "#fbcfe8", "#e5e7eb"] as const;

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
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Highlight.configure({ multicolor: true }),
        Subscript,
        Superscript,
        TableKit.configure({ table: { resizable: false } }),
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

type Btn = { label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; run: () => void; kbd?: string };

function ToolButton({ b }: { b: Btn }) {
  return (
    <Tooltip label={b.kbd ? `${b.label} · ${b.kbd}` : b.label}>
      <button
        type="button"
        aria-label={b.label}
        aria-pressed={b.active ?? undefined}
        disabled={b.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={b.run}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-text-2 transition-colors disabled:opacity-35 [&>svg]:size-4",
          b.active ? "bg-accent-soft text-accent" : "hover:bg-surface-2 hover:text-text",
        )}
      >
        {b.icon}
      </button>
    </Tooltip>
  );
}

/** A compact native select that keeps the editor's selection while open. */
function ToolSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full appearance-none rounded-md border border-transparent bg-transparent pr-6 pl-2 text-[12.5px] text-text-2 hover:border-border hover:bg-surface-2 hover:text-text focus-visible:border-accent focus-visible:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted" />
    </div>
  );
}

function ColorPicker({
  label,
  icon,
  current,
  colors,
  onPick,
  onClear,
}: {
  label: string;
  icon: React.ReactNode;
  current: string | null;
  colors: readonly string[];
  onPick: (c: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={label}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            className="relative flex size-7 flex-col items-center justify-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text [&>svg]:size-4"
          >
            {icon}
            <span aria-hidden className="absolute bottom-1 h-[3px] w-4 rounded-full" style={{ background: current ?? "transparent" }} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-auto p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div role="group" aria-label={label} className="grid grid-cols-5 gap-1.5">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={current === c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className={cn("size-6 rounded-md border border-black/10 transition-transform hover:scale-110", current === c && "ring-2 ring-accent ring-offset-1 ring-offset-surface")}
              style={{ background: c }}
            />
          ))}
          <button
            type="button"
            aria-label="No colour"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="flex size-6 items-center justify-center rounded-md border border-border text-muted hover:bg-surface-2 hover:text-text"
          >
            <RemoveFormatting className="size-3.5" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      sub: e.isActive("subscript"),
      sup: e.isActive("superscript"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      justify: e.isActive({ textAlign: "justify" }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"),
      link: e.isActive("link"),
      linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  const chain = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
  };

  const groups: Btn[][] = [
    [
      { label: "Bold", icon: <Bold />, active: s.bold, run: () => chain().toggleBold().run(), kbd: "Ctrl+B" },
      { label: "Italic", icon: <Italic />, active: s.italic, run: () => chain().toggleItalic().run(), kbd: "Ctrl+I" },
      { label: "Underline", icon: <Underline />, active: s.underline, run: () => chain().toggleUnderline().run(), kbd: "Ctrl+U" },
      { label: "Strikethrough", icon: <Strikethrough />, active: s.strike, run: () => chain().toggleStrike().run() },
      { label: "Superscript", icon: <SuperscriptIcon />, active: s.sup, run: () => chain().toggleSuperscript().run() },
      { label: "Subscript", icon: <SubscriptIcon />, active: s.sub, run: () => chain().toggleSubscript().run() },
      { label: "Inline code", icon: <Code />, active: s.code, run: () => chain().toggleCode().run() },
      { label: "Link", icon: <Link2 />, active: s.link, run: () => setLinking(true), kbd: "Ctrl+K" },
    ],
    [
      { label: "Align left", icon: <AlignLeft />, active: s.left, run: () => chain().setTextAlign("left").run(), kbd: "Ctrl+Shift+L" },
      { label: "Align centre", icon: <AlignCenter />, active: s.center, run: () => chain().setTextAlign("center").run(), kbd: "Ctrl+Shift+E" },
      { label: "Align right", icon: <AlignRight />, active: s.right, run: () => chain().setTextAlign("right").run(), kbd: "Ctrl+Shift+R" },
      { label: "Justify", icon: <AlignJustify />, active: s.justify, run: () => chain().setTextAlign("justify").run(), kbd: "Ctrl+Shift+J" },
    ],
    [
      { label: "Bulleted list", icon: <List />, active: s.bullet, run: () => chain().toggleBulletList().run() },
      { label: "Numbered list", icon: <ListOrdered />, active: s.ordered, run: () => chain().toggleOrderedList().run() },
      { label: "Checklist", icon: <ListChecks />, active: s.task, run: () => chain().toggleTaskList().run() },
      { label: "Quote", icon: <Quote />, active: s.quote, run: () => chain().toggleBlockquote().run() },
      { label: "Code block", icon: <SquareCode />, active: s.codeBlock, run: () => chain().toggleCodeBlock().run() },
      { label: "Divider", icon: <Minus />, run: () => chain().setHorizontalRule().run() },
      {
        label: "Insert table",
        icon: <TableIcon />,
        active: s.table,
        disabled: s.table,
        run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
    ],
    [{ label: "Clear formatting", icon: <RemoveFormatting />, run: () => chain().unsetAllMarks().unsetTextAlign().run() }],
  ];

  const tableTools: Btn[] = [
    { label: "Add row below", icon: <Rows3 />, run: () => chain().addRowAfter().run() },
    { label: "Add column right", icon: <Columns3 />, run: () => chain().addColumnAfter().run() },
    { label: "Delete row", icon: <Rows3 className="text-danger" />, run: () => chain().deleteRow().run() },
    { label: "Delete column", icon: <Columns3 className="text-danger" />, run: () => chain().deleteColumn().run() },
    { label: "Delete table", icon: <Trash2 className="text-danger" />, run: () => chain().deleteTable().run() },
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

  const divider = "ml-1 border-l border-border pl-1.5";

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-y-1 border-b border-border bg-surface px-4 py-1.5">
      <div className="flex items-center gap-0.5">
        <ToolButton b={{ label: "Undo", icon: <Undo2 />, run: () => chain().undo().run(), kbd: "Ctrl+Z" }} />
        <ToolButton b={{ label: "Redo", icon: <Redo2 />, run: () => chain().redo().run(), kbd: "Ctrl+Shift+Z" }} />
      </div>

      <div className={cn("flex items-center gap-1", divider)}>
        <ToolSelect label="Paragraph style" value={s.block} onChange={setBlock} options={BLOCK_STYLES} className="w-[118px]" />
        <ToolSelect
          label="Font"
          value={FONTS.some((f) => f.value === s.font) ? s.font : ""}
          onChange={(v) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run())}
          options={FONTS}
          className="w-[128px]"
        />
        <ToolSelect
          label="Font size"
          value={(SIZES as readonly string[]).includes(s.size) ? s.size : ""}
          onChange={(v) => (v ? chain().setFontSize(v).run() : chain().unsetFontSize().run())}
          options={[{ value: "", label: "Size" }, ...SIZES.map((v) => ({ value: v, label: v.replace("px", "") }))]}
          className="w-[64px]"
        />
      </div>

      <div className={cn("flex items-center gap-0.5", divider)}>
        <ColorPicker
          label="Text colour"
          icon={<Baseline />}
          current={s.color}
          colors={TEXT_COLORS}
          onPick={(c) => chain().setColor(c).run()}
          onClear={() => chain().unsetColor().run()}
        />
        <ColorPicker
          label="Highlight"
          icon={<Highlighter />}
          current={s.highlight}
          colors={HIGHLIGHTS}
          onPick={(c) => chain().setHighlight({ color: c }).run()}
          onClear={() => chain().unsetHighlight().run()}
        />
      </div>

      {groups.map((group, gi) => (
        <div key={gi} className={cn("flex items-center gap-0.5", divider)}>
          {group.map((b) => (
            <ToolButton key={b.label} b={b} />
          ))}
        </div>
      ))}

      {s.table ? (
        <div role="group" aria-label="Table" className={cn("flex items-center gap-0.5", divider)}>
          <span className="mr-1 text-[11.5px] font-medium text-muted">Table</span>
          {tableTools.map((b) => (
            <ToolButton key={b.label} b={b} />
          ))}
        </div>
      ) : null}

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
