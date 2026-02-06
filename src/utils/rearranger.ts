import {
  tryDetectRegionsWasm,
  tryRearrangeSegmentWasm,
  warmupRearrangerWasm,
} from "./rearrangerWasm";

export type RearrangerParams = {
  slices: number;
  swapCount: number;
  chaos: number;
  reverse: number;
  regions?: number[] | null;
  sliceFadeMs?: number;
};

export type RearrangerSliceMap = {
  sourceIndex: number;
  reversed: boolean;
};

export const MAX_REARRANGER_SLICES = 128;

type RearrangerBuildOptions = {
  chaosSeed?: number;
  segmentSamples?: number;
};

type RearrangerDetectOptions = {
  maxSlices?: number;
  minSliceDurationMs?: number;
  frameDurationMs?: number;
  thresholdStdDev?: number;
  sensitivity?: number;
};

const seedRand = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const wrapIndex = (value: number, size: number) => {
  if (size <= 0) return 0;
  return ((value % size) + size) % size;
};

const buildEqualRegions = (sliceCount: number) => {
  const safeSliceCount = Math.max(1, sliceCount);
  return Array.from({ length: safeSliceCount + 1 }, (_, index) => index / safeSliceCount);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const DEFAULT_SLICE_FADE_MS = 0;

// Start loading optional wasm backend early; JS path remains authoritative fallback.
warmupRearrangerWasm();

export const normalizeRearrangerRegions = (regions: number[] | null | undefined, slices: number) => {
  const safeSliceCount = Math.max(0, Math.min(MAX_REARRANGER_SLICES, Math.round(slices)));
  if (safeSliceCount <= 1) return [0, 1];
  const fallback = buildEqualRegions(safeSliceCount);
  if (!regions || regions.length === 0) return fallback;
  const points = regions
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(1, value)))
    .sort((a, b) => a - b);
  if (points.length === 0) return fallback;
  if (points[0] > 0) points.unshift(0);
  if (points[points.length - 1] < 1) points.push(1);
  if (points.length !== safeSliceCount + 1) return fallback;
  return points;
};

export const normalizeRearrangerParams = (params: RearrangerParams): RearrangerParams => ({
  slices: Math.max(0, Math.min(MAX_REARRANGER_SLICES, Math.round(params.slices))),
  swapCount: Math.max(0, Math.min(MAX_REARRANGER_SLICES, Math.round(params.swapCount))),
  chaos: Math.max(0, Math.min(1, params.chaos)),
  reverse: Math.max(0, Math.min(1, params.reverse)),
  regions: normalizeRearrangerRegions(params.regions, params.slices),
  sliceFadeMs: Math.max(0, Math.min(12, params.sliceFadeMs ?? DEFAULT_SLICE_FADE_MS)),
});

export const normalizeRearrangerRegionIds = (
  ids: number[] | null | undefined,
  slices: number
) => {
  const safeSliceCount = Math.max(0, Math.min(MAX_REARRANGER_SLICES, Math.round(slices)));
  const fallback = Array.from({ length: safeSliceCount }, (_, index) => index);
  if (!ids || ids.length !== safeSliceCount) return fallback;
  return ids.map((id, index) => (Number.isFinite(id) ? id : index));
};

export const buildRearrangerMap = (
  params: RearrangerParams,
  options?: RearrangerBuildOptions
): RearrangerSliceMap[] => {
  const normalized = normalizeRearrangerParams(params);
  if (normalized.slices <= 1) return [];
  const sliceCount = Math.max(2, (normalized.regions?.length ?? 0) - 1);
  const chaosSeed = options?.chaosSeed ?? 0;
  const sourceOrder = Array.from({ length: sliceCount }, (_, index) => index);
  const swapCount = Math.min(normalized.swapCount ?? 0, sliceCount);
  if (swapCount > 0) {
    const indices = Array.from({ length: sliceCount }, (_, index) => index);
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const seed = seedRand((chaosSeed + 1) * (i * 19.37 + 0.17));
      const j = Math.floor(seed * (i + 1));
      const temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }
    const maxDistance = Math.max(1, Math.round(1 + normalized.chaos * (sliceCount - 2)));
    for (let i = 0; i < swapCount; i += 1) {
      const sliceIndex = indices[i] ?? 0;
      const distanceSeed = seedRand((chaosSeed + 1) * (sliceIndex * 71.91 + 1.11));
      const biased = distanceSeed ** 2;
      const distance = Math.max(1, Math.round(biased * maxDistance));
      const direction =
        seedRand((chaosSeed + 1) * (sliceIndex * 43.13 + 0.73)) < 0.5 ? -1 : 1;
      let swapIndex = wrapIndex(sliceIndex + direction * distance, sliceCount);
      if (swapIndex === sliceIndex) {
        swapIndex = wrapIndex(sliceIndex + 1, sliceCount);
      }
      const next = sourceOrder[sliceIndex];
      sourceOrder[sliceIndex] = sourceOrder[swapIndex];
      sourceOrder[swapIndex] = next;
    }
  }
  const map: RearrangerSliceMap[] = new Array(sliceCount);
  for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
    map[sliceIndex] = {
      sourceIndex: sourceOrder[sliceIndex],
      reversed: seedRand(sliceIndex * 43.13 + 0.73) < normalized.reverse,
    };
  }
  return map;
};

