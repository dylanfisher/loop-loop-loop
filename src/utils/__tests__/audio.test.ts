import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { encodeWav, sliceBuffer } from "../audio";

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

class MockBlob {
  type: string;
  private data: Uint8Array;

  constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
    this.type = options?.type ?? "";
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    for (const part of parts) {
      let chunk: Uint8Array;
      if (part instanceof ArrayBuffer) {
        chunk = new Uint8Array(part);
      } else if (ArrayBuffer.isView(part)) {
        chunk = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      } else if (typeof part === "string") {
        chunk = new TextEncoder().encode(part);
      } else {
        chunk = new TextEncoder().encode(String(part));
      }
      totalLength += chunk.length;
      chunks.push(chunk);
    }
    this.data = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      this.data.set(chunk, offset);
      offset += chunk.length;
    }
  }

  arrayBuffer() {
    return Promise.resolve(this.data.buffer.slice(0));
  }
}

describe("audio utils", () => {
  const originalAudioBuffer = globalThis.AudioBuffer;
  const originalBlob = globalThis.Blob;

  beforeAll(() => {
    globalThis.AudioBuffer = MockAudioBuffer as typeof AudioBuffer;
    globalThis.Blob = MockBlob as typeof Blob;
  });

  afterAll(() => {
    globalThis.AudioBuffer = originalAudioBuffer;
    globalThis.Blob = originalBlob;
  });

  it("encodes a wav header and clamps samples", async () => {
    const buffer = new MockAudioBuffer({ length: 1, numberOfChannels: 2, sampleRate: 8000 });
    buffer.getChannelData(0)[0] = 1.5;
    buffer.getChannelData(1)[0] = -1.5;

    const blob = encodeWav(buffer as unknown as AudioBuffer);
    const view = new DataView(await blob.arrayBuffer());

    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    expect(riff).toBe("RIFF");
    expect(wave).toBe("WAVE");
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("slices audio buffers with clamped bounds", () => {
    const buffer = new MockAudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = i;
    }

    const sliced = sliceBuffer(buffer as unknown as AudioBuffer, -1, 2);
    const slicedData = (sliced as unknown as MockAudioBuffer).getChannelData(0);

    expect(sliced.length).toBe(20);
    expect(slicedData[0]).toBe(0);
    expect(slicedData[19]).toBe(19);
  });
});
