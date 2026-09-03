const ALLOWED_ELEMENTS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const DROP_WITH_CONTENTS = new Set([
  "audio",
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "iframe",
  "img",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "option",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "textarea",
  "video",
]);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}
function safeLinkTarget(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.toString();
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())
  ) {
    return url.toString();
  }
  return null;
}

function sanitizeElement(element: Element) {
  const tag = element.tagName.toLowerCase();
  if (DROP_WITH_CONTENTS.has(tag)) {
    element.remove();
    return;
  }

  for (const child of Array.from(element.childNodes)) sanitizeNode(child);

  if (!ALLOWED_ELEMENTS.has(tag)) {
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  const href = tag === "a" ? element.getAttribute("href") : null;
  const title = element.getAttribute("title");
  const className = element.getAttribute("class");
  for (const attribute of Array.from(element.attributes)) {
    element.removeAttribute(attribute.name);
  }

  if (title) element.setAttribute("title", title.slice(0, 500));
  if (tag === "a" && href) {
    const target = safeLinkTarget(href);
    if (target) {
      element.setAttribute("href", target);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }
  if (
    className &&
    (tag === "span" || tag === "code") &&
    className.split(/\s+/).every((name) => /^(?:tok|language)-[a-zA-Z0-9_-]+$/.test(name))
  ) {
    element.setAttribute("class", className);
  }
}

function sanitizeNode(node: Node) {
  if (node.nodeType === 1) {
    sanitizeElement(node as Element);
  } else if (node.nodeType === 8) {
    node.parentNode?.removeChild(node);
  }
}

/**
 * Sanitize Markdown HTML produced for LSP hover, completion, and signature UI.
 * In non-DOM environments the entire value is escaped, which is conservative
 * but keeps server-controlled markup inert.
 */
export function sanitizeLspHTML(html: string): string {
  if (typeof document === "undefined") return escapeHtml(html);
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const child of Array.from(template.content.childNodes)) sanitizeNode(child);
  return template.innerHTML;
}
