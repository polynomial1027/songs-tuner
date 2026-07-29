const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function midiToFrequency(midi: number, referenceHz = 440): number {
  return referenceHz * Math.pow(2, (midi - 69) / 12);
}

export function referenceHzForAnchor(frequency: number, targetMidi: number): number {
  return frequency / Math.pow(2, (targetMidi - 69) / 12);
}

export function frequencyToMidi(frequency: number, referenceHz = 440): number {
  return 69 + 12 * Math.log2(frequency / referenceHz);
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NAMES[pitchClass]}${octave}`;
}

export function centsBetweenFrequency(
  frequency: number,
  targetMidi: number,
  referenceHz = 440,
): number {
  return 1200 * Math.log2(frequency / midiToFrequency(targetMidi, referenceHz));
}

export function clampCents(cents: number): number {
  return Math.max(-100, Math.min(100, cents));
}

export function numeralForMidi(midi: number, tonicMidi: number): string {
  const distance = Math.round(midi) - tonicMidi;
  const normalized = ((distance % 12) + 12) % 12;
  const map: Record<number, string> = {
    0: "1",
    1: "♯1",
    2: "2",
    3: "♯2",
    4: "3",
    5: "4",
    6: "♯4",
    7: "5",
    8: "♯5",
    9: "6",
    10: "♯6",
    11: "7",
  };
  const octave = Math.floor(distance / 12);
  const suffix = octave > 0 ? "·".repeat(octave) : octave < 0 ? "̣".repeat(-octave) : "";
  return `${map[normalized]}${suffix}`;
}

export function signed(value: number): string {
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}
