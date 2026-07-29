export type EditorShortcutId =
  | "toggleEntry" | "exitEntry"
  | "durationWhole" | "durationHalf" | "durationQuarter" | "durationEighth" | "durationSixteenth"
  | "pitch0" | "pitch1" | "pitch2" | "pitch3" | "pitch4" | "pitch5"
  | "pitch6" | "pitch7" | "pitch8" | "pitch9" | "pitch10" | "pitch11"
  | "rest" | "tie" | "natural"
  | "keyFlatter" | "keyNatural" | "keySharper"
  | "toggleClef" | "repeatStart" | "repeatEnd" | "toggleLoop"
  | "octaveUp" | "octaveDown" | "cursorLeft" | "cursorRight"
  | "previousMeasure" | "nextMeasure" | "deletePrevious" | "deleteCurrent";

export interface EditorPreferences {
  uiScale: number;
  shortcuts: Record<EditorShortcutId, string>;
}

export const EDITOR_PREFERENCES_KEY = "singright-editor-preferences-v2";

export const DEFAULT_SHORTCUTS: Record<EditorShortcutId, string> = {
  toggleEntry: "Enter",
  exitEntry: "Escape",
  durationWhole: "Digit1",
  durationHalf: "Digit2",
  durationQuarter: "Digit3",
  durationEighth: "Digit4",
  durationSixteenth: "Digit5",
  pitch0: "KeyQ",
  pitch1: "KeyW",
  pitch2: "KeyE",
  pitch3: "KeyR",
  pitch4: "KeyT",
  pitch5: "KeyY",
  pitch6: "KeyU",
  pitch7: "KeyI",
  pitch8: "KeyO",
  pitch9: "KeyP",
  pitch10: "BracketLeft",
  pitch11: "BracketRight",
  rest: "Space",
  tie: "KeyH",
  natural: "KeyN",
  keyFlatter: "KeyZ",
  keyNatural: "KeyX",
  keySharper: "KeyC",
  toggleClef: "KeyJ",
  repeatStart: "KeyL",
  repeatEnd: "Semicolon",
  toggleLoop: "KeyK",
  octaveUp: "ArrowUp",
  octaveDown: "ArrowDown",
  cursorLeft: "ArrowLeft",
  cursorRight: "ArrowRight",
  previousMeasure: "Shift+ArrowLeft",
  nextMeasure: "Shift+ArrowRight",
  deletePrevious: "Backspace",
  deleteCurrent: "Delete",
};

export function loadEditorPreferences(): EditorPreferences {
  if (typeof window === "undefined") return { uiScale: 100, shortcuts: { ...DEFAULT_SHORTCUTS } };
  try {
    const stored = JSON.parse(localStorage.getItem(EDITOR_PREFERENCES_KEY) ?? "{}") as Partial<EditorPreferences>;
    return {
      uiScale: Math.max(80, Math.min(200, Number(stored.uiScale) || 100)),
      shortcuts: { ...DEFAULT_SHORTCUTS, ...(stored.shortcuts ?? {}) },
    };
  } catch {
    return { uiScale: 100, shortcuts: { ...DEFAULT_SHORTCUTS } };
  }
}

export function saveEditorPreferences(value: EditorPreferences): void {
  localStorage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify(value));
}

export function shortcutFromEvent(event: KeyboardEvent): string {
  const modifiers = [
    event.metaKey ? "Meta" : "",
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  return [...modifiers, event.code].join("+");
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string, allowPitchModifiers = false): boolean {
  const parts = shortcut.split("+");
  const code = parts.at(-1);
  const expected = new Set(parts.slice(0, -1));
  if (event.code !== code) return false;
  if (event.metaKey !== expected.has("Meta")) return false;
  if (!allowPitchModifiers && event.ctrlKey !== expected.has("Ctrl")) return false;
  if (event.altKey !== expected.has("Alt")) return false;
  if (!allowPitchModifiers && event.shiftKey !== expected.has("Shift")) return false;
  return true;
}

export function shortcutLabel(value: string): string {
  return value
    .replace("Digit", "")
    .replace("Key", "")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Semicolon", ";")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("Backspace", "⌫")
    .replace("Delete", "Del")
    .replaceAll("+", " + ");
}
