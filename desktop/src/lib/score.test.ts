import { describe, expect, it } from "vitest";
import scale from "../data/ascending-scale.json";
import { buildSessionResult, scoreDurationSeconds, validateScore } from "./score";

describe("score utilities", () => {
  it("validates the built-in score", () => {
    expect(validateScore(scale).notes).toHaveLength(8);
  });

  it("calculates duration from beats and tempo", () => {
    expect(scoreDurationSeconds(validateScore(scale))).toBe(15);
  });

  it("scores aligned pitch frames", () => {
    const score = validateScore(scale);
    const frames = score.notes.flatMap((note) => {
      const start = (note.beat * 60) / score.tempo.bpm;
      return [0.1, 0.2, 0.3].map((offset) => ({
        time: start + offset,
        frequency: 440,
        midi: note.midi,
        confidence: 0.99,
      }));
    });
    expect(buildSessionResult(score, frames, 0, 30, "test").score).toBe(100);
  });
});
