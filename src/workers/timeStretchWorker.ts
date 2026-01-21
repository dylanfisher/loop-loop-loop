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

type RubberBandConstructor = new (
  sampleRate: number,
  channels: number,
  options: { tempo: number; pitch: number }
) => {
  process: (input: Float32Array[], flush: boolean) => void;
  retrieve: () => Float32Array[];
};

type RubberBandModule = {
  default?: unknown;
  RubberBand?: unknown;
};

let rubberBandModulePromise: Promise<unknown> | null = null;

const loadRubberBand = async (): Promise<RubberBandModule> => {
  if (!rubberBandModulePromise) {
    rubberBandModulePromise = import("rubberband-wasm").then(async (mod) => {
      const typedModule = mod as RubberBandModule;
      const init = typedModule.default;
      if (typeof init === "function") {
        return (init as () => Promise<unknown>)();
      }
      return typedModule;
    });
  }
  return (await rubberBandModulePromise) as RubberBandModule;
};

self.onmessage = async (event: MessageEvent<TimeStretchRequest>) => {
  const { deckId, requestId, channels, sampleRate, tempoRatio } = event.data;

  try {
    const module = await loadRubberBand();
    const candidate =
      module.RubberBand ??
      (typeof module.default === "object" ? (module.default as { RubberBand?: unknown }) : null)
        ?.RubberBand ??
      module.default ??
      module;
    const RubberBand = candidate as RubberBandConstructor | undefined;
    if (!RubberBand) {
      throw new Error("RubberBand module unavailable");
    }

    const input = channels.map((buffer) => new Float32Array(buffer));
    const stretcher = new RubberBand(sampleRate, input.length, {
      tempo: tempoRatio,
      pitch: 1,
    });

    if (typeof stretcher.process !== "function" || typeof stretcher.retrieve !== "function") {
      throw new Error("RubberBand API mismatch");
    }

    stretcher.process(input, false);
    const output = stretcher.retrieve();
    if (!Array.isArray(output) || output.length === 0) {
      throw new Error("RubberBand returned empty output");
    }

    const outputBuffers = output.map((channel: Float32Array) => channel.buffer);
    const response: TimeStretchResponse = {
      deckId,
      requestId,
      channels: outputBuffers,
      sampleRate,
    };
    self.postMessage(response, outputBuffers);
  } catch (error) {
    const response: TimeStretchResponse = {
      deckId,
      requestId,
      error: error instanceof Error ? error.message : "Time-stretch failed",
    };
    self.postMessage(response);
  }
};