export const rearrangeLoopBuffer = (
  source: AudioBuffer,
  params: RearrangerParams,
  options?: RearrangerBuildOptions
) => {
  const normalized = normalizeRearrangerParams(params);
  if (normalized.slices <= 1) return source;
  const regions = normalizeRearrangerRegions(normalized.regions, normalized.slices);
  const sliceCount = Math.max(2, regions.length - 1);
  const output = new AudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });
  const starts = new Array<number>(sliceCount + 1);
  for (let i = 0; i <= sliceCount; i += 1) {
    starts[i] = Math.floor(source.length * regions[i]);
  }
  const map = buildRearrangerMap(normalized, options);
  let writeHead = 0;
  const fadeSamples = Math.max(
    0,
    Math.round((source.sampleRate * (normalized.sliceFadeMs ?? DEFAULT_SLICE_FADE_MS)) / 1000)
  );

  for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
    const mapping = map[sliceIndex];
    const srcStart = starts[mapping.sourceIndex];
    const srcEnd = starts[mapping.sourceIndex + 1];
    const srcLen = Math.max(0, srcEnd - srcStart);
    if (srcLen === 0) continue;
    const dstStart = writeHead;
    const dstEnd = Math.min(output.length, dstStart + srcLen);
    const dstLen = Math.max(0, dstEnd - dstStart);
    if (dstLen === 0) continue;

    const sliceFade = Math.min(fadeSamples, Math.floor(dstLen / 2));

    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const src = source.getChannelData(channel);
      const dst = output.getChannelData(channel);
      for (let i = 0; i < dstLen; i += 1) {
        const srcIndexInSlice = Math.min(srcLen - 1, i);
        const readIndex = mapping.reversed
          ? srcStart + (srcLen - 1 - srcIndexInSlice)
          : srcStart + srcIndexInSlice;
        let gain = 1;
        if (sliceFade > 0) {
          if (i < sliceFade) {
            gain = i / sliceFade;
          } else if (i >= dstLen - sliceFade) {
            gain = (dstLen - 1 - i) / sliceFade;
          }
        }
        dst[dstStart + i] = (src[readIndex] ?? 0) * gain;
      }
    }
    writeHead += srcLen;
  }

  return output;
};

