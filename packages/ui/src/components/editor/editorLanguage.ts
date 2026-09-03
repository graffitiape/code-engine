import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";

export function editorLanguageExtension(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "ts":
    case "tsx":
      return javascript({ jsx: extension === "tsx", typescript: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "rs":
      return rust();
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    case "py":
    case "pyi":
      return python();
    default:
      return [];
  }
}

export function editorCursorOffset(
  content: string,
  lineNumber: number,
  column: number,
): number {
  const lines = content.split("\n");
  const lineIndex = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1;
  return offset + Math.max(0, Math.min(lines[lineIndex].length, column - 1));
}
