export const hashStringToUint32 = (value: string) => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

export const seededUnitFloat = (seed: number) => {
  let x = (seed >>> 0) || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 4294967296);
};

export const isTextInputTarget = (target: EventTarget | null) => {
  const node = target as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable
  );
};

export const trimBufferLeadingSamples = (
  context: BaseAudioContext,
  buffer: AudioBuffer,
  startSamples: number,
  targetLength: number
) => {
  const safeStart = Math.max(0, Math.min(startSamples, buffer.length - 1));
  const safeLength = Math.max(
    1,
    Math.min(targetLength, buffer.length - safeStart)
  );
  const trimmed = context.createBuffer(
    buffer.numberOfChannels,
    safeLength,
    buffer.sampleRate
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    trimmed
      .getChannelData(channel)
      .set(source.subarray(safeStart, safeStart + safeLength));
  }
  return trimmed;
};

export const findLeadingSilenceSamples = (
  buffer: AudioBuffer,
  maxSamples: number,
  threshold: number
) => {
  const limit = Math.min(buffer.length, Math.max(0, maxSamples));
  for (let i = 0; i < limit; i += 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[i]) >= threshold) {
        return i;
      }
    }
  }
  return limit;
};

export const removeBufferSegment = (
  buffer: AudioBuffer,
  startSample: number,
  endSample: number
) => {
  const safeStart = Math.max(0, Math.min(buffer.length, startSample));
  const safeEnd = Math.max(safeStart, Math.min(buffer.length, endSample));
  const removedLength = safeEnd - safeStart;
  if (removedLength <= 0) return null;
  const nextLength = Math.max(1, buffer.length - removedLength);
  const nextBuffer = new AudioBuffer({
    length: nextLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = nextBuffer.getChannelData(channel);
    target.set(source.subarray(0, safeStart), 0);
    target.set(source.subarray(safeEnd), safeStart);
  }
  return { buffer: nextBuffer, removedLength };
};

export const removeBufferRanges = (
  buffer: AudioBuffer,
  ranges: Array<{ startSample: number; endSample: number }>
) => {
  if (ranges.length === 0) return null;
  const normalized: Array<{ startSample: number; endSample: number }> = [];
  const sorted = [...ranges]
    .map((range) => ({
      startSample: Math.max(0, Math.min(buffer.length, Math.round(range.startSample))),
      endSample: Math.max(0, Math.min(buffer.length, Math.round(range.endSample))),
    }))
    .filter((range) => range.endSample > range.startSample)
    .sort((a, b) => a.startSample - b.startSample);
  for (const range of sorted) {
    const last = normalized[normalized.length - 1];
    if (!last || range.startSample > last.endSample) {
      normalized.push(range);
      continue;
    }
    last.endSample = Math.max(last.endSample, range.endSample);
  }
  if (normalized.length === 0) return null;
  const removedLength = normalized.reduce(
    (sum, range) => sum + (range.endSample - range.startSample),
    0
  );
  if (removedLength <= 0 || removedLength >= buffer.length) return null;
  const nextLength = Math.max(1, buffer.length - removedLength);
  const nextBuffer = new AudioBuffer({
    length: nextLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = nextBuffer.getChannelData(channel);
    let writeHead = 0;
    let readHead = 0;
    for (const range of normalized) {
      if (range.startSample > readHead) {
        target.set(source.subarray(readHead, range.startSample), writeHead);
        writeHead += range.startSample - readHead;
      }
      readHead = range.endSample;
    }
    if (readHead < buffer.length) {
      target.set(source.subarray(readHead), writeHead);
    }
  }
  return { buffer: nextBuffer, removedLength, ranges: normalized };
};

export const detectQuietRangesInSegment = (
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  quietThresholdControl = 0.3
) => {
  const segmentStart = Math.max(0, Math.min(buffer.length - 1, Math.round(startSample)));
  const segmentEnd = Math.max(segmentStart + 1, Math.min(buffer.length, Math.round(endSample)));
  const segmentLength = segmentEnd - segmentStart;
  if (segmentLength < 128) return [];
  const sampleRate = buffer.sampleRate;
  const frameSize = Math.max(32, Math.round(sampleRate * 0.012));
  const hopSize = Math.max(16, Math.floor(frameSize / 2));
  if (segmentLength <= frameSize + hopSize) return [];
  const frameCount = Math.floor((segmentLength - frameSize) / hopSize) + 1;
  const envelope = new Array<number>(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = segmentStart + frameIndex * hopSize;
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let offset = 0; offset < frameSize; offset += 1) {
        const sample = data[frameStart + offset] ?? 0;
        sum += sample * sample;
      }
    }
    const count = frameSize * buffer.numberOfChannels;
    envelope[frameIndex] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  const sorted = [...envelope].sort((a, b) => a - b);
  const p20 = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
  const p80 = sorted[Math.floor((sorted.length - 1) * 0.8)] ?? 0;
  const dynamic = Math.max(0, p80 - p20);
  const control = Math.min(Math.max(quietThresholdControl, 0), 1);
  const quietFactor = 0.03 + control * 0.17;
  const quietThreshold = p20 + dynamic * quietFactor;
  const minQuietSamples = Math.max(1, Math.round(sampleRate * 0.09));
  const keepGuardSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const ranges: Array<{ startSample: number; endSample: number }> = [];
  let runStart = -1;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const isQuiet = envelope[frameIndex] <= quietThreshold;
    if (isQuiet) {
      if (runStart < 0) runStart = frameIndex;
      continue;
    }
    if (runStart >= 0) {
      const start = segmentStart + runStart * hopSize + keepGuardSamples;
      const end = segmentStart + frameIndex * hopSize + frameSize - keepGuardSamples;
      if (end - start >= minQuietSamples) {
        ranges.push({ startSample: start, endSample: end });
      }
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    const start = segmentStart + runStart * hopSize + keepGuardSamples;
    const end = segmentEnd - keepGuardSamples;
    if (end - start >= minQuietSamples) {
      ranges.push({ startSample: start, endSample: end });
    }
  }
  const maxRemovalSamples = Math.floor(segmentLength * 0.7);
  let removed = 0;
  const capped: Array<{ startSample: number; endSample: number }> = [];
  for (const range of ranges) {
    const len = range.endSample - range.startSample;
    if (len <= 0) continue;
    if (removed + len <= maxRemovalSamples) {
      capped.push(range);
      removed += len;
      continue;
    }
    const remaining = maxRemovalSamples - removed;
    if (remaining >= minQuietSamples) {
      capped.push({
        startSample: range.startSample,
        endSample: range.startSample + remaining,
      });
    }
    break;
  }
  return capped;
};

export const findTrailingNonSilenceSample = (buffer: AudioBuffer, threshold: number) => {
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[i]) >= threshold) {
        return i;
      }
    }
  }
  return -1;
};

