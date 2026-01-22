type TimeStretchRequest = {
  deckId: number;
  requestId: number;
  channels: ArrayBuffer[];
  sampleRate: number;
  tempoRatio: number;
};

type TimeStretchResponse = {
  deckId: number;
  requestId: number;
  channels?: ArrayBuffer[];
  sampleRate?: number;
  error?: string;
};

type RubberBandModule = {
  default?: unknown;
  RubberBand?: unknown;
  RubberBandInterface?: unknown;
};

let rubberBandModulePromise: Promise<unknown> | null = null;
let rubberBandLoadCount = 0;
let wasmUrl: string | null = null;
let rbApiPromise: Promise<RubberBandApi> | null = null;

type RubberBandApi = {
  malloc: (bytes: number) => number;
  free: (ptr: number) => void;
  memWrite: (ptr: number, data: Float32Array) => void;
  memWritePtr: (ptr: number, value: number) => void;
  memReadF32: (ptr: number, length: number) => Float32Array;
  rubberband_new: (
    sampleRate: number,
    channels: number,
    options: number,
    initialTimeRatio: number,
    initialPitchScale: number
  ) => number;
  rubberband_delete: (state: number) => void;
  rubberband_set_time_ratio: (state: number, ratio: number) => void;
  rubberband_set_pitch_scale: (state: number, scale: number) => void;
  rubberband_get_samples_required: (state: number) => number;
  rubberband_set_expected_input_duration: (state: number, samples: number) => void;
  rubberband_available: (state: number) => number;
  rubberband_retrieve: (state: number, output: number, samples: number) => number;
  rubberband_study: (state: number, input: number, samples: number, final: number) => void;
  rubberband_process: (state: number, input: number, samples: number, final: number) => void;
};

const resolveWasmUrl = async () => {
  if (wasmUrl) return wasmUrl;
  const resolved = (await import("rubberband-wasm/dist/rubberband.wasm?url"))
    .default as string;
  self.postMessage({ type: "rubberband:wasm-url", url: resolved });
  wasmUrl = resolved;
  return resolved;
};

const loadRubberBand = async (): Promise<RubberBandModule> => {
  rubberBandLoadCount += 1;
  self.postMessage({
    type: "rubberband:load",
    attempt: rubberBandLoadCount,
  });
  if (!rubberBandModulePromise) {
    rubberBandModulePromise = import("rubberband-wasm").then(async (mod) => {
      self.postMessage({ type: "rubberband:module-imported" });
      const typedModule = mod as RubberBandModule;
      const init = typedModule.default;
      if (typeof init === "function") {
        self.postMessage({ type: "rubberband:init", hasDefault: true });
        const url = await resolveWasmUrl();
        return (init as (options?: { locateFile?: (path: string) => string }) => Promise<unknown>)(
          {
            locateFile: () => url,
          }
        );
      }
      self.postMessage({ type: "rubberband:init", hasDefault: false });
      return typedModule;
    });
  }
  const module = (await rubberBandModulePromise) as RubberBandModule;
  self.postMessage({
    type: "rubberband:ready",
    attempt: rubberBandLoadCount,
    hasDefault: Boolean(module.default),
    hasConstructor: Boolean(module.RubberBand),
    hasInterface: Boolean(module.RubberBandInterface),
  });
  return module;
};

const getRubberBandApi = async (): Promise<RubberBandApi> => {
  if (!rbApiPromise) {
    rbApiPromise = (async () => {
      const module = await loadRubberBand();
      const RubberBandInterface =
        (module.RubberBandInterface as { initialize?: (wasm: WebAssembly.Module) => Promise<RubberBandApi> }) ??
        (typeof module.default === "object"
          ? (module.default as { RubberBandInterface?: { initialize?: (wasm: WebAssembly.Module) => Promise<RubberBandApi> } })
              .RubberBandInterface
          : undefined);
      if (!RubberBandInterface?.initialize) {
        throw new Error("RubberBandInterface.initialize not found");
      }
      const url = await resolveWasmUrl();
      const wasm = await WebAssembly.compileStreaming(fetch(url));
      return RubberBandInterface.initialize(wasm);
    })();
  }
  return rbApiPromise;
};

