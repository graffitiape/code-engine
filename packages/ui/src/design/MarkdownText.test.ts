import { describe, expect, it } from "vitest";
import { parseFileLink, renderMarkdown } from "./MarkdownText";

describe("renderMarkdown", () => {
  it("renders structured agent output", () => {
    const html = renderMarkdown("# Result\n\n- First\n- Second\n\n`inline`\n\n```ts\nconst ok = true;\n```");

    expect(html).toContain("<h1>Result</h1>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain('<code class="language-ts">const ok = true;');
  });

  it("adds safe attributes to supported links", () => {
    const html = renderMarkdown("[Open docs](https://example.com/docs)");

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("does not create links for unsafe protocols", () => {
    const html = renderMarkdown("[Do not open](javascript:alert(1))");

    expect(html).not.toContain("<a");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Do not open");
  });

  it("renders absolute file links with line and column metadata", () => {
    const html = renderMarkdown("[Open file](/Users/me/My%20Project/file.ts:12:4)");

    expect(html).toContain('data-file-path="/Users/me/My Project/file.ts"');
    expect(html).toContain('data-file-line="12"');
    expect(html).toContain('data-file-column="4"');
    expect(html).not.toContain('target="_blank"');
  });

  it("links bare POSIX and Windows paths with navigation metadata", () => {
    const html = renderMarkdown("See /Users/me/project/file.ts:12:4 and C:\\project\\main.ts:8.");

    expect(html).toContain('data-file-path="/Users/me/project/file.ts" data-file-line="12" data-file-column="4"');
    expect(html).toContain('data-file-path="C:\\project\\main.ts" data-file-line="8" data-file-column="1"');
    expect(html).toContain("</a>.");
  });

  it("links an absolute path in inline code but not fenced code", () => {
    const html = renderMarkdown("`/project/src/main.ts:7`\n\n```text\n/project/src/ignored.ts:9\n```");

    expect(html).toContain('<code><a href="#" data-file-path="/project/src/main.ts" data-file-line="7"');
    expect(html).not.toContain('data-file-path="/project/src/ignored.ts"');
  });

  it("links every repeated path occurrence", () => {
    const html = renderMarkdown("/project/main.ts:2 then /project/main.ts:2");

    expect(html.match(/data-file-path="\/project\/main\.ts"/g)).toHaveLength(2);
  });

  it("does not link unsupported relative or traversal paths in prose", () => {
    const html = renderMarkdown("src/main.ts:2 /project/../secret.ts:2 file:///project/main.ts:2");

    expect(html).not.toContain("data-file-path");
  });

  it("does not nest auto-linked paths inside explicit link labels", () => {
    const html = renderMarkdown("[/project/main.ts:2](https://example.com)");

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com"');
  });

  it("parses POSIX and Windows file targets from the end", () => {
    expect(parseFileLink("/project/src/main.ts:7")).toEqual({ path: "/project/src/main.ts", line: 7, column: 1 });
    expect(parseFileLink("C:%5Cproject%5Cmain.ts:8:2")).toEqual({ path: "C:\\project\\main.ts", line: 8, column: 2 });
  });

  it("rejects relative, traversal, malformed, and file URL targets", () => {
    expect(parseFileLink("src/main.ts:2")).toBeNull();
    expect(parseFileLink("/project/../secret.ts:2")).toBeNull();
    expect(parseFileLink("/%E0%A4%A")).toBeNull();
    expect(parseFileLink("file:///project/main.ts")).toBeNull();
  });

  it("keeps raw HTML inert and suppresses remote images", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">\n\n![diagram](https://example.com/image.png)');

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("image.png");
    expect(html).toContain("diagram");
  });

  it("handles empty and partial streaming output", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("```ts\nconst pending = true")).toContain("const pending = true");
  });
});
