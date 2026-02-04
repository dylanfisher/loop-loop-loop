export type RearrangerParams = {
  slices: number;
  offset: number;
  chaos: number;
  reverse: number;
  regions?: number[] | null;
};

export type RearrangerSliceMap = {
  sourceIndex: number;
  reversed: boolean;
};

type RearrangerBuildOptions = {
  chaosSeed?: number;
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

export const normalizeRearrangerRegions = (regions: number[] | null | undefined, slices: number) => {
  const safeSliceCount = Math.max(0, Math.min(32, Math.round(slices)));
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
  slices: Math.max(0, Math.min(32, Math.round(params.slices))),
  offset: Math.max(-32, Math.min(32, Math.round(params.offset))),
  chaos: Math.max(0, Math.min(1, params.chaos)),
  reverse: Math.max(0, Math.min(1, params.reverse)),
  regions: normalizeRearrangerRegions(params.regions, params.slices),
});

export const normalizeRearrangerRegionIds = (
  ids: number[] | null | undefined,
  slices: number
) => {
  const safeSliceCount = Math.max(0, Math.min(32, Math.round(slices)));
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
  const sourceOrder = Array.from({ length: sliceCount }, (_, index) =>
    wrapIndex(index + normalized.offset, sliceCount)
  );
  for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
    if (
      normalized.chaos > 0 &&
      seedRand((chaosSeed + 1) * (sliceIndex * 19.37 + 0.17)) < normalized.chaos
    ) {
      const swapIndex = Math.floor(
        seedRand((chaosSeed + 1) * (sliceIndex * 71.91 + 1.11)) * sliceCount
      );
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

    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const src = source.getChannelData(channel);
      const dst = output.getChannelData(channel);
      for (let i = 0; i < dstLen; i += 1) {
        const srcIndexInSlice = Math.min(srcLen - 1, i);
        const readIndex = mapping.reversed
          ? srcStart + (srcLen - 1 - srcIndexInSlice)
          : srcStart + srcIndexInSlice;
        dst[dstStart + i] = src[readIndex] ?? 0;
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
  let writeHead = 0;

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

    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const src = source.getChannelData(channel);
      const dst = output.getChannelData(channel);
      for (let i = 0; i < dstLen; i += 1) {
        const srcIndexInSlice = Math.min(srcLen - 1, i);
        const readIndex = mapping.reversed
          ? startSample + srcStart + (srcLen - 1 - srcIndexInSlice)
          : startSample + srcStart + srcIndexInSlice;
        dst[dstStart + i] = src[readIndex] ?? 0;
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
  const lengths = new Array<number>(map.length);
  for (let i = 0; i < map.length; i += 1) {
    const sourceIndex = map[i].sourceIndex;
    lengths[i] = Math.max(0, (regions[sourceIndex + 1] ?? 1) - (regions[sourceIndex] ?? 0));
  }
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