export const approxEqual = (value: number, target: number, epsilon = 1e-4) =>
  Math.abs(value - target) <= epsilon;

export const sliceBufferSegment = (
  buffer: AudioBuffer,
  startSeconds: number,
  durationSeconds: number
) => {
  const sampleRate = buffer.sampleRate;
  const clampedStartSeconds = Math.max(0, startSeconds);
  const startSample = Math.max(
    0,
    Math.min(buffer.length - 1, Math.round(clampedStartSeconds * sampleRate))
  );
  const endSample = Math.max(
    startSample + 1,
    Math.min(
      buffer.length,
      Math.round((clampedStartSeconds + Math.max(0.001, durationSeconds)) * sampleRate)
    )
  );
  const length = Math.max(1, endSample - startSample);
  const sliced = new AudioBuffer({
    length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    sliced
      .getChannelData(channel)
      .set(source.subarray(startSample, startSample + length));
  }
  return sliced;
};

export const computeRms = (
  buffer: AudioBuffer,
  startSample: number,
  length: number
) => {
  const safeStart = Math.max(0, Math.min(startSample, buffer.length - 1));
  const safeLength = Math.max(
    1,
    Math.min(length, buffer.length - safeStart)
  );
  let sum = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < safeLength; i += 1) {
      const sample = data[safeStart + i] ?? 0;
      sum += sample * sample;
    }
    count += safeLength;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
};

export const applyBufferGain = (buffer: AudioBuffer, gain: number) => {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] *= gain;
    }
  }
};

export const formatEstimateDuration = (seconds: number) => {
  const safeSeconds = Math.max(1, Math.round(seconds));
  if (safeSeconds < 60) return `~${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `~${minutes}m ${remainingSeconds}s`;
};

const toProjectSlug = (name: string) => {
  const normalized = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "Untitled";
};

export const buildTimestampedAudioFilename = (
  prefix: "loop-loop-loop-recording" | "loop-loop-loop-export",
  projectName: string,
  extension: "wav" | "webm"
) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const hours = now.getHours();
  const hour12 = hours % 12 || 12;
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const amPm = hours >= 12 ? "PM" : "AM";
  return `${prefix}_${toProjectSlug(projectName)}-${month}-${day}-${year}-${hour12}-${minute}-${second}-${amPm}.${extension}`;
};

const APPENDED_DECK_NAME_SUFFIXES = [
  / Rearranged$/,
  / Edited$/,
  / Trimmed$/,
  / Crop$/,
  / Stretch \d+(?:\.\d+)?x$/,
];

const stripAppendedDeckSuffixes = (name: string) => {
  let next = name.trim();
  let updated = true;
  while (updated && next) {
    updated = false;
    for (const pattern of APPENDED_DECK_NAME_SUFFIXES) {
      if (pattern.test(next)) {
        next = next.replace(pattern, "").trim();
        updated = true;
      }
    }
  }
  return next;
};

export const buildDerivedDeckName = (fileName: string | undefined, suffix: string) => {
  const base = stripAppendedDeckSuffixes(fileName ?? "Loop") || "Loop";
  return `${base} ${suffix}`;
};

export const inferAudioExtension = (mimeType: string | undefined, fallback = "wav") => {
  if (!mimeType) return fallback;
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4") || mimeType.includes("aac") || mimeType.includes("m4a")) return "m4a";
  return fallback;
};

export const inferAudioMimeTypeFromPath = (path: string | undefined, fallback = "audio/wav") => {
  if (!path) return fallback;
  const lower = path.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return fallback;
};

export const isSessionBrandNew = (session: {
  decks: Array<{ fileName?: string; wavBlobId?: string; wavFile?: string }>;
  clips: unknown[];
}) =>
  session.clips.length === 0 &&
  session.decks.every((deck) => !deck.wavBlobId && !deck.wavFile && !deck.fileName);
