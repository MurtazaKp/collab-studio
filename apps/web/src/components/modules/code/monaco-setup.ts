/**
 * Minimal, locally bundled Monaco: the core editor API, a curated set of
 * editor contributions and Monarch syntax highlighting for the supported
 * languages. Imported dynamically so Monaco never loads during SSR.
 */
import * as monaco from "monaco-editor/editor/editor.api.js";

// Pulls in codicon.css (the package exports map can't address .css files directly).
import "monaco-editor/features/codicon/register.js";
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";

import "monaco-editor/languages/definitions/typescript/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/css/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/sql/register.js";
import "monaco-editor/languages/definitions/go/register.js";
import "monaco-editor/languages/definitions/rust/register.js";
import "monaco-editor/languages/definitions/java/register.js";
import "monaco-editor/languages/definitions/cpp/register.js";
import "monaco-editor/languages/definitions/shell/register.js";
import "monaco-editor/languages/definitions/yaml/register.js";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
  }
}

let initialised = false;

export function setupMonaco(): typeof monaco {
  if (initialised) return monaco;
  initialised = true;

  window.MonacoEnvironment = {
    getWorker() {
      return new Worker(new URL("./monaco.worker.ts", import.meta.url), { type: "module" });
    },
  };

  // JSON has no Monarch grammar in the core package; a small one suffices
  // for highlighting without loading the JSON language service.
  monaco.languages.register({ id: "json", extensions: [".json"], aliases: ["JSON"] });
  monaco.languages.setMonarchTokensProvider("json", {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "type"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
        [/\b(?:true|false|null)\b/, "keyword"],
        [/[{}[\],:]/, "delimiter"],
      ],
    },
  });

  monaco.editor.defineTheme("collabverse-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f6f5f1",
      "editorLineNumber.foreground": "#b3aea3",
      "editorLineNumber.activeForeground": "#4a4740",
      "editor.selectionBackground": "#dcdcf8",
      "editorIndentGuide.background1": "#efede7",
    },
  });
  monaco.editor.defineTheme("collabverse-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1a1a17",
      "editor.lineHighlightBackground": "#201f1c",
      "editorLineNumber.foreground": "#5c5a54",
      "editorLineNumber.activeForeground": "#c4c1b8",
      "editor.selectionBackground": "#34366a",
      "editorIndentGuide.background1": "#2a2925",
    },
  });
  return monaco;
}

export type Monaco = typeof monaco;
