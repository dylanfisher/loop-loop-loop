import paulStretchUrl from "./worklets/paulStretchProcessor.ts?worker&url";
import {
  ensureDspCoreWasmForContext,
  getDspCoreWasmForContext,
} from "./wasm/dspCore";

const workletPromises = new WeakMap<BaseAudioContext, Promise<void>>();
const workletReady = new WeakMap<BaseAudioContext, boolean>();
const wasmBytesByContext = new WeakMap<BaseAudioContext, ArrayBuffer | null>();
const paulStretchWasmUrl = `${import.meta.env.BASE_URL}wasm/paulstretch.wasm`;
let paulStretchWasmLoad: Promise<ArrayBuffer | null> | null = null;

const loadPaulStretchWasmBytes = () => {
  if (paulStretchWasmLoad) return paulStretchWasmLoad;
  if (typeof window === "undefined") {
    paulStretchWasmLoad = Promise.resolve(null);
    return paulStretchWasmLoad;
  }
  paulStretchWasmLoad = (async () => {
    try {
      const response = await fetch(paulStretchWasmUrl);
      if (!response.ok) return null;
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  })();
  return paulStretchWasmLoad;
};

export const ensurePaulStretchWorklet = async (context: BaseAudioContext) => {
  if (!context.audioWorklet) return false;
  const ready = workletReady.get(context);
  if (ready) return true;

  let promise = workletPromises.get(context);
  if (!promise) {
    promise = context.audioWorklet
      .addModule(paulStretchUrl)
      .then(() => {
        workletReady.set(context, true);
      })
      .catch((error) => {
        workletPromises.delete(context);
        throw error;
      });
    workletPromises.set(context, promise);
  }

  const wasmBytes = await loadPaulStretchWasmBytes();
  wasmBytesByContext.set(context, wasmBytes);
  await ensureDspCoreWasmForContext(context);
  await promise;
  return true;
};

export const createPaulStretchNode = (
  context: BaseAudioContext,
  options?: {
    ratio?: number;
    winSize?: number;
    inputSamples?: number;
    outputSamples?: number;
    stereoWidth?: number;
    phaseRandomness?: number;
    tilt?: number;
    scatter?: number;
  }
) => {
  const {
    ratio = 1,
    winSize = 4096,
    inputSamples,
    outputSamples,
    stereoWidth = 1,
    phaseRandomness = 1,
    tilt = 0,
    scatter = 1,
  } = options ?? {};
  const node = new AudioWorkletNode(context, "paul-stretch-processor", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    processorOptions: {
      ratio,
      winSize,
      inputSamples,
      outputSamples,
      paulStretchWasmBytes: wasmBytesByContext.get(context) ?? null,
      dspCoreWasmBytes: getDspCoreWasmForContext(context),
    },
    parameterData: {
      ratio,
      stereoWidth,
      phaseRandomness,
      tilt,
      scatter,
    },
  });
  const param = node.parameters.get("ratio");
  if (param) {
    param.value = ratio;
  }
  return node;
};
