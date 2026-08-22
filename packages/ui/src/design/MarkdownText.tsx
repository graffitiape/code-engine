import { createMemo } from "solid-js";
import { Marked, Renderer, type Tokens } from "marked";
import { openExternalUrl } from "../bridge/tauri";

export interface MarkdownTextProps {
  text: string | null | undefined;
  class?: string;
  onOpenFile?: (target: FileLinkTarget) => void;
}

export interface FileLinkTarget {
  path: string;
  line: number;
  column: number;
}

const renderer = new Renderer();
let renderingLinkLabel = false;

renderer.html = ({ text }: Tokens.HTML) => `<p>${escapeHtml(text)}</p>`;
renderer.image = ({ text }: Tokens.Image) => escapeHtml(text);
renderer.link = function ({ href, title, tokens }: Tokens.Link) {
  renderingLinkLabel = true;
  let label: string;
  try {
    label = this.parser.parseInline(tokens);
  } finally {
    renderingLinkLabel = false;
  }
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  if (isSafeExternalUrl(href)) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttribute}>${label}</a>`;
  }
  const file = parseFileLink(href);
  if (!file) return label;
  return `<a href="#" data-file-path="${escapeHtml(file.path)}" data-file-line="${file.line}" data-file-column="${file.column}"${titleAttribute}>${label}</a>`;
};
renderer.text = ({ text }: Tokens.Text) => renderingLinkLabel ? escapeHtml(text) : linkFilePaths(text);
renderer.codespan = ({ text }: Tokens.Codespan) => {
  if (renderingLinkLabel) return `<code>${escapeHtml(text)}</code>`;
  const file = parseFileLink(text);
  if (!file) return `<code>${escapeHtml(text)}</code>`;
  return `<code>${fileAnchor(file, text)}</code>`;
};

const markdown = new Marked({
  async: false,
  breaks: true,
  gfm: true,
  renderer,
});

export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return markdown.parse(text) as string;
}

export function MarkdownText(props: MarkdownTextProps) {
  const html = createMemo(() => renderMarkdown(props.text));

  const openLink = (event: MouseEvent) => {
    const target = event.target;
    const link = target instanceof Element ? target.closest("a") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    const path = link.dataset.filePath;
    if (path) {
      props.onOpenFile?.({
        path,
        line: Number(link.dataset.fileLine) || 1,
        column: Number(link.dataset.fileColumn) || 1,
      });
      return;
    }
    const href = link.getAttribute("href");
    if (href && isSafeExternalUrl(href)) void openExternalUrl(href);
  };

  return (
    <div
      class={`markdown-text${props.class ? ` ${props.class}` : ""}`}
      innerHTML={html()}
      onClick={openLink}
    />
  );
}

export function parseFileLink(value: string): FileLinkTarget | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) return null;

  const match = decoded.match(/^(.*?)(?::([1-9]\d*))?(?::([1-9]\d*))?$/);
  if (!match) return null;
  const path = match[1];
  const absolutePosix = path.startsWith("/");
  const absoluteWindows = /^[A-Za-z]:[\\/]/.test(path);
  if ((!absolutePosix && !absoluteWindows) || path.split(/[\\/]/).includes("..")) return null;

  return {
    path,
    line: match[2] ? Number(match[2]) : 1,
    column: match[3] ? Number(match[3]) : 1,
  };
}

function linkFilePaths(text: string): string {
  const pathPattern = /(?<![\w./:-])(?:\/(?:[^\s<>"'`()[\]{}]|%[\dA-Fa-f]{2})+|[A-Za-z]:[\\/](?:[^\s<>"'`()[\]{}]|%[\dA-Fa-f]{2})+)/g;
  let html = "";
  let cursor = 0;

  for (const match of text.matchAll(pathPattern)) {
    const start = match.index;
    let value = match[0];
    let suffix = "";
    while (/[.,;!?]$/.test(value)) {
      suffix = value.slice(-1) + suffix;
      value = value.slice(0, -1);
    }
    const file = parseFileLink(value);
    if (!file) continue;
    html += escapeHtml(text.slice(cursor, start));
    html += fileAnchor(file, value);
    html += escapeHtml(suffix);
    cursor = start + match[0].length;
  }

  return html + escapeHtml(text.slice(cursor));
}

function fileAnchor(file: FileLinkTarget, label: string): string {
  return `<a href="#" data-file-path="${escapeHtml(file.path)}" data-file-line="${file.line}" data-file-column="${file.column}">${escapeHtml(label)}</a>`;
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (
      url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
