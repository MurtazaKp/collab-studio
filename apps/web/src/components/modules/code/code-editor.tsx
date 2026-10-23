"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { toast } from "sonner";
import { FileCode2, FilePlus2, MoreHorizontal, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { roomName } from "@collabverse/shared";
import {
  CODE_LANGUAGES,
  LANGUAGE_LABELS,
  addFile,
  deleteFile,
  fileText,
  filesMap,
  readFiles,
  renameFile,
  setFileLanguage,
  type CodeFile,
  type CodeLanguage,
  type FileError,
} from "@collabverse/shared/code";
import { useCollabRoom, useCollaborators } from "@/lib/collab/react";
import type { CollabSession } from "@/lib/collab/types";
import { useWorkspace } from "@/lib/workspace-context";
import type { ItemRow } from "@/lib/data/items";
import { CollabGate, CollabHeader, useLiveItem } from "@/components/modules/collab-chrome";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/menu";
import { ConfirmDialog, PromptDialog } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { Monaco } from "./monaco-setup";

const FILE_ERRORS: Record<FileError, string> = {
  invalid_name: "Use letters, numbers, dots, dashes and underscores (max 64 characters).",
  duplicate_name: "A file with that name already exists.",
  too_many_files: "Projects can have up to 50 files.",
};

export function CodeEditor({ project }: { project: ItemRow }) {
  const { session, state } = useCollabRoom(roomName("code", project.id));
  const { item, deleted } = useLiveItem("code", project);
  return (
    <div className="flex h-full flex-col">
      <CollabHeader
        module="code"
        item={item}
        session={session}
        state={state}
        actions={
          <Tooltip label="Code is stored and shared, never executed by CollabVerse.">
            <span className="hidden items-center gap-1 text-[12px] text-muted sm:inline-flex">
              <ShieldCheck className="size-3.5" /> Never executed
            </span>
          </Tooltip>
        }
      />
      <CollabGate state={state} deleted={deleted} module="code">
        {session ? <Workbench key={session.room} session={session} readOnly={state.access !== "read-write"} /> : null}
      </CollabGate>
    </div>
  );
}

function useFiles(doc: Y.Doc): CodeFile[] {
  const [files, setFiles] = useState(() => readFiles(doc));
  useEffect(() => {
    const m = filesMap(doc);
    const update = () => setFiles(readFiles(doc));
    m.observeDeep(update);
    update();
    return () => m.unobserveDeep(update);
  }, [doc]);
  return files;
}

function Workbench({ session, readOnly }: { session: CollabSession; readOnly: boolean }) {
  const { canEdit } = useWorkspace();
  const editable = canEdit && !readOnly;
  const files = useFiles(session.doc);
  const collaborators = useCollaborators(session.awareness);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<CodeFile | null>(null);
  const [deleting, setDeleting] = useState<CodeFile | null>(null);

  const active = files.find((f) => f.id === activeId) ?? files[0] ?? null;

  useEffect(() => {
    session.awareness.setLocalStateField("file", active?.id ?? null);
  }, [active?.id, session.awareness]);

  const viewersByFile = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }[]>();
    for (const c of collaborators) {
      const f = (session.awareness.getStates().get(c.clientId) as { file?: unknown } | undefined)?.file;
      if (typeof f === "string") map.set(f, [...(map.get(f) ?? []), c.user]);
    }
    return map;
  }, [collaborators, session.awareness]);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-2" aria-label="Files">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Files</p>
          {editable ? (
            <Tooltip label="New file">
              <Button size="icon-sm" variant="ghost" aria-label="New file" onClick={() => setCreating(true)}>
                <FilePlus2 className="size-4" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        <ul className="flex-1 overflow-y-auto px-1.5 pb-3">
          {files.map((f) => {
            const here = viewersByFile.get(f.id) ?? [];
            return (
              <li key={f.id} className="group relative">
                <button
                  onClick={() => setActiveId(f.id)}
                  aria-current={active?.id === f.id ? "true" : undefined}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-mono text-[12.5px] transition-colors",
                    active?.id === f.id ? "bg-surface text-text shadow-sm" : "text-text-2 hover:bg-surface-3/60",
                  )}
                >
                  <FileCode2 className="size-3.5 shrink-0 text-muted" />
                  <span className="flex-1 truncate">{f.name}</span>
                  {here.length ? (
                    <span className="flex -space-x-1 group-hover:hidden">
                      {here.slice(0, 2).map((u) => (
                        <Avatar key={u.id} name={u.name} color={u.color} size={14} ring />
                      ))}
                    </span>
                  ) : null}
                </button>
                {editable ? (
                  <div className="absolute top-1 right-1 hidden group-focus-within:block group-hover:block [@media(hover:none)]:block">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" className="size-6" aria-label={`Actions for ${f.name}`}>
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem icon={<Pencil />} onSelect={() => setRenaming(f)}>
                          Rename
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} destructive disabled={files.length <= 1} onSelect={() => setDeleting(f)}>
                          Delete
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        {active ? (
          <>
            <div className="flex h-10 items-center justify-between gap-3 border-b border-border px-3">
              <span className="truncate font-mono text-[12.5px] text-text-2">{active.name}</span>
              <Select
                aria-label="Language"
                className="w-36"
                value={active.language}
                disabled={!editable}
                onChange={(e) => setFileLanguage(session.doc, active.id, e.target.value as CodeLanguage)}
              >
                {CODE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </Select>
            </div>
            <MonacoPane key={active.id} session={session} file={active} readOnly={!editable} collaborators={collaborators} />
          </>
        ) : (
          <EmptyState icon={<FileCode2 />} title="No files" description="Add a file to start editing together." />
        )}
      </section>

      <PromptDialog
        open={creating}
        onOpenChange={setCreating}
        title="New file"
        label="File name"
        placeholder="utils.ts"
        maxLength={64}
        submitLabel="Create"
        onSubmit={(name) => {
          const r = addFile(session.doc, name);
          if ("error" in r) throw new Error(FILE_ERRORS[r.error]);
          setActiveId(r.id);
        }}
      />
      <PromptDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename file"
        label="File name"
        maxLength={64}
        initialValue={renaming?.name ?? ""}
        onSubmit={(name) => {
          const err = renameFile(session.doc, renaming!.id, name);
          if (err) throw new Error(FILE_ERRORS[err]);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "file"}?`}
        description="The file is removed for everyone in this project."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          deleteFile(session.doc, deleting!.id);
          if (activeId === deleting!.id) setActiveId(null);
          toast.success("File deleted");
        }}
      />
    </div>
  );
}

function useAppTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function MonacoPane({
  session,
  file,
  readOnly,
  collaborators,
}: {
  session: CollabSession;
  file: CodeFile;
  readOnly: boolean;
  collaborators: ReturnType<typeof useCollaborators>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<import("monaco-editor/editor/editor.api.js").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const theme = useAppTheme();
  // Latest values for the one-time editor setup; later changes are applied in place.
  const initial = useRef({ readOnly, language: file.language });
  initial.current = { readOnly, language: file.language };

  // Create the editor once per file. Read-only state and language are updated
  // below without rebuilding, so reconnects or a peer renaming the file don't
  // reset your cursor, scroll position or undo history.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setLoadError(null);
    (async () => {
      const [{ setupMonaco }, { MonacoBinding }] = await Promise.all([import("./monaco-setup"), import("y-monaco")]);
      if (disposed || !host.current) return;
      const monaco = setupMonaco();
      monacoRef.current = monaco;
      const text = fileText(session.doc, file.id);
      if (!text) {
        setLoadError("This file's contents are missing. It may have been deleted by someone else.");
        return;
      }
      const model = monaco.editor.createModel("", initial.current.language, monaco.Uri.parse(`inmemory://${session.room}/${file.id}`));
      const editor = monaco.editor.create(host.current, {
        model,
        readOnly: initial.current.readOnly,
        readOnlyMessage: { value: "You have view-only access to this project." },
        theme: document.documentElement.dataset.theme === "dark" ? "collabverse-dark" : "collabverse-light",
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 13.5,
        lineHeight: 21,
        padding: { top: 12 },
        scrollBeyondLastLine: false,
        tabSize: 2,
        renderLineHighlight: "line",
        smoothScrolling: true,
        wordBasedSuggestions: "currentDocument",
      });
      editorRef.current = editor;
      const binding = new MonacoBinding(text, model, new Set([editor]), session.awareness);
      setReady(true);
      cleanup = () => {
        binding.destroy();
        editor.dispose();
        model.dispose();
      };
    })().catch((err: unknown) => {
      if (!disposed) setLoadError(`The editor couldn't load (${err instanceof Error ? err.message : "unknown error"}). Reload the page to try again.`);
    });
    return () => {
      disposed = true;
      cleanup();
      editorRef.current = null;
      setReady(false);
    };
  }, [session, file.id]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly, ready]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && monacoRef.current) monacoRef.current.editor.setModelLanguage(model, file.language);
  }, [file.language, ready]);

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === "dark" ? "collabverse-dark" : "collabverse-light");
  }, [theme, ready]);

  // Per-collaborator colours and name labels for remote carets/selections.
  // Colours come from other clients' awareness state, so only accept plain hex
  // values before putting them into CSS.
  const safe = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#4b4fd8");
  const css = collaborators
    .map((c) => ({ ...c, user: { ...c.user, color: safe(c.user.color) } }))
    .map(
      (c) => `.yRemoteSelection-${c.clientId}{background-color:${c.user.color}33}
.yRemoteSelectionHead-${c.clientId}{border-color:${c.user.color};border-left:2px solid ${c.user.color}}
.yRemoteSelectionHead-${c.clientId}::after{content:${JSON.stringify(c.user.name)};position:absolute;top:-1.3em;left:-2px;font:600 10px var(--font-sans);color:#fff;background:${c.user.color};padding:1px 5px;border-radius:3px 3px 3px 0;white-space:nowrap;pointer-events:none}`,
    )
    .join("\n");

  return (
    <div className="relative min-h-0 flex-1">
      <style>{css}</style>
      <div ref={host} className="absolute inset-0" />
      {loadError ? (
        <div role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-danger">
          {loadError}
        </div>
      ) : !ready ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted">
          <Spinner /> Loading editor…
        </div>
      ) : null}
    </div>
  );
}
