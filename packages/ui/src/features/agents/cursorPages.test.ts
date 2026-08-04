import { describe, expect, it, vi } from "vitest";
import { collectCursorPages } from "./cursorPages";

describe("collectCursorPages", () => {
  it("follows cursors until exhausted", async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [1, 2], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [3], nextCursor: null });

    await expect(
      collectCursorPages({ loadPage, isCurrent: () => true, pageSize: 2 }),
    ).resolves.toEqual([1, 2, 3]);
    expect(loadPage).toHaveBeenNthCalledWith(1, null, 2);
    expect(loadPage).toHaveBeenNthCalledWith(2, "page-2", 2);
  });

  it("honors the hard cap and stops when the owner becomes stale", async () => {
    const cappedLoader = vi.fn().mockResolvedValue({ data: [1, 2, 3], nextCursor: "more" });
    await expect(
      collectCursorPages({
        loadPage: cappedLoader,
        isCurrent: () => true,
        pageSize: 3,
        maxItems: 2,
      }),
    ).resolves.toEqual([1, 2]);
    expect(cappedLoader).toHaveBeenCalledOnce();

    let current = true;
    const staleLoader = vi.fn(async () => {
      current = false;
      return { data: [1], nextCursor: "more" };
    });
    await expect(
      collectCursorPages({ loadPage: staleLoader, isCurrent: () => current }),
    ).resolves.toBeNull();
    expect(staleLoader).toHaveBeenCalledOnce();
  });
});
