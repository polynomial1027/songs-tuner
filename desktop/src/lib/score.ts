import type { AnalysisFrame, NoteResult, PitchScore, ScoreNote, SessionResult } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateScore(value: unknown): PitchScore {
  if (!isRecord(value)) throw new Error("曲谱根节点必须是对象");
  if (value.format !== "singright-score" || value.version !== 1) {
    throw new Error("只支持 singright-score v1");
  }
  if (!isRecord(value.metadata) || typeof value.metadata.id !== "string" || typeof value.metadata.title !== "string") {
    throw new Error("metadata.id 和 metadata.title 必须存在");
  }
  if (!isRecord(value.tempo) || typeof value.tempo.bpm !== "number" || value.tempo.bpm < 20 || value.tempo.bpm > 300) {
    throw new Error("tempo.bpm 必须在 20–300 之间");
  }
  if (!isRecord(value.timeSignature) || typeof value.timeSignature.beats !== "number" || typeof value.timeSignature.beatUnit !== "number") {
    throw new Error("timeSignature 不完整");
  }
  if (!isRecord(value.tuning) || typeof value.tuning.referenceHz !== "number" || typeof value.tuning.tonicMidi !== "number") {
    throw new Error("tuning.referenceHz 和 tuning.tonicMidi 必须存在");
  }
  if (value.notation !== undefined) {
    if (!isRecord(value.notation) || (value.notation.clef !== "treble" && value.notation.clef !== "bass")
      || typeof value.notation.keySignature !== "number" || value.notation.keySignature < -7 || value.notation.keySignature > 7) {
      throw new Error("notation 的谱号或调号无效");
    }
    const keyChanges = value.notation.keyChanges ?? [];
    const clefChanges = value.notation.clefChanges ?? [];
    const repeats = value.notation.repeats ?? [];
    if (!Array.isArray(keyChanges) || keyChanges.some((change) => !isRecord(change)
      || typeof change.beat !== "number" || change.beat < 0
      || typeof change.fifths !== "number" || change.fifths < -7 || change.fifths > 7)) {
      throw new Error("notation.keyChanges 无效");
    }
    if (!Array.isArray(clefChanges) || clefChanges.some((change) => !isRecord(change)
      || typeof change.beat !== "number" || change.beat < 0
      || (change.clef !== "treble" && change.clef !== "bass"))) {
      throw new Error("notation.clefChanges 无效");
    }
    if (!Array.isArray(repeats) || repeats.some((marker) => !isRecord(marker)
      || typeof marker.beat !== "number" || marker.beat < 0
      || (marker.type !== "start" && marker.type !== "end"))) {
      throw new Error("notation.repeats 无效");
    }
  }
  if (value.audioGuide !== undefined) {
    if (!isRecord(value.audioGuide) || typeof value.audioGuide.name !== "string"
      || typeof value.audioGuide.trimStartSeconds !== "number"
      || typeof value.audioGuide.offsetSeconds !== "number"
      || typeof value.audioGuide.gain !== "number"
      || typeof value.audioGuide.playbackRate !== "number"
      || value.audioGuide.trimStartSeconds < 0
      || value.audioGuide.gain < 0 || value.audioGuide.gain > 1
      || value.audioGuide.playbackRate < 0.25 || value.audioGuide.playbackRate > 2
      || (value.audioGuide.trimEndSeconds !== undefined
        && (typeof value.audioGuide.trimEndSeconds !== "number" || value.audioGuide.trimEndSeconds < value.audioGuide.trimStartSeconds))) {
      throw new Error("audioGuide 参考音频设置无效");
    }
  }
  if (!Array.isArray(value.notes)) throw new Error("notes 必须是数组");

  let previousEnd = 0;
  const seen = new Set<string>();
  for (const rawNote of value.notes) {
    if (!isRecord(rawNote)) throw new Error("每个音符必须是对象");
    if (typeof rawNote.id !== "string" || seen.has(rawNote.id)) throw new Error("每个音符需要唯一 id");
    if (rawNote.midi !== null && (typeof rawNote.midi !== "number" || rawNote.midi < 0 || rawNote.midi > 127)) {
      throw new Error(`音符 ${rawNote.id} 的 midi 无效`);
    }
    if (typeof rawNote.beat !== "number" || typeof rawNote.durationBeats !== "number" || rawNote.durationBeats <= 0) {
      throw new Error(`音符 ${rawNote.id} 的拍点或时值无效`);
    }
    if (rawNote.tieToNext !== undefined && typeof rawNote.tieToNext !== "boolean") {
      throw new Error(`音符 ${rawNote.id} 的延音线设置无效`);
    }
    if (rawNote.explicitAccidental !== undefined
      && !["flat", "natural", "sharp"].includes(String(rawNote.explicitAccidental))) {
      throw new Error(`音符 ${rawNote.id} 的临时升降记号无效`);
    }
    if (rawNote.beat < previousEnd - 0.0001) throw new Error(`音符 ${rawNote.id} 与前一音符重叠或未排序`);
    previousEnd = rawNote.beat + rawNote.durationBeats;
    seen.add(rawNote.id);
  }
  return value as unknown as PitchScore;
}

