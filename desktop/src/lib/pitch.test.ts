import { describe, expect, it } from "vitest";
import { midiToFrequency } from "./music";
import { detectPitchYin } from "./pitch";

function sine(frequency: number, sampleRate = 48000, length = 4096): Float32Array {
  return Float32Array.from({ length }, (_, index) => Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.7);
}

describe("detectPitchYin", () => {
  it("detects concert A within one cent", () => {
    const result = detectPitchYin(sine(440), 48000);
    expect(result).not.toBeNull();
    expect(result?.frequency).toBeCloseTo(440, 0);
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it("detects C4", () => {
    const target = midiToFrequency(60);
    const result = detectPitchYin(sine(target), 48000);
    expect(result?.frequency).toBeCloseTo(target, 0);
  });

  it("ignores silence", () => {
    expect(detectPitchYin(new Float32Array(4096), 48000)).toBeNull();
  });
});
