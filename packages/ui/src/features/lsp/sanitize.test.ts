import { describe, expect, it } from "vitest";
import { sanitizeLspHTML } from "./sanitize";

describe("LSP HTML sanitizer", () => {
  it("keeps server markup inert when no DOM parser is available", () => {
    const sanitized = sanitizeLspHTML('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(sanitized).not.toContain("<img");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).toContain("&lt;script&gt;");
  });
});
