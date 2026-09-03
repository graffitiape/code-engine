import { describe, expect, it, vi } from "vitest";
import {
  createAppZoomKeydownHandler,
  MAX_APP_ZOOM,
  MIN_APP_ZOOM,
  nextAppZoom,
  normalizeAppZoom,
} from "./appZoom";

function keyEvent(
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("app zoom", () => {
  it("recognizes both shifted plus and the equals key", () => {
    const onZoomChange = vi.fn();
    const handler = createAppZoomKeydownHandler(1, onZoomChange);
    const plus = keyEvent("+");
    const equals = keyEvent("=", { metaKey: false, ctrlKey: true });

    handler(plus);
    handler(equals);

    expect(plus.preventDefault).toHaveBeenCalledOnce();
    expect(equals.preventDefault).toHaveBeenCalledOnce();
    expect(onZoomChange).toHaveBeenNthCalledWith(1, 1.1);
    expect(onZoomChange).toHaveBeenNthCalledWith(2, 1.2);
  });

  it("zooms out and resets without floating-point drift", () => {
    const onZoomChange = vi.fn();
    const handler = createAppZoomKeydownHandler(1, onZoomChange);

    handler(keyEvent("-"));
    handler(keyEvent("-"));
    handler(keyEvent("0"));

    expect(onZoomChange.mock.calls.map(([zoom]) => zoom)).toEqual([0.9, 0.8, 1]);
  });

  it("leaves prevented and unrelated shortcuts to their scoped controls", () => {
    const onZoomChange = vi.fn();
    const handler = createAppZoomKeydownHandler(1, onZoomChange);
    const preventedReset = keyEvent("0", { defaultPrevented: true });
    const optionPlus = keyEvent("+", { altKey: true });

    handler(preventedReset);
    handler(optionPlus);
    handler(keyEvent("p"));

    expect(preventedReset.preventDefault).not.toHaveBeenCalled();
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("clamps zoom levels and normalizes invalid persisted values", () => {
    expect(nextAppZoom(MAX_APP_ZOOM, "in")).toBe(MAX_APP_ZOOM);
    expect(nextAppZoom(MIN_APP_ZOOM, "out")).toBe(MIN_APP_ZOOM);
    expect(normalizeAppZoom(Number.NaN)).toBe(1);
    expect(normalizeAppZoom(-20)).toBe(MIN_APP_ZOOM);
    expect(normalizeAppZoom(20)).toBe(MAX_APP_ZOOM);
  });
});
