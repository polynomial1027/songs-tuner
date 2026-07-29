import type { PitchScore, ScoreNote } from "../types";

export type Clef = "treble" | "bass";
export type Accidental = -1 | 0 | 1;

export const DURATION_OPTIONS = [
  { beats: 4, label: "全音符", glyph: "○", shortcut: "1" },
  { beats: 2, label: "二分音符", glyph: "◯│", shortcut: "2" },
  { beats: 1, label: "四分音符", glyph: "♩", shortcut: "3" },
  { beats: 0.5, label: "八分音符", glyph: "♪", shortcut: "4" },
  { beats: 0.25, label: "十六分音符", glyph: "♬", shortcut: "5" },
] as const;

export const KEY_SIGNATURES = [
  { fifths: -7, name: "C♭ 大调 / A♭ 小调" },
  { fifths: -6, name: "G♭ 大调 / E♭ 小调" },
  { fifths: -5, name: "D♭ 大调 / B♭ 小调" },
  { fifths: -4, name: "A♭ 大调 / F 小调" },
  { fifths: -3, name: "E♭ 大调 / C 小调" },
  { fifths: -2, name: "B♭ 大调 / G 小调" },
  { fifths: -1, name: "F 大调 / D 小调" },
  { fifths: 0, name: "C 大调 / A 小调" },
  { fifths: 1, name: "G 大调 / E 小调" },
  { fifths: 2, name: "D 大调 / B 小调" },
  { fifths: 3, name: "A 大调 / F♯ 小调" },
  { fifths: 4, name: "E 大调 / C♯ 小调" },
  { fifths: 5, name: "B 大调 / G♯ 小调" },
  { fifths: 6, name: "F♯ 大调 / D♯ 小调" },
  { fifths: 7, name: "C♯ 大调 / A♯ 小调" },
] as const;

const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11];
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

export function createEmptyScore(locale: "zh-CN" | "en" = "zh-CN"): PitchScore {
  const stamp = Date.now();
  return {
    $schema: "https://raw.githubusercontent.com/polynomial1027/songs-tuner/main/schema/singright-score.schema.json",
    format: "singright-score",
    version: 1,
    metadata: {
      id: `score-${stamp}`,
      title: locale === "zh-CN" ? "未命名曲谱" : "Untitled Score",
      artist: "",
      description: locale === "zh-CN" ? "使用 SingRight 曲谱编辑器创作" : "Created with the SingRight score editor",
    },
    tempo: { bpm: 88 },
    timeSignature: { beats: 4, beatUnit: 4 },
    tuning: { referenceHz: 440, tonicMidi: 60 },
    notation: { clef: "treble", keySignature: 0 },
    notes: [],
  };
}

export function cloneScore(score: PitchScore): PitchScore {
  return JSON.parse(JSON.stringify({
    ...score,
    notation: score.notation ?? { clef: "treble", keySignature: 0 },
  })) as PitchScore;
}

export function scoreEndBeat(score: PitchScore): number {
  return score.notes.reduce((end, note) => Math.max(end, note.beat + note.durationBeats), 0);
}

export function quantizeBeat(beat: number, grid: number): number {
  return Math.max(0, Math.round(beat / grid) * grid);
}

export function nextOpenBeat(score: PitchScore): number {
  return scoreEndBeat(score);
}

export function placeNote(score: PitchScore, note: ScoreNote): PitchScore {
  const start = note.beat;
  const end = note.beat + note.durationBeats;
  const withoutConflicts = score.notes.filter((candidate) => {
    const candidateEnd = candidate.beat + candidate.durationBeats;
    return candidateEnd <= start + 0.0001 || candidate.beat >= end - 0.0001 || candidate.id === note.id;
  }).filter((candidate) => candidate.id !== note.id);
  return {
    ...score,
    notes: [...withoutConflicts, note].sort((a, b) => a.beat - b.beat),
  };
}

export function updateNote(score: PitchScore, id: string, patch: Partial<ScoreNote>): PitchScore {
  const current = score.notes.find((note) => note.id === id);
  if (!current) return score;
  return placeNote(score, { ...current, ...patch, id });
}

export function deleteNote(score: PitchScore, id: string): PitchScore {
  return { ...score, notes: score.notes.filter((note) => note.id !== id) };
}

export function makeNoteId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function midiSpelling(midi: number, fifths = 0): string {
  const rounded = Math.max(0, Math.min(127, Math.round(midi)));
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${(fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pitchClass]}${octave}`;
}

export function parseSpelling(spelling: string): { step: string; alter: number; octave: number } {
  const match = /^([A-G])([♯♭#b]?)(-?\d+)$/.exec(spelling);
  if (!match) return { step: "C", alter: 0, octave: 4 };
  return {
    step: match[1],
    alter: match[2] === "♯" || match[2] === "#" ? 1 : match[2] === "♭" || match[2] === "b" ? -1 : 0,
    octave: Number(match[3]),
  };
}

export function midiFromStep(step: string, octave: number, accidental: Accidental): number {
  const index = "CDEFGAB".indexOf(step.toUpperCase());
  return Math.max(0, Math.min(127, 12 * (octave + 1) + NATURAL_PITCH_CLASSES[Math.max(0, index)] + accidental));
}

export function diatonicIndexFromMidi(midi: number, fifths = 0): number {
  const spelling = parseSpelling(midiSpelling(midi, fifths));
  return spelling.octave * 7 + "CDEFGAB".indexOf(spelling.step);
}

export function midiFromDiatonicIndex(index: number, accidental: Accidental): number {
  const octave = Math.floor(index / 7);
  const stepIndex = ((index % 7) + 7) % 7;
  return Math.max(0, Math.min(127, 12 * (octave + 1) + NATURAL_PITCH_CLASSES[stepIndex] + accidental));
}

export function staffYForMidi(midi: number, clef: Clef, fifths = 0): number {
  const bottomLineIndex = clef === "treble" ? 4 * 7 + 2 : 2 * 7 + 4;
  return 91 - (diatonicIndexFromMidi(midi, fifths) - bottomLineIndex) * 5;
}

export function midiForStaffY(y: number, clef: Clef, accidental: Accidental): number {
  const bottomLineIndex = clef === "treble" ? 4 * 7 + 2 : 2 * 7 + 4;
  const steps = Math.round((91 - y) / 5);
  return midiFromDiatonicIndex(bottomLineIndex + steps, accidental);
}

export function durationName(beats: number): string {
  const exact = DURATION_OPTIONS.find((option) => option.beats === beats);
  if (exact) return exact.label;
  const dotted = DURATION_OPTIONS.find((option) => option.beats * 1.5 === beats);
  return dotted ? `附点${dotted.label}` : `${beats} 拍`;
}

export function noteTypeForBeats(beats: number): "whole" | "half" | "quarter" | "eighth" | "16th" {
  const undotted = beats / 1.5;
  const value = DURATION_OPTIONS.some((item) => item.beats === undotted) ? undotted : beats;
  if (value >= 4) return "whole";
  if (value >= 2) return "half";
  if (value >= 1) return "quarter";
  if (value >= 0.5) return "eighth";
  return "16th";
}