export async function parseScoreFile(file: File): Promise<PitchScore> {
  if (!file.name.toLowerCase().endsWith(".json")) throw new Error("请选择 .singright.json 文件");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("JSON 语法错误，请检查逗号和引号");
  }
  return validateScore(parsed);
}

export function scoreDurationSeconds(score: PitchScore): number {
  if (score.notes.length === 0) return 0;
  const last = score.notes[score.notes.length - 1];
  return ((last.beat + last.durationBeats) * 60) / score.tempo.bpm;
}

export function noteAtSeconds(score: PitchScore, seconds: number): { note: ScoreNote; index: number } | null {
  const beat = (seconds * score.tempo.bpm) / 60;
  const index = score.notes.findIndex((note) => beat >= note.beat && beat < note.beat + note.durationBeats);
  return index < 0 ? null : { note: score.notes[index], index };
}

export function buildSessionResult(
  score: PitchScore,
  frames: AnalysisFrame[],
  transpose: number,
  toleranceCents: number,
  sourceName: string,
): SessionResult {
  const secondsPerBeat = 60 / score.tempo.bpm;
  const noteResults: NoteResult[] = score.notes.map((note) => {
    const start = note.beat * secondsPerBeat;
    const end = (note.beat + note.durationBeats) * secondsPerBeat;
    const edgeMargin = Math.min(0.04, (end - start) * 0.05);
    const targetMidi = note.midi === null ? null : note.midi + transpose;
    if (targetMidi === null) {
      return { note, targetMidi, meanCents: null, accuracy: 100, voicedFrames: 0, verdict: "rest" };
    }
    const matching = frames.filter(
      (frame) => frame.time >= start + edgeMargin
        && frame.time < end - edgeMargin
        && frame.midi !== null
        && frame.confidence >= 0.55,
    );
    if (matching.length === 0) {
      return { note, targetMidi, meanCents: null, accuracy: 0, voicedFrames: 0, verdict: "retry" };
    }
    const cents = matching.map((frame) => ((frame.midi as number) - targetMidi) * 100);
    const meanCents = cents.reduce((sum, value) => sum + value, 0) / cents.length;
    const within = cents.filter((value) => Math.abs(value) <= toleranceCents).length;
    const accuracy = Math.round((within / cents.length) * 100);
    const verdict = accuracy >= 85 ? "excellent" : accuracy >= 60 ? "good" : "retry";
    return { note, targetMidi, meanCents, accuracy, voicedFrames: matching.length, verdict };
  });
  const pitched = noteResults.filter((result) => result.targetMidi !== null);
  const scoreValue = pitched.length
    ? Math.round(pitched.reduce((sum, result) => sum + result.accuracy, 0) / pitched.length)
    : 0;
  const covered = pitched.filter((result) => result.voicedFrames > 0).length;
  return {
    sourceName,
    createdAt: Date.now(),
    score: scoreValue,
    coverage: pitched.length ? Math.round((covered / pitched.length) * 100) : 0,
    noteResults,
  };
}
