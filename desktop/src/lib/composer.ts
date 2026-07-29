import type { ClefChange, KeySignatureChange, PitchScore, RepeatMarker, ScoreNote } from "../types";

export type Clef = "treble" | "bass";
export type Accidental = -1 | 0 | 1;
export type PlacementIssue = "invalid-grid" | "crosses-measure" | "overlap";

// The editor is intentionally limited to a sixteenth-note grid. Longer values
// occupy multiple adjacent cells instead of creating a second, finer grid.
export const EDIT_GRID_BEATS = 0.25;

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
    notation: {
      clef: score.notation?.clef ?? "treble",
      keySignature: score.notation?.keySignature ?? 0,
      keyChanges: score.notation?.keyChanges ?? [],
      clefChanges: score.notation?.clefChanges ?? [],
      repeats: score.notation?.repeats ?? [],
    },
  })) as PitchScore;
}

export function scoreEndBeat(score: PitchScore): number {
  const noteEnd = score.notes.reduce((end, note) => Math.max(end, note.beat + note.durationBeats), 0);
  const eventBeats = [
    ...(score.notation?.keyChanges ?? []).map((change) => change.beat),
    ...(score.notation?.clefChanges ?? []).map((change) => change.beat),
    ...(score.notation?.repeats ?? []).map((marker) => marker.beat),
  ];
  return eventBeats.reduce((end, beat) => Math.max(end, beat + EDIT_GRID_BEATS), noteEnd);
}

export function measureLengthBeats(score: Pick<PitchScore, "timeSignature">): number {
  return score.timeSignature.beats * (4 / score.timeSignature.beatUnit);
}

export function quantizeBeat(beat: number, grid: number): number {
  return Math.max(0, Math.round(beat / grid) * grid);
}

export function nextOpenBeat(score: PitchScore): number {
  return quantizeBeat(scoreEndBeat(score), EDIT_GRID_BEATS);
}

export function nextMeasureBeat(score: Pick<PitchScore, "timeSignature">, beat: number): number {
  const length = measureLengthBeats(score);
  return (Math.floor((beat + 0.0001) / length) + 1) * length;
}

export function activeKeySignatureAt(score: PitchScore, beat: number): number {
  return [...(score.notation?.keyChanges ?? [])]
    .filter((change) => change.beat <= beat + 0.0001)
    .sort((a, b) => b.beat - a.beat)[0]?.fifths ?? score.notation?.keySignature ?? 0;
}

export function activeClefAt(score: PitchScore, beat: number): Clef {
  return [...(score.notation?.clefChanges ?? [])]
    .filter((change) => change.beat <= beat + 0.0001)
    .sort((a, b) => b.beat - a.beat)[0]?.clef ?? score.notation?.clef ?? "treble";
}

export function upsertKeySignatureChange(score: PitchScore, beat: number, fifths: number): PitchScore {
  const normalizedBeat = quantizeBeat(beat, EDIT_GRID_BEATS);
  const change: KeySignatureChange = {
    beat: normalizedBeat,
    fifths: Math.max(-7, Math.min(7, Math.round(fifths))),
  };
  const keyChanges = [
    ...(score.notation?.keyChanges ?? []).filter((item) => Math.abs(item.beat - normalizedBeat) > 0.0001),
    change,
  ].sort((a, b) => a.beat - b.beat);
  return {
    ...score,
    notation: {
      clef: score.notation?.clef ?? "treble",
      keySignature: score.notation?.keySignature ?? 0,
      keyChanges,
      clefChanges: score.notation?.clefChanges ?? [],
      repeats: score.notation?.repeats ?? [],
    },
  };
}

export function upsertClefChange(score: PitchScore, beat: number, clef: Clef): PitchScore {
  const normalizedBeat = quantizeBeat(beat, EDIT_GRID_BEATS);
  const change: ClefChange = { beat: normalizedBeat, clef };
  const clefChanges = [
    ...(score.notation?.clefChanges ?? []).filter((item) => Math.abs(item.beat - normalizedBeat) > 0.0001),
    change,
  ].sort((a, b) => a.beat - b.beat);
  return {
    ...score,
    notation: {
      clef: score.notation?.clef ?? "treble",
      keySignature: score.notation?.keySignature ?? 0,
      keyChanges: score.notation?.keyChanges ?? [],
      clefChanges,
      repeats: score.notation?.repeats ?? [],
    },
  };
}

