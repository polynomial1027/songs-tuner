import type { PitchScore, ScoreNote } from "../types";
import { createEmptyScore, makeNoteId, measureLengthBeats, mergeTiedNotes, midiSpelling, parseSpelling, scoreEndBeat } from "./composer";
import { validateScore } from "./score";

const TYPE_BY_BEATS: Array<[number, string]> = [
  [4, "whole"],
  [2, "half"],
  [1, "quarter"],
  [0.5, "eighth"],
  [0.25, "16th"],
];

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function typeForDuration(beats: number): { type: string; dotted: boolean } {
  const exact = TYPE_BY_BEATS.find(([value]) => Math.abs(value - beats) < 0.001);
  if (exact) return { type: exact[1], dotted: false };
  const dotted = TYPE_BY_BEATS.find(([value]) => Math.abs(value * 1.5 - beats) < 0.001);
  return { type: dotted?.[1] ?? "quarter", dotted: Boolean(dotted) };
}

export function scoreToMusicXml(score: PitchScore): string {
  const divisions = 480;
  const beatsPerMeasure = measureLengthBeats(score);
  const totalMeasures = Math.max(1, Math.ceil(
    scoreEndBeat(score) / beatsPerMeasure,
  ));
  const measures = Array.from({ length: totalMeasures }, (_, measureIndex) => {
    const startBeat = measureIndex * beatsPerMeasure;
    const endBeat = startBeat + beatsPerMeasure;
    const notes = score.notes.filter((note) => note.beat >= startBeat && note.beat < endBeat);
    const keyChanges = (score.notation?.keyChanges ?? []).filter((change) => change.beat >= startBeat && change.beat < endBeat);
    const clefChanges = (score.notation?.clefChanges ?? []).filter((change) => change.beat >= startBeat && change.beat < endBeat);
    const timeline = [
      ...keyChanges
        .filter((change) => measureIndex > 0 || change.beat > 0.0001)
        .map((change) => ({ beat: change.beat, order: 0, xml: `<attributes><key><fifths>${change.fifths}</fifths></key></attributes>` })),
      ...clefChanges
        .filter((change) => measureIndex > 0 || change.beat > 0.0001)
        .map((change) => ({ beat: change.beat, order: 0, xml: `<attributes><clef><sign>${change.clef === "bass" ? "F" : "G"}</sign><line>${change.clef === "bass" ? 4 : 2}</line></clef></attributes>` })),
      ...notes.map((note) => ({ beat: note.beat, order: 1, note })),
    ].sort((a, b) => a.beat - b.beat || a.order - b.order);
    let cursor = startBeat;
    const body: string[] = [];
    for (const item of timeline) {
      if (item.beat > cursor) {
        const gap = item.beat - cursor;
        body.push(`<note><rest/><duration>${Math.round(gap * divisions)}</duration><type>${typeForDuration(gap).type}</type></note>`);
        cursor = item.beat;
      }
      if (!("note" in item)) {
        body.push(item.xml);
        continue;
      }
      const note = item.note;
      const notation = typeForDuration(note.durationBeats);
      const pitch = note.midi === null ? "<rest/>" : (() => {
        const spelling = parseSpelling(note.spelling || midiSpelling(note.midi, score.notation?.keySignature));
        return `<pitch><step>${spelling.step}</step>${spelling.alter ? `<alter>${spelling.alter}</alter>` : ""}<octave>${spelling.octave}</octave></pitch>`;
      })();
      const noteIndex = score.notes.findIndex((candidate) => candidate.id === note.id);
      const previousTied = Boolean(score.notes[noteIndex - 1]?.tieToNext && score.notes[noteIndex - 1]?.midi === note.midi);
      const tieTags = `${previousTied ? '<tie type="stop"/>' : ""}${note.tieToNext ? '<tie type="start"/>' : ""}`;
      const tiedNotation = previousTied || note.tieToNext
        ? `<notations>${previousTied ? '<tied type="stop"/>' : ""}${note.tieToNext ? '<tied type="start"/>' : ""}</notations>`
        : "";
      const accidental = note.explicitAccidental ? `<accidental>${note.explicitAccidental}</accidental>` : "";
      body.push(`<note>${pitch}<duration>${Math.round(note.durationBeats * divisions)}</duration>${tieTags}<type>${notation.type}</type>${notation.dotted ? "<dot/>" : ""}${accidental}${tiedNotation}${note.lyric ? `<lyric><text>${escapeXml(note.lyric)}</text></lyric>` : ""}</note>`);
      cursor = note.beat + note.durationBeats;
    }
    if (cursor < endBeat) {
      const gap = endBeat - cursor;
      body.push(`<note><rest/><duration>${Math.round(gap * divisions)}</duration><type>${typeForDuration(gap).type}</type></note>`);
    }
    const attributes = measureIndex === 0
      ? `<attributes><divisions>${divisions}</divisions><key><fifths>${score.notation?.keySignature ?? 0}</fifths></key><time><beats>${score.timeSignature.beats}</beats><beat-type>${score.timeSignature.beatUnit}</beat-type></time><clef><sign>${score.notation?.clef === "bass" ? "F" : "G"}</sign><line>${score.notation?.clef === "bass" ? 4 : 2}</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo.bpm}</per-minute></metronome></direction-type><sound tempo="${score.tempo.bpm}"/></direction>`
      : "";
    const repeatStart = score.notation?.repeats?.some((marker) => marker.type === "start" && Math.abs(marker.beat - startBeat) < 0.0001)
      ? '<barline location="left"><repeat direction="forward"/></barline>'
      : "";
    const repeatEnd = score.notation?.repeats?.some((marker) => marker.type === "end" && Math.abs(marker.beat - startBeat) < 0.0001)
      ? '<barline location="left"><repeat direction="backward"/></barline>'
      : "";
    return `<measure number="${measureIndex + 1}">${attributes}${repeatStart}${repeatEnd}${body.join("")}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${escapeXml(score.metadata.title)}</work-title></work>
  <identification><creator type="composer">${escapeXml(score.metadata.artist || "")}</creator><encoding><software>SingRight</software></encoding></identification>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">${measures.join("")}</part>
</score-partwise>`;
}

function textOf(parent: Element, selector: string): string {
  return parent.querySelector(selector)?.textContent?.trim() ?? "";
}

export function musicXmlToScore(xml: string): PitchScore {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("MusicXML 文件无法解析");
  const draft = createEmptyScore();
  const title = textOf(documentNode.documentElement, "work-title") || textOf(documentNode.documentElement, "movement-title") || "导入的 MusicXML";
  const artist = textOf(documentNode.documentElement, "creator");
  const firstMeasure = documentNode.querySelector("part measure");
  const divisions = Number(textOf(firstMeasure ?? documentNode.documentElement, "divisions")) || 1;
  const beats = Number(textOf(firstMeasure ?? documentNode.documentElement, "time beats")) || 4;
  const beatUnit = Number(textOf(firstMeasure ?? documentNode.documentElement, "time beat-type")) || 4;
  const beatsPerMeasure = beats * (4 / beatUnit);
  const bpm = Number(firstMeasure?.querySelector("sound")?.getAttribute("tempo"))
    || Number(textOf(firstMeasure ?? documentNode.documentElement, "per-minute"))
    || 88;
  const fifths = Number(textOf(firstMeasure ?? documentNode.documentElement, "key fifths")) || 0;
  const clef = textOf(firstMeasure ?? documentNode.documentElement, "clef sign") === "F" ? "bass" : "treble";
  const notes: ScoreNote[] = [];
  const keyChanges: NonNullable<PitchScore["notation"]>["keyChanges"] = [];
  const clefChanges: NonNullable<PitchScore["notation"]>["clefChanges"] = [];
  const repeats: NonNullable<PitchScore["notation"]>["repeats"] = [];
  let absoluteBeat = 0;
  documentNode.querySelectorAll("part measure").forEach((measure, measureIndex) => {
    let cursor = measureIndex * beatsPerMeasure;
    measure.querySelectorAll(":scope > note, :scope > forward, :scope > backup, :scope > attributes, :scope > barline").forEach((node) => {
      if (node.tagName === "attributes") {
        const keyValue = textOf(node, "key fifths");
        const clefValue = textOf(node, "clef sign");
        if (keyValue && (measureIndex > 0 || cursor > 0.0001)) keyChanges.push({ beat: cursor, fifths: Math.max(-7, Math.min(7, Number(keyValue))) });
        if (clefValue && (measureIndex > 0 || cursor > 0.0001)) clefChanges.push({ beat: cursor, clef: clefValue === "F" ? "bass" : "treble" });
        return;
      }
      if (node.tagName === "barline") {
        const direction = node.querySelector("repeat")?.getAttribute("direction");
        if (direction) repeats.push({ beat: cursor, type: direction === "forward" ? "start" : "end" });
        return;
      }
      const duration = (Number(textOf(node, "duration")) || divisions) / divisions;
      if (node.tagName === "forward") {
        cursor += duration;
        return;
      }
      if (node.tagName === "backup") {
        cursor = Math.max(measureIndex * beatsPerMeasure, cursor - duration);
        return;
      }
      if (node.querySelector("chord")) return;
      const rest = Boolean(node.querySelector("rest"));
      let midi: number | null = null;
      let spelling: string | undefined;
      if (!rest) {
        const step = textOf(node, "pitch step");
        const alter = Number(textOf(node, "pitch alter")) || 0;
        const octave = Number(textOf(node, "pitch octave")) || 4;
        const pitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step as "C"] ?? 0;
        midi = Math.max(0, Math.min(127, 12 * (octave + 1) + pitchClass + alter));
        spelling = `${step}${alter === 1 ? "♯" : alter === -1 ? "♭" : ""}${octave}`;
      }
      notes.push({
        id: makeNoteId(),
        midi,
        beat: cursor,
        durationBeats: duration,
        spelling,
        lyric: textOf(node, "lyric text") || undefined,
        explicitAccidental: (textOf(node, "accidental") || undefined) as ScoreNote["explicitAccidental"],
        tieToNext: Boolean(node.querySelector('tie[type="start"], tied[type="start"]')),
      });
      cursor += duration;
      absoluteBeat = Math.max(absoluteBeat, cursor);
    });
  });
  return validateScore({
    ...draft,
    metadata: {
      ...draft.metadata,
      id: `musicxml-${Date.now()}`,
      title,
      artist,
      description: `从 MusicXML 导入 · ${Math.ceil(absoluteBeat / beatsPerMeasure)} 小节`,
    },
    tempo: { bpm: Math.max(20, Math.min(300, bpm)) },
    timeSignature: { beats, beatUnit },
    notation: {
      clef,
      keySignature: Math.max(-7, Math.min(7, fifths)),
      keyChanges,
      clefChanges,
      repeats,
    },
    notes: notes.sort((a, b) => a.beat - b.beat),
  });
}

export async function parseNotationFile(file: File): Promise<PitchScore> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".musicxml") || lower.endsWith(".xml")) return musicXmlToScore(await file.text());
  const parsed = JSON.parse(await file.text()) as unknown;
  return validateScore(parsed);
}

function variableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= ((value & 0x7f) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function numberBytes(value: number, length: number): number[] {
  return Array.from({ length }, (_, index) => (value >> ((length - index - 1) * 8)) & 0xff);
}

export function scoreToMidi(score: PitchScore): Uint8Array {
  const division = 480;
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [];
  const micros = Math.round(60_000_000 / score.tempo.bpm);
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, ...numberBytes(micros, 3)] });
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, score.timeSignature.beats, Math.log2(score.timeSignature.beatUnit), 24, 8] });
  for (const note of mergeTiedNotes(score).notes) {
    if (note.midi === null) continue;
    const start = Math.round(note.beat * division);
    const end = Math.round((note.beat + note.durationBeats) * division);
    events.push({ tick: start, order: 1, bytes: [0x90, Math.round(note.midi), 88] });
    events.push({ tick: end, order: 0, bytes: [0x80, Math.round(note.midi), 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let previousTick = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  return new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64],
    ...numberBytes(6, 4),
    ...numberBytes(0, 2),
    ...numberBytes(1, 2),
    ...numberBytes(division, 2),
    ...[0x4d, 0x54, 0x72, 0x6b],
    ...numberBytes(track.length, 4),
    ...track,
  ]);
}
