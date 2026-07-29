import { describe, expect, it } from "vitest";
import {
  createEmptyScore,
  activeClefAt,
  activeKeySignatureAt,
  canTieToNext,
  deleteNote,
  measureLengthBeats,
  mergeTiedNotes,
  midiForStaffY,
  midiSpelling,
  notePlacementIssue,
  placeNote,
  quantizeBeat,
  restGlyphForBeats,
  scoreEndBeat,
  staffYForMidi,
  toggleRepeatMarker,
  upsertClefChange,
  upsertKeySignatureChange,
  updateNote,
} from "./composer";
import { scoreToMidi, scoreToMusicXml } from "./musicxml";

describe("composer score operations", () => {
  it("places notes in order and replaces overlapping material", () => {
    let score = createEmptyScore();
    score = placeNote(score, { id: "b", midi: 62, beat: 1, durationBeats: 1 });
    score = placeNote(score, { id: "a", midi: 60, beat: 0, durationBeats: 1 });
    score = placeNote(score, { id: "c", midi: 64, beat: 0.5, durationBeats: 1 });
    expect(score.notes.map((note) => note.id)).toEqual(["c"]);
    expect(scoreEndBeat(score)).toBe(1.5);
  });

  it("updates and removes a selected note", () => {
    let score = placeNote(createEmptyScore(), { id: "a", midi: 60, beat: 0, durationBeats: 1 });
    score = updateNote(score, "a", { midi: 61, lyric: "唱" });
    expect(score.notes[0]).toMatchObject({ midi: 61, lyric: "唱" });
    expect(deleteNote(score, "a").notes).toHaveLength(0);
  });

  it("round-trips staff positions and quantizes beat input", () => {
    for (const clef of ["treble", "bass"] as const) {
      const y = staffYForMidi(60, clef);
      expect(midiForStaffY(y, clef, 0)).toBe(60);
    }
    expect(quantizeBeat(1.38, 0.25)).toBe(1.5);
  });

  it("enforces a fixed grid and strict measure capacity", () => {
    const score = placeNote(createEmptyScore(), { id: "a", midi: 60, beat: 0, durationBeats: 1 });
    expect(measureLengthBeats(score)).toBe(4);
    expect(notePlacementIssue(score, { id: "b", midi: 62, beat: 1, durationBeats: 1 })).toBeNull();
    expect(notePlacementIssue(score, { id: "b", midi: 62, beat: 0.5, durationBeats: 1 })).toBe("overlap");
    expect(notePlacementIssue(score, { id: "b", midi: 62, beat: 3.5, durationBeats: 1 })).toBe("crosses-measure");
    expect(notePlacementIssue(score, { id: "b", midi: 62, beat: 1.01, durationBeats: 1 })).toBe("invalid-grid");
    expect(notePlacementIssue(score, { id: "b", midi: 62, beat: 1.125, durationBeats: 0.25 })).toBe("invalid-grid");

    const sixEight = { ...score, timeSignature: { beats: 6, beatUnit: 8 as const } };
    expect(measureLengthBeats(sixEight)).toBe(3);
    expect(notePlacementIssue(sixEight, { id: "b", midi: 62, beat: 2.5, durationBeats: 1 })).toBe("crosses-measure");
  });

  it("uses proper rest glyphs and preserves flat or sharp spelling", () => {
    expect([4, 2, 1, 0.5, 0.25].map(restGlyphForBeats)).toEqual(["𝄻", "𝄼", "𝄽", "𝄾", "𝄿"]);
    expect(midiSpelling(61, 0, -1)).toBe("D♭4");
    expect(midiSpelling(61, 0, 1)).toBe("C♯4");
    expect(midiSpelling(61, -1, 0)).toBe("D♭4");
  });

  it("exports interoperable MusicXML and a valid MIDI header", () => {
    const score = placeNote(createEmptyScore(), { id: "a", midi: 60, beat: 0, durationBeats: 1, lyric: "啦" });
    const xml = scoreToMusicXml(score);
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<step>C</step>");
    expect(xml).toContain("<text>啦</text>");
    expect(Array.from(scoreToMidi(score).slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]);
  });

  it("stores persistent key, clef, and repeat changes on the timeline", () => {
    let score = createEmptyScore();
    score = upsertKeySignatureChange(score, 4, 2);
    score = upsertKeySignatureChange(score, 8, 0);
    score = upsertClefChange(score, 4, "bass");
    score = toggleRepeatMarker(score, 4.2, "start");
    expect(activeKeySignatureAt(score, 7.75)).toBe(2);
    expect(activeKeySignatureAt(score, 8)).toBe(0);
    expect(activeClefAt(score, 4)).toBe("bass");
    expect(score.notation?.repeats).toEqual([{ beat: 4, type: "start" }]);
    const xml = scoreToMusicXml(score);
    expect(xml).toContain("<fifths>2</fifths>");
    expect(xml).toContain("<fifths>0</fifths>");
    expect(xml).toContain('<repeat direction="forward"/>');
  });

  it("merges valid same-pitch ties for playback and export timing", () => {
    let score = createEmptyScore();
    score = placeNote(score, { id: "a", midi: 60, beat: 0, durationBeats: 1, tieToNext: true });
    score = placeNote(score, { id: "b", midi: 60, beat: 1, durationBeats: 2 });
    expect(canTieToNext(score, "a")).toBe(true);
    expect(mergeTiedNotes(score).notes).toEqual([
      expect.objectContaining({ id: "a", midi: 60, beat: 0, durationBeats: 3, tieToNext: undefined }),
    ]);
    const xml = scoreToMusicXml(score);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
  });

  it("uses the beat unit when splitting MusicXML measures", () => {
    let score = createEmptyScore();
    score = { ...score, timeSignature: { beats: 6, beatUnit: 8 } };
    score = placeNote(score, { id: "a", midi: 60, beat: 0, durationBeats: 1 });
    score = placeNote(score, { id: "b", midi: 62, beat: 3, durationBeats: 1 });
    const xml = scoreToMusicXml(score);
    expect(xml).toContain('<measure number="2"><note><pitch><step>D</step>');
  });
});
