import { beforeEach, describe, expect, it, vi } from "vitest";

const encodeWavMock = vi.fn(() => new Blob(["wav"], { type: "audio/wav" }));

vi.mock("../audio", () => ({
  encodeWav: (...args: unknown[]) => encodeWavMock(...args),
}));

vi.mock("../audioImportTranscode", () => ({
  transcodeImportedAudioFile: vi.fn(async () => {
    throw new Error("ffmpeg unavailable in test");
  }),
}));

import {
  decodeAndNormalizeImportedAudio,
  shouldNormalizeImportedAudioFile,
} from "../audioImport";

describe("audioImport", () => {
  beforeEach(() => {
    encodeWavMock.mockClear();
  });

  it("does not normalize portable formats", async () => {
    const file = new File(["x"], "track.mp3", { type: "audio/mpeg" });
    const buffer = {} as AudioBuffer;
    const decodeFile = vi.fn(async () => buffer);

    expect(shouldNormalizeImportedAudioFile(file)).toBe(false);
    const result = await decodeAndNormalizeImportedAudio(file, decodeFile);

    expect(result.converted).toBe(false);
    expect(result.file).toBe(file);
    expect(result.buffer).toBe(buffer);
    expect(encodeWavMock).not.toHaveBeenCalled();
  });

  it("normalizes non-portable formats to wav", async () => {
    const file = new File(["x"], "track.m4a", { type: "audio/mp4" });
    const buffer = {} as AudioBuffer;
    const decodeFile = vi.fn(async () => buffer);

    expect(shouldNormalizeImportedAudioFile(file)).toBe(true);
    const result = await decodeAndNormalizeImportedAudio(file, decodeFile);

    expect(result.converted).toBe(true);
    expect(result.file.name).toBe("track.wav");
    expect(result.file.type).toBe("audio/wav");
    expect(result.buffer).toBe(buffer);
    expect(encodeWavMock).toHaveBeenCalledWith(buffer);
  });
});
