import * as Y from "yjs";

/**
 * Shared code-project model. Code is untrusted user content: it is stored and
 * displayed, never executed.
 *
 * Y.Doc layout:
 *   doc.getMap("files")     fileId -> Y.Map { name, language, createdAt }
 *   doc.getMap("contents")  fileId -> Y.Text (the Monaco buffer)
 */

export const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "html",
  "css",
  "json",
  "markdown",
  "sql",
  "go",
  "rust",
  "java",
  "cpp",
  "shell",
  "yaml",
  "plaintext",
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  markdown: "Markdown",
  sql: "SQL",
  go: "Go",
  rust: "Rust",
  java: "Java",
  cpp: "C++",
  shell: "Shell",
  yaml: "YAML",
  plaintext: "Plain text",
};

const EXT: Record<string, CodeLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  html: "html",
  css: "css",
  json: "json",
  md: "markdown",
  sql: "sql",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "cpp",
  cc: "cpp",
  h: "cpp",
  sh: "shell",
  yml: "yaml",
  yaml: "yaml",
  txt: "plaintext",
};

export const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,63}$/;
export const MAX_FILES = 50;

export function languageForFileName(name: string): CodeLanguage {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT[ext] ?? "plaintext";
}

export function isCodeLanguage(v: unknown): v is CodeLanguage {
  return typeof v === "string" && (CODE_LANGUAGES as readonly string[]).includes(v);
}

export interface CodeFile {
  id: string;
  name: string;
  language: CodeLanguage;
  createdAt: number;
}

export function filesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("files");
}

export function contentsMap(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>("contents");
}

export function readFiles(doc: Y.Doc): CodeFile[] {
  const out: CodeFile[] = [];
  filesMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const name = m.get("name");
    if (typeof name !== "string") return;
    const lang = m.get("language");
    const createdAt = m.get("createdAt");
    out.push({
      id,
      name,
      language: isCodeLanguage(lang) ? lang : languageForFileName(name),
      createdAt: typeof createdAt === "number" ? createdAt : 0,
    });
  });
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

export function fileText(doc: Y.Doc, fileId: string): Y.Text | undefined {
  const t = contentsMap(doc).get(fileId);
  return t instanceof Y.Text ? t : undefined;
}

export type FileError = "invalid_name" | "duplicate_name" | "too_many_files";

export function validateFileName(doc: Y.Doc, name: string, ignoreId?: string): FileError | null {
  if (!FILE_NAME_RE.test(name)) return "invalid_name";
  const files = readFiles(doc);
  if (files.some((f) => f.id !== ignoreId && f.name.toLowerCase() === name.toLowerCase())) {
    return "duplicate_name";
  }
  if (!ignoreId && files.length >= MAX_FILES) return "too_many_files";
  return null;
}

export function addFile(
  doc: Y.Doc,
  name: string,
  initial = "",
  id: string = `f_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
): { id: string } | { error: FileError } {
  const error = validateFileName(doc, name);
  if (error) return { error };
  doc.transact(() => {
    const meta = new Y.Map<unknown>();
    meta.set("name", name);
    meta.set("language", languageForFileName(name));
    meta.set("createdAt", Date.now());
    filesMap(doc).set(id, meta);
    const text = new Y.Text();
    if (initial) text.insert(0, initial);
    contentsMap(doc).set(id, text);
  });
  return { id };
}

export function renameFile(doc: Y.Doc, id: string, name: string): FileError | null {
  const meta = filesMap(doc).get(id);
  if (!meta) return null;
  const error = validateFileName(doc, name, id);
  if (error) return error;
  doc.transact(() => {
    meta.set("name", name);
    meta.set("language", languageForFileName(name));
  });
  return null;
}

export function setFileLanguage(doc: Y.Doc, id: string, language: CodeLanguage): void {
  filesMap(doc).get(id)?.set("language", language);
}

export function deleteFile(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    filesMap(doc).delete(id);
    contentsMap(doc).delete(id);
  });
}

export function seedCodeProject(doc: Y.Doc): void {
  if (filesMap(doc).size > 0) return;
  addFile(
    doc,
    "main.ts",
    "// Shared buffer — everyone in this project edits it live.\n// Code here is never executed by CollabVerse.\n\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
    "main",
  );
}