export function toggleRepeatMarker(score: PitchScore, beat: number, type: RepeatMarker["type"]): PitchScore {
  const measureBeat = Math.floor((beat + 0.0001) / measureLengthBeats(score)) * measureLengthBeats(score);
  const exists = score.notation?.repeats?.some((item) => item.type === type && Math.abs(item.beat - measureBeat) < 0.0001);
  const repeats = exists
    ? (score.notation?.repeats ?? []).filter((item) => item.type !== type || Math.abs(item.beat - measureBeat) > 0.0001)
    : [...(score.notation?.repeats ?? []), { beat: measureBeat, type }].sort((a, b) => a.beat - b.beat);
  return {
    ...score,
    notation: {
      clef: score.notation?.clef ?? "treble",
      keySignature: score.notation?.keySignature ?? 0,
      keyChanges: score.notation?.keyChanges ?? [],
      clefChanges: score.notation?.clefChanges ?? [],
      repeats,
    },
  };
}

export function canTieToNext(score: PitchScore, noteId: string): boolean {
  const index = score.notes.findIndex((note) => note.id === noteId);
  const note = score.notes[index];
  const next = score.notes[index + 1];
  return Boolean(
    note
      && next
      && note.midi !== null
      && note.midi === next.midi
      && Math.abs(note.beat + note.durationBeats - next.beat) < 0.0001,
  );
}

export function mergeTiedNotes(score: PitchScore): PitchScore {
  const notes: ScoreNote[] = [];
  for (const source of score.notes) {
    const previous = notes.at(-1);
    if (
      previous?.tieToNext
      && previous.midi !== null
      && previous.midi === source.midi
      && Math.abs(previous.beat + previous.durationBeats - source.beat) < 0.0001
    ) {
      previous.durationBeats += source.durationBeats;
      previous.tieToNext = source.tieToNext;
      continue;
    }
    notes.push({ ...source });
  }
  return { ...score, notes };
}

export function notePlacementIssue(
  score: PitchScore,
  note: ScoreNote,
  ignoreId?: string,
): PlacementIssue | null {
  const measureBeats = measureLengthBeats(score);
  const start = note.beat;
  const end = note.beat + note.durationBeats;
  const startsOnGrid = Math.abs(start / EDIT_GRID_BEATS - Math.round(start / EDIT_GRID_BEATS)) < 0.0001;
  const durationOnGrid = Math.abs(note.durationBeats / EDIT_GRID_BEATS - Math.round(note.durationBeats / EDIT_GRID_BEATS)) < 0.0001;
  if (start < 0 || note.durationBeats <= 0 || !startsOnGrid || !durationOnGrid) return "invalid-grid";

  const measureStart = Math.floor((start + 0.0001) / measureBeats) * measureBeats;
  if (end > measureStart + measureBeats + 0.0001) return "crosses-measure";

  const overlaps = score.notes.some((candidate) => {
    if (candidate.id === ignoreId || candidate.id === note.id) return false;
    const candidateEnd = candidate.beat + candidate.durationBeats;
    return candidateEnd > start + 0.0001 && candidate.beat < end - 0.0001;
  });
  return overlaps ? "overlap" : null;
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

export function midiSpelling(midi: number, fifths = 0, accidentalPreference: Accidental = 0): string {
  const rounded = Math.max(0, Math.min(127, Math.round(midi)));
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  const preferFlats = accidentalPreference < 0 || (accidentalPreference === 0 && fifths < 0);
  return `${(preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass]}${octave}`;
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

export function restGlyphForBeats(beats: number): string {
  const undotted = DURATION_OPTIONS.some((option) => Math.abs(option.beats * 1.5 - beats) < 0.001)
    ? beats / 1.5
    : beats;
  if (undotted >= 4) return "𝄻";
  if (undotted >= 2) return "𝄼";
  if (undotted >= 1) return "𝄽";
  if (undotted >= 0.5) return "𝄾";
  return "𝄿";
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
