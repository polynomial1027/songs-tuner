import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, matchesShortcut, shortcutLabel } from "./editorPreferences";

function keyEvent(code: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers } as KeyboardEvent;
}

describe("editor keyboard preferences", () => {
  it("keeps the chromatic row and navigation defaults deterministic", () => {
    expect(DEFAULT_SHORTCUTS.pitch0).toBe("KeyQ");
    expect(DEFAULT_SHORTCUTS.pitch11).toBe("BracketRight");
    expect(DEFAULT_SHORTCUTS.previousMeasure).toBe("Shift+ArrowLeft");
    expect(shortcutLabel(DEFAULT_SHORTCUTS.previousMeasure)).toBe("Shift + ←");
  });

  it("allows pitch modifier keys without confusing regular commands", () => {
    expect(matchesShortcut(keyEvent("KeyQ", { shiftKey: true }), "KeyQ", true)).toBe(true);
    expect(matchesShortcut(keyEvent("KeyQ", { ctrlKey: true }), "KeyQ", true)).toBe(true);
    expect(matchesShortcut(keyEvent("ArrowLeft", { shiftKey: true }), "ArrowLeft")).toBe(false);
    expect(matchesShortcut(keyEvent("ArrowLeft", { shiftKey: true }), "Shift+ArrowLeft")).toBe(true);
  });
});
