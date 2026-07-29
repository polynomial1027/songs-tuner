export type PracticeMode = "step" | "continuous" | "review";

export interface ScoreNote {
  id: string;
  midi: number | null;
  beat: number;
  durationBeats: number;
  numeral?: string;
  lyric?: string;
  spelling?: string;
  explicitAccidental?: "flat" | "natural" | "sharp";
  tieToNext?: boolean;
}

export interface KeySignatureChange {
  beat: number;
  fifths: number;
}

export interface ClefChange {
  beat: number;
  clef: "treble" | "bass";
}

export interface RepeatMarker {
  beat: number;
  type: "start" | "end";
}

export interface PitchScore {
  $schema?: string;
  format: "singright-score";
  version: 1;
  metadata: {
    id: string;
    title: string;
    artist?: string;
    description?: string;
  };
  tempo: { bpm: number };
  timeSignature: { beats: number; beatUnit: 1 | 2 | 4 | 8 | 16 };
  tuning: { referenceHz: number; tonicMidi: number };
  notation?: {
    clef: "treble" | "bass";
    keySignature: number;
    keyChanges?: KeySignatureChange[];
    clefChanges?: ClefChange[];
    repeats?: RepeatMarker[];
  };
  audioGuide?: {
    name: string;
    trimStartSeconds: number;
    trimEndSeconds?: number;
    offsetSeconds: number;
    gain: number;
    playbackRate: number;
  };
  notes: ScoreNote[];
}

export interface PitchReading {
  frequency: number;
  midi: number;
  noteName: string;
  confidence: number;
  levelDb: number;
  capturedAt: number;
}

export interface AnalysisFrame {
  time: number;
  frequency: number | null;
  midi: number | null;
  confidence: number;
}

export interface NoteResult {
  note: ScoreNote;
  targetMidi: number | null;
  meanCents: number | null;
  accuracy: number;
  voicedFrames: number;
  verdict: "excellent" | "good" | "retry" | "rest";
}

export interface SessionResult {
  sourceName: string;
  createdAt: number;
  score: number;
  coverage: number;
  noteResults: NoteResult[];
}
