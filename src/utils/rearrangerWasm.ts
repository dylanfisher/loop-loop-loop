type RearrangerWasmExports = WebAssembly.Exports & {
  memory?: WebAssembly.Memory;
  malloc?: (size: number) => number;
  free?: (ptr: number) => void;
  // Expected kernel exports in the precompiled wasm binary.
  rearrange_segment_f32?: (
    inputPtr: number,
    outputPtr: number,
    startsPtr: number,
    mapSourcePtr: number,
    mapReversePtr: number,
    sliceCount: number,
    startSample: number,
    segmentLength: number,
    fadeSamples: number
  ) => number;
  detect_regions_f32?: (
    inputPtr: number,
    inputLength: number,
    sampleRate: number,
    maxSlices: number,
    minSliceDurationMs: number,
    frameDurationMs: number,
    thresholdStdDev: number,
    sensitivity: number,
    outPtr: number,
    outCapacity: number
  ) => number;
  // Optional expanded kernel: interleaved multichannel onset detection.
  detect_regions_interleaved_f32?: (
    interleavedPtr: number,
    frameCount: number,
    channelCount: number,
    sampleRate: number,
    maxSlices: number,
    minSliceDurationMs: number,
    frameDurationMs: number,
    thresholdStdDev: number,
    sensitivity: number,
    outPtr: number,
    outCapacity: number
  ) => number;
};

type RearrangerWasmBackend = {
  exports: RearrangerWasmExports;
};

const wasmUrl = `${import.meta.env.BASE_URL}wasm/rearranger.wasm`;

let backend: RearrangerWasmBackend | null = null;
let loadStarted = false;
let loadFailed = false;

const getMemory = (exports: RearrangerWasmExports) => exports.memory;
const malloc = (exports: RearrangerWasmExports, size: number) => exports.malloc?.(size) ?? 0;
const free = (exports: RearrangerWasmExports, ptr: number) => {
  if (ptr > 0) exports.free?.(ptr);
};

const ensureLoaded = () => {
  if (loadStarted || loadFailed || typeof window === "undefined") return;
  loadStarted = true;
  void (async () => {
    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        loadFailed = true;
        return;
      }
      const bytes = await response.arrayBuffer();
      const instance = await WebAssembly.instantiate(bytes, {});
      const exports = instance.instance.exports as RearrangerWasmExports;
      if (!getMemory(exports) || !exports.malloc || !exports.free) {
        loadFailed = true;
        return;
      }
      backend = { exports };
    } catch {
      loadFailed = true;
    }
  })();
};

export const warmupRearrangerWasm = () => {
  ensureLoaded();
};

export const tryRearrangeSegmentWasm = (
  channelData: Float32Array,
  starts: Int32Array,
  mapSource: Int32Array,
  mapReversed: Uint8Array,
  startSample: number,
  segmentLength: number,
  fadeSamples: number
): Float32Array | null => {
  ensureLoaded();
  const active = backend;
  if (!active) return null;
  const fn = active.exports.rearrange_segment_f32;
  if (!fn) return null;

  const memory = getMemory(active.exports);
  if (!memory) return null;

  const inputBytes = channelData.length * 4;
  const outputBytes = segmentLength * 4;
  const startsBytes = starts.length * 4;
  const mapSourceBytes = mapSource.length * 4;
  const mapReverseBytes = mapReversed.length;

  const inputPtr = malloc(active.exports, inputBytes);
  const outputPtr = malloc(active.exports, outputBytes);
  const startsPtr = malloc(active.exports, startsBytes);
  const mapSourcePtr = malloc(active.exports, mapSourceBytes);
  const mapReversePtr = malloc(active.exports, mapReverseBytes);
  if (!inputPtr || !outputPtr || !startsPtr || !mapSourcePtr || !mapReversePtr) {
    free(active.exports, inputPtr);
    free(active.exports, outputPtr);
    free(active.exports, startsPtr);
    free(active.exports, mapSourcePtr);
    free(active.exports, mapReversePtr);
    return null;
  }

  try {
    new Float32Array(memory.buffer, inputPtr, channelData.length).set(channelData);
    new Int32Array(memory.buffer, startsPtr, starts.length).set(starts);
    new Int32Array(memory.buffer, mapSourcePtr, mapSource.length).set(mapSource);
    new Uint8Array(memory.buffer, mapReversePtr, mapReversed.length).set(mapReversed);

    fn(
      inputPtr,
      outputPtr,
      startsPtr,
      mapSourcePtr,
      mapReversePtr,
      mapSource.length,
      startSample,
      segmentLength,
      fadeSamples
    );

    return new Float32Array(memory.buffer, outputPtr, segmentLength).slice();
  } catch {
    return null;
  } finally {
    free(active.exports, inputPtr);
    free(active.exports, outputPtr);
    free(active.exports, startsPtr);
    free(active.exports, mapSourcePtr);
    free(active.exports, mapReversePtr);
  }
};

