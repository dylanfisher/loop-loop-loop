import { encodeWav } from "./audio";

type WavEncodeRequest = {
  id: number;
  sampleRate: number;
  channels: ArrayBuffer[];
};

type WavEncodeResponse =
  | {
      id: number;
      wavBuffer: ArrayBuffer;
    }
  | {
      id: number;
      error: string;
    };

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (blob: Blob) => void; reject: (error: Error) => void }
>();

const resolveWorker = () => {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("../workers/wavWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WavEncodeResponse>) => {
      const response = event.data;
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
  return worker;
};

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
  const activeWorker = resolveWorker();
  if (!activeWorker) {
    return encodeWav(buffer);
  }
  const id = nextRequestId;
  nextRequestId += 1;
  const { channels, transferables } = copyChannels(buffer);
  return new Promise<Blob>((resolve, reject) => {
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
  }).catch(() => encodeWav(buffer));
};
