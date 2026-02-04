import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildRearrangerMap,
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
      offset: 5,
      chaos: 1,
      reverse: 0,
    });
    const sorted = map.map((entry) => entry.sourceIndex).sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: slices }, (_, index) => index));
  });

  it("uses a different chaos shuffle when the chaos seed changes", () => {
    const params = { slices: 12, offset: 0, chaos: 1, reverse: 0 };
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
      offset: 1,
      chaos: 0,
      reverse: 0,
    });
    const outputChannel = (output as unknown as MockAudioBuffer).getChannelData(0);

    expect(output.length).toBe(20);
    expect(outputChannel[0]).toBe(15);
    expect(outputChannel[5]).toBe(20);
    expect(outputChannel[10]).toBe(25);
    expect(outputChannel[15]).toBe(10);
  });

  it("keeps segment length stable across repeated rearranges", () => {
    const buffer = new MockAudioBuffer({ length: 132300, numberOfChannels: 1, sampleRate: 44100 });
    let current = buffer as unknown as AudioBuffer;
    const initialLength = current.length;
    for (let i = 0; i < 300; i += 1) {
      current = rearrangeBufferSegment(current, 0, current.duration, {
        slices: 7,
        offset: 1,
        chaos: 0.35,
        reverse: 0.1,
      });
    }
    expect(current.length).toBe(initialLength);
  });

  it("uses custom regions to set non-uniform slice boundaries", () => {
    const regions = normalizeRearrangerRegions([0, 0.1, 0.5, 1], 3);
    expect(regions).toEqual([0, 0.1, 0.5, 1]);

    const map = buildRearrangerMap({
      slices: 3,
      offset: 0,
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
      offset: 1,
      chaos: 0,
      reverse: 0,
      regions: [0, 0.2, 0.8, 1],
    });
    const out = (output as unknown as MockAudioBuffer).getChannelData(0);
    expect(Array.from(out)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
  });

  it("reorders region boundaries with slice order", () => {
    const next = deriveRearrangedRegions({
      slices: 3,
      offset: 1,
      chaos: 0,
      reverse: 0,
      regions: [0, 0.2, 0.8, 1],
    });
    expect(next[0]).toBeCloseTo(0, 6);
    expect(next[1]).toBeCloseTo(0.6, 6);
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
          offset: (i % 5) - 2,
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
        offset: 1,
        chaos: 0,
        reverse: 0,
        regions: [0, 0.2, 0.8, 1],
      },
      [10, 20, 30]
    );
    expect(nextIds).toEqual([20, 30, 10]);
  });
});
