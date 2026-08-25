import { describe, expect, it } from "vitest";
import { isNearFeedBottom } from "./AgentFeed";

describe("agent feed scrolling", () => {
  it("follows output at or near the bottom", () => {
    expect(isNearFeedBottom({ scrollHeight: 500, scrollTop: 300, clientHeight: 200 })).toBe(true);
    expect(isNearFeedBottom({ scrollHeight: 500, scrollTop: 275, clientHeight: 200 })).toBe(true);
  });

  it("pauses following when the reader scrolls away from the bottom", () => {
    expect(isNearFeedBottom({ scrollHeight: 500, scrollTop: 250, clientHeight: 200 })).toBe(false);
  });

  it("follows output when the feed does not fill its viewport", () => {
    expect(isNearFeedBottom({ scrollHeight: 150, scrollTop: 0, clientHeight: 200 })).toBe(true);
  });
});