self.onmessage = async (event: MessageEvent<TimeStretchRequest | { type: string }>) => {
  if ("type" in event.data && event.data.type === "ping") {
    self.postMessage({ type: "rubberband:pong" });
    return;
  }

  const { deckId, requestId, channels, sampleRate, tempoRatio } =
    event.data as TimeStretchRequest;

  try {
    const rbApi = await getRubberBandApi();
    const input = channels.map((buffer) => new Float32Array(buffer));
    const outputSamples = Math.ceil(input[0].length * tempoRatio);
    const outputBuffers = input.map(() => new Float32Array(outputSamples));

    const rbState = rbApi.rubberband_new(sampleRate, input.length, 0, 1, 1);
    rbApi.rubberband_set_pitch_scale(rbState, 1);
    rbApi.rubberband_set_time_ratio(rbState, tempoRatio);
    const samplesRequired = Math.max(256, rbApi.rubberband_get_samples_required(rbState));

    const channelArrayPtr = rbApi.malloc(input.length * 4);
    const channelDataPtr: number[] = [];
    for (let channel = 0; channel < input.length; channel += 1) {
      const bufferPtr = rbApi.malloc(samplesRequired * 4);
      channelDataPtr.push(bufferPtr);
      rbApi.memWritePtr(channelArrayPtr + channel * 4, bufferPtr);
    }

    rbApi.rubberband_set_expected_input_duration(rbState, input[0].length);

    let read = 0;
    while (read < input[0].length) {
      input.forEach((buf, i) =>
        rbApi.memWrite(channelDataPtr[i], buf.subarray(read, read + samplesRequired))
      );
      const remaining = Math.min(samplesRequired, input[0].length - read);
      read += remaining;
      const isFinal = read < input[0].length;
      rbApi.rubberband_study(rbState, channelArrayPtr, remaining, isFinal ? 0 : 1);
    }

    read = 0;
    let write = 0;
    const tryRetrieve = (final = false) => {
      while (true) {
        const available = rbApi.rubberband_available(rbState);
        if (available < 1) break;
        if (!final && available < samplesRequired) break;
        const recv = rbApi.rubberband_retrieve(
          rbState,
          channelArrayPtr,
          Math.min(samplesRequired, available)
        );
        channelDataPtr.forEach((ptr, i) => {
          outputBuffers[i].set(rbApi.memReadF32(ptr, recv), write);
        });
        write += recv;
      }
    };

    while (read < input[0].length) {
      input.forEach((buf, i) =>
        rbApi.memWrite(channelDataPtr[i], buf.subarray(read, read + samplesRequired))
      );
      const remaining = Math.min(samplesRequired, input[0].length - read);
      read += remaining;
      const isFinal = read < input[0].length;
      rbApi.rubberband_process(rbState, channelArrayPtr, remaining, isFinal ? 0 : 1);
      tryRetrieve(false);
    }
    tryRetrieve(true);

    channelDataPtr.forEach((ptr) => rbApi.free(ptr));
    rbApi.free(channelArrayPtr);
    rbApi.rubberband_delete(rbState);

    const outputBuffersRaw = outputBuffers.map((channel) => channel.buffer);
    const response: TimeStretchResponse & { type: "rubberband:result" } = {
      deckId,
      requestId,
      channels: outputBuffersRaw,
      sampleRate,
      type: "rubberband:result",
    };
    self.postMessage(response, outputBuffersRaw);
  } catch (error) {
    const response: TimeStretchResponse & { type: "rubberband:error" } = {
      deckId,
      requestId,
      error: error instanceof Error ? error.message : "Time-stretch failed",
      type: "rubberband:error",
    };
    self.postMessage(response);
  }
};