export const rearrangeBufferSegment = (
  source: AudioBuffer,
  startSeconds: number,
  durationSeconds: number,
  params: RearrangerParams,
  options?: RearrangerBuildOptions
) => {
  const normalized = normalizeRearrangerParams(params);
  if (normalized.slices <= 1) {
    const sampleRate = source.sampleRate;
    const clampedStartSeconds = Math.max(0, startSeconds);
    const startSample = Math.max(
      0,
      Math.min(source.length - 1, Math.round(clampedStartSeconds * sampleRate))
    );
    const endSample = Math.max(
      startSample + 1,
      Math.min(source.length, Math.round((clampedStartSeconds + Math.max(0.001, durationSeconds)) * sampleRate))
    );
    const segmentLength = Math.max(1, endSample - startSample);
    const output = new AudioBuffer({
      length: segmentLength,
      numberOfChannels: source.numberOfChannels,
      sampleRate,
    });
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      output
        .getChannelData(channel)
        .set(source.getChannelData(channel).subarray(startSample, startSample + segmentLength));
    }
    return output;
  }
  const regions = normalizeRearrangerRegions(normalized.regions, normalized.slices);
  const sliceCount = Math.max(2, regions.length - 1);
  const sampleRate = source.sampleRate;
  const clampedStartSeconds = Math.max(0, startSeconds);
  const startSample = Math.max(0, Math.min(source.length - 1, Math.round(clampedStartSeconds * sampleRate)));
  const endSample = Math.max(
    startSample + 1,
    Math.min(source.length, Math.round((clampedStartSeconds + Math.max(0.001, durationSeconds)) * sampleRate))
  );
  const segmentLength = Math.max(1, endSample - startSample);
  const output = new AudioBuffer({
    length: segmentLength,
    numberOfChannels: source.numberOfChannels,
    sampleRate,
  });

  const starts = new Array<number>(sliceCount + 1);
  for (let i = 0; i <= sliceCount; i += 1) {
    starts[i] = Math.floor(segmentLength * regions[i]);
  }
  const map = buildRearrangerMap(normalized, options);
  const mapSource = new Int32Array(map.length);
  const mapReversed = new Uint8Array(map.length);
  for (let i = 0; i < map.length; i += 1) {
    mapSource[i] = map[i].sourceIndex;
    mapReversed[i] = map[i].reversed ? 1 : 0;
  }
  const startsInt = Int32Array.from(starts);
  let writeHead = 0;
  const fadeSamples = Math.max(
    0,
    Math.round((sampleRate * (normalized.sliceFadeMs ?? DEFAULT_SLICE_FADE_MS)) / 1000)
  );

  let usedWasm = false;
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const src = source.getChannelData(channel);
    const wasmOut = tryRearrangeSegmentWasm(
      src,
      startsInt,
      mapSource,
      mapReversed,
      startSample,
      segmentLength,
      fadeSamples
    );
    if (!wasmOut || wasmOut.length !== segmentLength) {
      usedWasm = false;
      break;
    }
    usedWasm = true;
    output.getChannelData(channel).set(wasmOut);
  }
  if (usedWasm) return output;

  for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
    const mapping = map[sliceIndex];
    const srcStart = starts[mapping.sourceIndex];
    const srcEnd = starts[mapping.sourceIndex + 1];
    const srcLen = Math.max(0, srcEnd - srcStart);
    if (srcLen === 0) continue;
    const dstStart = writeHead;
    const dstEnd = Math.min(output.length, dstStart + srcLen);
    const dstLen = Math.max(0, dstEnd - dstStart);
    if (dstLen === 0) continue;

    const sliceFade = Math.min(fadeSamples, Math.floor(dstLen / 2));

    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const src = source.getChannelData(channel);
      const dst = output.getChannelData(channel);
      for (let i = 0; i < dstLen; i += 1) {
        const srcIndexInSlice = Math.min(srcLen - 1, i);
        const readIndex = mapping.reversed
          ? startSample + srcStart + (srcLen - 1 - srcIndexInSlice)
          : startSample + srcStart + srcIndexInSlice;
        let gain = 1;
        if (sliceFade > 0) {
          if (i < sliceFade) {
            gain = i / sliceFade;
          } else if (i >= dstLen - sliceFade) {
            gain = (dstLen - 1 - i) / sliceFade;
          }
        }
        dst[dstStart + i] = (src[readIndex] ?? 0) * gain;
      }
    }
    writeHead += srcLen;
  }

  return output;
};

export const deriveRearrangedRegions = (
  params: RearrangerParams,
  options?: RearrangerBuildOptions
) => {
  const normalized = normalizeRearrangerParams(params);
  if (normalized.slices <= 1) return [0, 1];
  const regions = normalizeRearrangerRegions(normalized.regions, normalized.slices);
  const map = buildRearrangerMap(normalized, options);
  const segmentSamples = Math.max(0, Math.floor(options?.segmentSamples ?? 0));
  if (segmentSamples > 0) {
    const starts = new Array<number>(regions.length);
    for (let i = 0; i < regions.length; i += 1) {
      starts[i] = Math.floor(segmentSamples * regions[i]);
    }
    const lengths = map.map((entry) => {
      const srcStart = starts[entry.sourceIndex] ?? 0;
      const srcEnd = starts[entry.sourceIndex + 1] ?? segmentSamples;
      return Math.max(0, srcEnd - srcStart);
    });
    const total = lengths.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return regions;
    const next = new Array<number>(lengths.length + 1);
    next[0] = 0;
    let acc = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      acc += lengths[i];
      next[i + 1] = i === lengths.length - 1 ? 1 : acc / total;
    }
    return next;
  }
  const lengths = map.map((entry) => {
    const sourceIndex = entry.sourceIndex;
    return Math.max(0, (regions[sourceIndex + 1] ?? 1) - (regions[sourceIndex] ?? 0));
  });
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-8) return regions;
  const next = new Array<number>(map.length + 1);
  next[0] = 0;
  let acc = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    acc += lengths[i] / total;
    next[i + 1] = i === lengths.length - 1 ? 1 : acc;
  }
  return next;
};

