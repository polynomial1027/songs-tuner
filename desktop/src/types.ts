export type PracticeMode = "step" | "continuous" | "review";

export interface ScoreNote {
  id: string;
  midi: number | null;
  beat: number;
  durationBeats: number;
  numeral?: string;
  lyric?: string;
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
