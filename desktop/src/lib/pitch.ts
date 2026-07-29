import type { AnalysisFrame } from "../types";
import { frequencyToMidi } from "./music";

export interface DetectedPitch {
  frequency: number;
  confidence: number;
  rms: number;
}

export function detectPitchYin(
  samples: Float32Array,
  sampleRate: number,
  minFrequency = 65,
  maxFrequency = 1000,
  threshold = 0.14,
): DetectedPitch | null {
  let rmsSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    rmsSum += samples[index] * samples[index];
  }
  const rms = Math.sqrt(rmsSum / samples.length);
  if (rms < 0.008) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(samples.length / 2));
  const difference = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < samples.length - tau; index += 1) {
      const delta = samples[index] - samples[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  let runningSum = 0;
  difference[0] = 1;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    difference[tau] = runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum;
  }

  let chosenTau = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (difference[tau] < threshold) {
      while (tau + 1 <= maxTau && difference[tau + 1] < difference[tau]) tau += 1;
      chosenTau = tau;
      break;
    }
  }

  if (chosenTau < 0) {
    let bestValue = 1;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (difference[tau] < bestValue) {
        bestValue = difference[tau];
        chosenTau = tau;
      }
    }
    if (bestValue > 0.35) return null;
  }

  const left = chosenTau > minTau ? difference[chosenTau - 1] : difference[chosenTau];
  const center = difference[chosenTau];
  const right = chosenTau < maxTau ? difference[chosenTau + 1] : difference[chosenTau];
  const denominator = 2 * (2 * center - right - left);
  const refinedTau = denominator === 0 ? chosenTau : chosenTau + (right - left) / denominator;
  const frequency = sampleRate / refinedTau;
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) return null;

  return {
    frequency,
    confidence: Math.max(0, Math.min(1, 1 - difference[chosenTau])),
    rms,
  };
}

export async function analyzeAudioFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<AnalysisFrame[]> {
  const context = new AudioContext();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(arrayBuffer);
    const channelCount = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const frameSize = 4096;
    const hopSize = 2048;
    const frames: AnalysisFrame[] = [];
    const mono = new Float32Array(buffer.length);

    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = buffer.getChannelData(channel);
      for (let index = 0; index < source.length; index += 1) mono[index] += source[index] / channelCount;
    }

    for (let offset = 0; offset + frameSize <= mono.length; offset += hopSize) {
      const detected = detectPitchYin(mono.subarray(offset, offset + frameSize), sampleRate);
      frames.push({
        time: offset / sampleRate,
        frequency: detected?.frequency ?? null,
        midi: detected ? frequencyToMidi(detected.frequency) : null,
        confidence: detected?.confidence ?? 0,
      });
      if (frames.length % 48 === 0) {
        onProgress?.(offset / mono.length);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
    onProgress?.(1);
    return frames;
  } finally {
    await context.close();
  }
}