const decodeDetectedRegions = (
  active: RearrangerWasmBackend,
  outPtr: number,
  outCapacity: number,
  count: number
) => {
  const memory = getMemory(active.exports);
  if (!memory) return null;
  if (!Number.isFinite(count) || count < 2 || count > outCapacity) return null;
  return Array.from(new Float32Array(memory.buffer, outPtr, count));
};

const callSingleChannelDetect = (
  active: RearrangerWasmBackend,
  segment: Float32Array,
  sampleRate: number,
  maxSlices: number,
  minSliceDurationMs: number,
  frameDurationMs: number,
  thresholdStdDev: number,
  sensitivity: number
): number[] | null => {
  const fn = active.exports.detect_regions_f32;
  if (!fn) return null;
  const memory = getMemory(active.exports);
  if (!memory) return null;

  const inputBytes = segment.length * 4;
  const outCapacity = Math.max(2, maxSlices + 1);
  const outBytes = outCapacity * 4;
  const inputPtr = malloc(active.exports, inputBytes);
  const outPtr = malloc(active.exports, outBytes);
  if (!inputPtr || !outPtr) {
    free(active.exports, inputPtr);
    free(active.exports, outPtr);
    return null;
  }

  try {
    new Float32Array(memory.buffer, inputPtr, segment.length).set(segment);
    const count = fn(
      inputPtr,
      segment.length,
      sampleRate,
      maxSlices,
      minSliceDurationMs,
      frameDurationMs,
      thresholdStdDev,
      sensitivity,
      outPtr,
      outCapacity
    );
    return decodeDetectedRegions(active, outPtr, outCapacity, count);
  } catch {
    return null;
  } finally {
    free(active.exports, inputPtr);
    free(active.exports, outPtr);
  }
};

const callInterleavedDetect = (
  active: RearrangerWasmBackend,
  channels: Float32Array[],
  sampleRate: number,
  maxSlices: number,
  minSliceDurationMs: number,
  frameDurationMs: number,
  thresholdStdDev: number,
  sensitivity: number
): number[] | null => {
  const fn = active.exports.detect_regions_interleaved_f32;
  if (!fn) return null;
  const memory = getMemory(active.exports);
  if (!memory) return null;
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  if (channelCount <= 0 || frameCount <= 0) return null;

  const interleaved = new Float32Array(frameCount * channelCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      interleaved[frame * channelCount + channel] = channels[channel][frame] ?? 0;
    }
  }

  const inputBytes = interleaved.length * 4;
  const outCapacity = Math.max(2, maxSlices + 1);
  const outBytes = outCapacity * 4;
  const inputPtr = malloc(active.exports, inputBytes);
  const outPtr = malloc(active.exports, outBytes);
  if (!inputPtr || !outPtr) {
    free(active.exports, inputPtr);
    free(active.exports, outPtr);
    return null;
  }

  try {
    new Float32Array(memory.buffer, inputPtr, interleaved.length).set(interleaved);
    const count = fn(
      inputPtr,
      frameCount,
      channelCount,
      sampleRate,
      maxSlices,
      minSliceDurationMs,
      frameDurationMs,
      thresholdStdDev,
      sensitivity,
      outPtr,
      outCapacity
    );
    return decodeDetectedRegions(active, outPtr, outCapacity, count);
  } catch {
    return null;
  } finally {
    free(active.exports, inputPtr);
    free(active.exports, outPtr);
  }
};

export const tryDetectRegionsWasm = (
  channels: Float32Array[],
  sampleRate: number,
  maxSlices: number,
  minSliceDurationMs: number,
  frameDurationMs: number,
  thresholdStdDev: number,
  sensitivity: number
): number[] | null => {
  ensureLoaded();
  const active = backend;
  if (!active || channels.length === 0) return null;
  const frameCount = channels[0]?.length ?? 0;
  if (frameCount <= 0) return null;
  if (channels.some((channel) => channel.length !== frameCount)) return null;

  const interleaved = callInterleavedDetect(
    active,
    channels,
    sampleRate,
    maxSlices,
    minSliceDurationMs,
    frameDurationMs,
    thresholdStdDev,
    sensitivity
  );
  if (interleaved) return interleaved;

  // Backward-compatible path for existing binaries: run legacy single-channel kernel on mono mix.
  const mono = new Float32Array(frameCount);
  const invChannels = 1 / channels.length;
  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels.length; channel += 1) {
      sum += channels[channel][i] ?? 0;
    }
    mono[i] = sum * invChannels;
  }
  return callSingleChannelDetect(
    active,
    mono,
    sampleRate,
    maxSlices,
    minSliceDurationMs,
    frameDurationMs,
    thresholdStdDev,
    sensitivity
  );
};
