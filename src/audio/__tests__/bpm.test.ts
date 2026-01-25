import { describe, expect, it } from "vitest";
import { estimateBpmFromBuffer, estimateBpmFromSamples } from "../bpm";

const createPulseTrain = (frameSize: number, frames: number, period: number) => {
  const samples = new Float32Array(frameSize * frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = frame % period === 0 ? 1 : 0;
    const start = frame * frameSize;
    const end = start + frameSize;
    for (let i = start; i < end; i += 1) {
      samples[i] = value;
    }
  }
  return samples;
};

describe("estimateBpmFromSamples", () => {
  it("returns null and zero confidence for empty samples", () => {
    const result = estimateBpmFromSamples(new Float32Array(0), 44100);
    expect(result).toEqual({ bpm: null, confidence: 0 });
  });

  it("returns null and zero confidence for short envelopes", () => {
    const sampleRate = 11025;
    const frameSize = 1024;
    const samples = new Float32Array(frameSize * 7);
    const result = estimateBpmFromSamples(samples, sampleRate);
    expect(result).toEqual({ bpm: null, confidence: 0 });
  });

  it("returns null and zero confidence for silence", () => {
    const sampleRate = 11025;
    const frameSize = 1024;
    const samples = new Float32Array(frameSize * 10);
    const result = estimateBpmFromSamples(samples, sampleRate);
    expect(result).toEqual({ bpm: null, confidence: 0 });
  });

  it("detects a stable periodic pulse train within the allowed range", () => {
    const sampleRate = 11025;
    const frameSize = 1024;
    const samples = createPulseTrain(frameSize, 50, 5);
    const result = estimateBpmFromSamples(samples, sampleRate);
    expect(result.bpm).not.toBeNull();
    if (result.bpm !== null) {
      expect(result.bpm).toBeGreaterThanOrEqual(60);
      expect(result.bpm).toBeLessThanOrEqual(200);
    }
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("estimateBpmFromBuffer", () => {
  it("delegates to sample-based estimation", () => {
    const sampleRate = 11025;
    const frameSize = 1024;
    const samples = createPulseTrain(frameSize, 50, 5);
    const buffer = {
      length: samples.length,
      sampleRate,
      getChannelData: () => samples,
    } as AudioBuffer;

    const result = estimateBpmFromBuffer(buffer);
    expect(result.bpm).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });
});
