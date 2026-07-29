import { describe, expect, it } from "vitest";
import { createEmptyScore, deleteNote, midiForStaffY, placeNote, quantizeBeat, scoreEndBeat, staffYForMidi, updateNote } from "./composer";
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

  it("exports interoperable MusicXML and a valid MIDI header", () => {
    const score = placeNote(createEmptyScore(), { id: "a", midi: 60, beat: 0, durationBeats: 1, lyric: "啦" });
    const xml = scoreToMusicXml(score);
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<step>C</step>");
    expect(xml).toContain("<text>啦</text>");
    expect(Array.from(scoreToMidi(score).slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]);
  });
});
