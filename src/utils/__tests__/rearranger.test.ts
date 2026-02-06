import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildRearrangerMap,
  detectRearrangerRegionsFromBufferSegment,
  deriveRearrangedRegionIds,
  deriveRearrangedRegions,
  normalizeRearrangerRegions,
  rearrangeBufferSegment,
} from "../rearranger";

class MockAudioBuffer {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  duration: number;
  private channelData: Float32Array[];

  constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.duration = this.length / this.sampleRate;
    this.channelData = Array.from({ length: options.numberOfChannels }, () => {
      return new Float32Array(this.length);
    });
  }

  getChannelData(channel: number) {
    return this.channelData[channel];
  }
}

describe("rearranger", () => {
  const originalAudioBuffer = globalThis.AudioBuffer;

  beforeAll(() => {
    globalThis.AudioBuffer = MockAudioBuffer as typeof AudioBuffer;
  });

  afterAll(() => {
    globalThis.AudioBuffer = originalAudioBuffer;
  });

  it("keeps chaos mappings as a permutation", () => {
    const slices = 16;
    const map = buildRearrangerMap({
      slices,
      swapCount: 8,
      chaos: 1,
      reverse: 0,
    });
    const sorted = map.map((entry) => entry.sourceIndex).sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: slices }, (_, index) => index));
  });

  it("uses a different chaos shuffle when the chaos seed changes", () => {
    const params = { slices: 12, swapCount: 6, chaos: 1, reverse: 0 };
    const a = buildRearrangerMap(params, { chaosSeed: 123 }).map((item) => item.sourceIndex);
    const b = buildRearrangerMap(params, { chaosSeed: 456 }).map((item) => item.sourceIndex);
    expect(a).not.toEqual(b);
  });

  it("rearranges a source segment without allocating an intermediate slice", () => {
    const buffer = new MockAudioBuffer({ length: 40, numberOfChannels: 1, sampleRate: 10 });
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = i;
    }

    const output = rearrangeBufferSegment(buffer as unknown as AudioBuffer, 1, 2, {
      slices: 4,
      swapCount: 2,
      chaos: 0.2,
      reverse: 0,
      sliceFadeMs: 0,
    });
    const outputChannel = (output as unknown as MockAudioBuffer).getChannelData(0);
    const expected = Array.from(
      buffer.getChannelData(0).slice(10, 30)
    ).sort((a, b) => a - b);
    const actual = Array.from(outputChannel).sort((a, b) => a - b);
    expect(output.length).toBe(20);
    expect(actual).toEqual(expected);
  });

  it("keeps segment length stable across repeated rearranges", () => {
    const buffer = new MockAudioBuffer({ length: 132300, numberOfChannels: 1, sampleRate: 44100 });
    let current = buffer as unknown as AudioBuffer;
    const initialLength = current.length;
    for (let i = 0; i < 300; i += 1) {
      current = rearrangeBufferSegment(current, 0, current.duration, {
        slices: 7,
        swapCount: 3,
        chaos: 0.35,
        reverse: 0.1,
        sliceFadeMs: 0,
      });
    }
    expect(current.length).toBe(initialLength);
  });

  it("uses custom regions to set non-uniform slice boundaries", () => {
    const regions = normalizeRearrangerRegions([0, 0.1, 0.5, 1], 3);
    expect(regions).toEqual([0, 0.1, 0.5, 1]);

    const map = buildRearrangerMap({
      slices: 3,
      swapCount: 0,
      chaos: 0,
      reverse: 0,
      regions,
    });
    expect(map).toHaveLength(3);
  });

  it("does not time-stretch when reordering non-uniform custom slices", () => {
    const buffer = new MockAudioBuffer({ length: 10, numberOfChannels: 1, sampleRate: 10 });
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = i;
    }

    const output = rearrangeBufferSegment(buffer as unknown as AudioBuffer, 0, 1, {
      slices: 3,
      swapCount: 0,
      chaos: 0,
      reverse: 0,
      sliceFadeMs: 0,
      regions: [0, 0.2, 0.8, 1],
    });
    const out = (output as unknown as MockAudioBuffer).getChannelData(0);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("reorders region boundaries with slice order", () => {
    const next = deriveRearrangedRegions({
      slices: 3,
      swapCount: 0,
      chaos: 0,
      reverse: 0,
      regions: [0, 0.2, 0.8, 1],
    });
    expect(next[0]).toBeCloseTo(0, 6);
    expect(next[1]).toBeCloseTo(0.2, 6);
    expect(next[2]).toBeCloseTo(0.8, 6);
    expect(next[3]).toBeCloseTo(1, 6);
  });

  it("keeps rearranged region boundaries sample-quantized across repeated derives", () => {
    let regions = [0, 0.13, 0.31, 0.77, 1];
    const segmentSamples = 44101;
    for (let i = 0; i < 200; i += 1) {
      regions = deriveRearrangedRegions(
        {
          slices: 4,
          swapCount: i % 4,
          chaos: 0.35,
          reverse: 0,
          regions,
        },
        { chaosSeed: i * 17 + 3, segmentSamples }
      );
      expect(regions[0]).toBe(0);
      expect(regions[regions.length - 1]).toBe(1);
      for (let j = 1; j < regions.length - 1; j += 1) {
        const quantized = regions[j] * segmentSamples;
        expect(Math.abs(quantized - Math.round(quantized))).toBeLessThan(1e-9);
      }
    }
  });

  it("reorders persistent region ids with slice order", () => {
    const nextIds = deriveRearrangedRegionIds(
      {
        slices: 3,
        swapCount: 0,
        chaos: 0,
        reverse: 0,
        regions: [0, 0.2, 0.8, 1],
      },
      [10, 20, 30]
    );
    expect(nextIds).toEqual([10, 20, 30]);
  });

  it("detects transient-based slice boundaries from a segment", () => {
    const sampleRate = 1000;
    const buffer = new MockAudioBuffer({ length: 5000, numberOfChannels: 1, sampleRate });
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = 0.01;
    }
    for (let pulse = 600; pulse <= 3600; pulse += 1000) {
      for (let i = 0; i < 20; i += 1) {
        channel[pulse + i] = 1;
      }
    }

    const regions = detectRearrangerRegionsFromBufferSegment(
      buffer as unknown as AudioBuffer,
      0,
      5,
      { maxSlices: 8, minSliceDurationMs: 120, frameDurationMs: 10 }
    );

    expect(regions[0]).toBe(0);
    expect(regions[regions.length - 1]).toBe(1);
    expect(regions.length).toBeGreaterThan(2);
    expect(regions.length).toBeLessThanOrEqual(8 + 1);
    for (let i = 1; i < regions.length; i += 1) {
      expect(regions[i]).toBeGreaterThan(regions[i - 1]);
    }
  });

  it("returns [0,1] when no clear transients are present", () => {
    const buffer = new MockAudioBuffer({ length: 4000, numberOfChannels: 1, sampleRate: 1000 });
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = 0.2;
    }

    const regions = detectRearrangerRegionsFromBufferSegment(
      buffer as unknown as AudioBuffer,
      0,
      4,
      { maxSlices: 12 }
    );
    expect(regions).toEqual([0, 1]);
  });
});
