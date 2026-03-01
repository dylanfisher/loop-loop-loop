import { encodeWav } from "./audio";
import { setPerfCounter, setPerfTiming } from "./perf";

type WavEncodeRequest = {
  id: number;
  sampleRate: number;
  channels: ArrayBuffer[];
};

type WavEncodeResponse =
  | {
      id: number;
      wavBuffer: ArrayBuffer;
      encodeMs: number;
    }
  | {
      id: number;
      error: string;
      encodeMs: number;
    };

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (blob: Blob) => void; reject: (error: Error) => void }
>();
let lastEncodeUsedWorker = false;
let lastEncodeUsedFallback = false;

const resolveWorker = () => {
  const startedAt = performance.now();
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("../workers/wavWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WavEncodeResponse>) => {
      const response = event.data;
      setPerfTiming("export.encode.wavWorkerMs", response.encodeMs);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if ("error" in response) {
        request.reject(new Error(response.error));
        return;
      }
      request.resolve(new Blob([response.wavBuffer], { type: "audio/wav" }));
    };
    worker.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message || "WAV worker error");
      pending.forEach((request) => request.reject(error));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  setPerfTiming("export.encode.workerInitMs", performance.now() - startedAt);
  setPerfCounter("export.encode.workerAvailable", worker ? 1 : 0);
  return worker;
};

export const warmupWavWorker = () => {
  const startedAt = performance.now();
  const active = resolveWorker();
  setPerfTiming("export.encode.workerWarmupMs", performance.now() - startedAt);
  setPerfCounter("export.encode.workerAvailable", active ? 1 : 0);
  return Boolean(active);
};

export const getLastWavEncodeStats = () => ({
  usedWorker: lastEncodeUsedWorker,
  usedFallback: lastEncodeUsedFallback,
});

const copyChannels = (buffer: AudioBuffer) => {
  const channels: ArrayBuffer[] = [];
  const transferables: ArrayBuffer[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const copy = new Float32Array(source.length);
    copy.set(source);
    channels.push(copy.buffer);
    transferables.push(copy.buffer);
  }
  return { channels, transferables };
};

export const encodeWavOffThread = async (buffer: AudioBuffer) => {
  const startedAt = performance.now();
  const activeWorker = resolveWorker();
  if (!activeWorker) {
    lastEncodeUsedWorker = false;
    lastEncodeUsedFallback = true;
    setPerfCounter("export.encode.usedWorker", 0);
    setPerfCounter("export.encode.usedFallback", 1);
    const fallbackStartedAt = performance.now();
    const blob = encodeWav(buffer);
    setPerfTiming("export.encode.wavFallbackMs", performance.now() - fallbackStartedAt);
    setPerfTiming("export.encode.totalMs", performance.now() - startedAt);
    return blob;
  }
  lastEncodeUsedWorker = true;
  lastEncodeUsedFallback = false;
  setPerfCounter("export.encode.usedWorker", 1);
  setPerfCounter("export.encode.usedFallback", 0);
  const id = nextRequestId;
  nextRequestId += 1;
  const copyStartedAt = performance.now();
  const { channels, transferables } = copyChannels(buffer);
  setPerfTiming("export.encode.copyChannelsMs", performance.now() - copyStartedAt);
  const encoded = await new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: WavEncodeRequest = {
      id,
      sampleRate: buffer.sampleRate,
      channels,
    };
    try {
      activeWorker.postMessage(request, transferables);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error("Failed to post WAV job"));
    }
  }).catch(() => {
    lastEncodeUsedWorker = false;
    lastEncodeUsedFallback = true;
    setPerfCounter("export.encode.usedWorker", 0);
    setPerfCounter("export.encode.usedFallback", 1);
    const fallbackStartedAt = performance.now();
    const blob = encodeWav(buffer);
    setPerfTiming("export.encode.wavFallbackMs", performance.now() - fallbackStartedAt);
    return blob;
  });
  setPerfTiming("export.encode.totalMs", performance.now() - startedAt);
  return encoded;
};