export const deriveRearrangedRegionIds = (
  params: RearrangerParams,
  currentIds?: number[] | null,
  options?: RearrangerBuildOptions
) => {
  const normalized = normalizeRearrangerParams(params);
  const map = buildRearrangerMap(normalized, options);
  const ids = normalizeRearrangerRegionIds(currentIds, normalized.slices);
  return map.map((entry, index) => ids[entry.sourceIndex] ?? ids[index] ?? index);
};

export const detectRearrangerRegionsFromBufferSegment = (
  source: AudioBuffer,
  startSeconds: number,
  durationSeconds: number,
  options?: RearrangerDetectOptions
) => {
  const sensitivity = clamp01(options?.sensitivity ?? 0.6);
  const shapedSensitivity = Math.pow(sensitivity, 0.7);
  const sampleRate = source.sampleRate;
  const clampedStartSeconds = Math.max(0, startSeconds);
  const startSample = Math.max(
    0,
    Math.min(source.length - 1, Math.round(clampedStartSeconds * sampleRate))
  );
  const endSample = Math.max(
    startSample + 1,
    Math.min(
      source.length,
      Math.round((clampedStartSeconds + Math.max(0.001, durationSeconds)) * sampleRate)
    )
  );
  const segmentLength = Math.max(1, endSample - startSample);

  const maxSlices = Math.max(
    1,
    Math.min(MAX_REARRANGER_SLICES, Math.round(options?.maxSlices ?? 16))
  );
  const maxInternalBoundaries = Math.max(0, maxSlices - 1);
  if (maxInternalBoundaries <= 0) return [0, 1];

  const frameDurationMs = Math.min(50, Math.max(4, options?.frameDurationMs ?? 10));
  const frameSize = Math.max(
    16,
    Math.min(segmentLength, Math.round(sampleRate * (frameDurationMs / 1000)))
  );
  const hopSize = Math.max(8, Math.floor(frameSize / 2));
  const frameCount = Math.max(1, Math.floor((segmentLength - frameSize) / hopSize) + 1);
  if (frameCount <= 2) return [0, 1];

  const minSliceDurationMs = Math.max(
    20,
    options?.minSliceDurationMs ?? (220 - 175 * shapedSensitivity)
  );
  const thresholdStdDev = options?.thresholdStdDev ?? (2.3 - 2.05 * shapedSensitivity);
  const wasmChannels = Array.from({ length: source.numberOfChannels }, (_, channel) =>
    source.getChannelData(channel).subarray(startSample, endSample)
  );
  const wasmRegions = tryDetectRegionsWasm(
    wasmChannels,
    sampleRate,
    maxSlices,
    minSliceDurationMs,
    frameDurationMs,
    thresholdStdDev,
    sensitivity
  );
  if (wasmRegions && wasmRegions.length >= 2) {
    const cleaned = wasmRegions.map((value) => clamp01(value)).sort((a, b) => a - b);
    if (cleaned[0] > 0) cleaned.unshift(0);
    if (cleaned[cleaned.length - 1] < 1) cleaned.push(1);
    return cleaned;
  }

  const envelope = new Array<number>(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = startSample + frameIndex * hopSize;
    let sum = 0;
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const data = source.getChannelData(channel);
      for (let sampleOffset = 0; sampleOffset < frameSize; sampleOffset += 1) {
        const sample = data[frameStart + sampleOffset] ?? 0;
        sum += sample * sample;
      }
    }
    const count = frameSize * source.numberOfChannels;
    envelope[frameIndex] = count > 0 ? Math.sqrt(sum / count) : 0;
  }

  const deltas = new Array<number>(frameCount);
  deltas[0] = 0;
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    const delta = envelope[frameIndex] - envelope[frameIndex - 1];
    deltas[frameIndex] = delta > 0 ? delta : 0;
  }

  const positive = deltas.filter((delta) => delta > 0);
  if (positive.length === 0) return [0, 1];
  const mean = positive.reduce((sum, value) => sum + value, 0) / positive.length;
  const maxDelta = positive.reduce((max, value) => Math.max(max, value), 0);
  const variance =
    positive.reduce((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, 0) / positive.length;
  const stdDev = Math.sqrt(Math.max(0, variance));
  const thresholdK =
    thresholdStdDev;
  const thresholdFromStd = mean + thresholdK * stdDev;
  const peakClamp = 0.9 - 0.72 * shapedSensitivity;
  const threshold = Math.max(1e-4, Math.min(thresholdFromStd, maxDelta * peakClamp));
  const envelopeSorted = [...envelope].sort((a, b) => a - b);
  const floorIndex = Math.min(
    envelopeSorted.length - 1,
    Math.max(0, Math.floor((envelopeSorted.length - 1) * 0.15))
  );
  const silenceFloor = envelopeSorted[floorIndex] ?? 0;
  const minGapFromMs = Math.max(1, Math.round(sampleRate * (minSliceDurationMs / 1000)));
  const expectedGapSamples = Math.max(1, Math.floor(segmentLength / Math.max(1, maxSlices)));
  const minGapFromDistribution = Math.max(
    1,
    Math.floor(expectedGapSamples * (0.95 - 0.45 * shapedSensitivity))
  );
  const minGapSamples = Math.max(minGapFromMs, minGapFromDistribution);

  const candidates: Array<{ frameIndex: number; sample: number; score: number }> = [];
  for (let frameIndex = 1; frameIndex < frameCount - 1; frameIndex += 1) {
    const prev = envelope[frameIndex - 1] ?? 0;
    const curr = envelope[frameIndex] ?? 0;
    const delta = deltas[frameIndex];
    const riseRatio = curr / Math.max(1e-6, prev, silenceFloor + 1e-6);
    const silenceAttack =
      prev <= silenceFloor * 1.3 &&
      curr >= silenceFloor * (2.2 - 1.2 * shapedSensitivity) &&
      riseRatio >= (2.5 - 1.8 * shapedSensitivity);
    if (delta < threshold && !silenceAttack) continue;
    const score =
      delta +
      (silenceAttack
        ? Math.max(0, curr - silenceFloor) * (0.35 + 1.45 * shapedSensitivity)
        : 0);
    if (
      !silenceAttack &&
      (score < (deltas[frameIndex - 1] ?? 0) || score < (deltas[frameIndex + 1] ?? 0))
    ) {
      continue;
    }
    const sample = Math.min(
      segmentLength - 1,
      Math.max(1, frameIndex * hopSize + Math.floor(frameSize / 2))
    );
    candidates.push({ frameIndex, sample, score });
  }

  if (candidates.length === 0) return [0, 1];

  // Prevent dense regions from monopolizing boundaries: keep strongest onset per local bucket.
  const bucketSize = Math.max(
    1,
    Math.floor(expectedGapSamples * (1.2 - 0.55 * shapedSensitivity))
  );
  const bestCandidateByBucket = new Map<number, { frameIndex: number; sample: number; score: number }>();
  for (const candidate of candidates) {
    const bucket = Math.floor(candidate.sample / bucketSize);
    const existing = bestCandidateByBucket.get(bucket);
    if (!existing || candidate.score > existing.score) {
      bestCandidateByBucket.set(bucket, candidate);
    }
  }
  const dedupedCandidates = Array.from(bestCandidateByBucket.values());

  dedupedCandidates.sort((a, b) => b.score - a.score || a.sample - b.sample);
  const selectedSamples: number[] = [];
  for (const candidate of dedupedCandidates) {
    if (selectedSamples.length >= maxInternalBoundaries) break;
    const isFarEnough = selectedSamples.every(
      (sample) => Math.abs(sample - candidate.sample) >= minGapSamples
    );
    if (!isFarEnough) continue;
    selectedSamples.push(candidate.sample);
  }

  if (selectedSamples.length === 0) return [0, 1];
  selectedSamples.sort((a, b) => a - b);
  const regions = [0, ...selectedSamples.map((sample) => clamp01(sample / segmentLength)), 1];
  return regions;
};
