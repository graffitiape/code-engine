import { describe, expect, it } from "vitest";
import { isTerminalTurnStatus } from "./codexRuntime";

describe("Codex pipeline turn status", () => {
  it.each(["completed", "failed", "interrupted"])("accepts %s as terminal", (status) => {
    expect(isTerminalTurnStatus(status)).toBe(true);
  });

  it.each(["inProgress", undefined, null, "unknown", "cancelled"])(
    "fails closed for %s",
    (status) => {
      expect(isTerminalTurnStatus(status)).toBe(false);
    },
  );
});
