import { RubberBandInterface, RubberBandOption } from "rubberband-wasm";

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
  rubberband_process: (state: number, input: number, samples: number, final: number) => void;
};

let rbApiPromise: Promise<RubberBandApi> | null = null;
let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

const setWasmModule = (bytes: ArrayBuffer) => {
  if (!wasmModulePromise) {
    wasmModulePromise = WebAssembly.compile(bytes);
  }
};

const getRubberBandApi = async (): Promise<RubberBandApi> => {
  if (!rbApiPromise) {
    rbApiPromise = (async () => {
      if (!wasmModulePromise) {
        throw new Error("Rubber Band wasm not provided");
      }
      const wasm = await wasmModulePromise;
      return RubberBandInterface.initialize(wasm);
    })();
  }
  return rbApiPromise;
};

class TimeStretchProcessor extends AudioWorkletProcessor {
  private rbApi: RubberBandApi | null = null;
  private rbState: number | null = null;
  private channelArrayPtr = 0;
  private channelDataPtr: number[] = [];
  private outputQueue: Float32Array[] = [];
  private timeRatio = 1;
  private channelCount = 2;
  private initialized = false;
  private initializing = false;
  private bufferCapacity = 0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      const { type } = event.data as { type?: string };
      if (type === "init") {
        const { channelCount, wasmBytes } = event.data as {
          channelCount: number;
          wasmBytes?: ArrayBuffer;
        };
        if (wasmBytes) {
          setWasmModule(wasmBytes);
        }
        this.channelCount = channelCount;
        void this.initialize();
      }
      if (type === "set-tempo") {
        const { timeRatio } = event.data as { timeRatio: number };
        this.timeRatio = timeRatio;
        if (this.rbApi && this.rbState !== null) {
          this.rbApi.rubberband_set_time_ratio(this.rbState, timeRatio);
        }
      }
    };
  }

  private async initialize() {
    if (this.initializing) return;
    this.initializing = true;
    try {
      this.rbApi = await getRubberBandApi();
      const options =
        RubberBandOption.RubberBandOptionProcessRealTime |
        RubberBandOption.RubberBandOptionStretchPrecise |
        RubberBandOption.RubberBandOptionPhaseIndependent |
        RubberBandOption.RubberBandOptionChannelsTogether;
      this.rbState = this.rbApi.rubberband_new(sampleRate, this.channelCount, options, 1, 1);
      this.rbApi.rubberband_set_pitch_scale(this.rbState, 1);
      this.rbApi.rubberband_set_time_ratio(this.rbState, this.timeRatio);
      this.channelArrayPtr = this.rbApi.malloc(this.channelCount * 4);
      this.channelDataPtr = [];
      this.outputQueue = [];
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        this.channelDataPtr.push(0);
        this.outputQueue[channel] = new Float32Array(0);
      }
      this.initialized = true;
      this.port.postMessage({ type: "stretch:ready" });
    } catch (error) {
      this.port.postMessage({
        type: "stretch:error",
        error: error instanceof Error ? error.message : "init failed",
      });
    } finally {
      this.initializing = false;
    }
  }

  private ensureInputBuffers(size: number) {
    if (!this.rbApi || this.rbState === null) return;
    if (size <= this.bufferCapacity) return;
    for (let channel = 0; channel < this.channelCount; channel += 1) {
      if (this.channelDataPtr[channel]) {
        this.rbApi.free(this.channelDataPtr[channel]);
      }
      const bufferPtr = this.rbApi.malloc(size * 4);
      this.channelDataPtr[channel] = bufferPtr;
      this.rbApi.memWritePtr(this.channelArrayPtr + channel * 4, bufferPtr);
    }
    this.bufferCapacity = size;
    this.rbApi.rubberband_set_max_process_size(this.rbState, size);
  }

  private enqueueOutput() {
    if (!this.rbApi || this.rbState === null) return;
    while (true) {
      const available = this.rbApi.rubberband_available(this.rbState);
      if (available < 1) break;
      const recv = this.rbApi.rubberband_retrieve(this.rbState, this.channelArrayPtr, available);
      if (recv < 1) break;
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        const samples = this.rbApi.memReadF32(this.channelDataPtr[channel], recv);
        const existing = this.outputQueue[channel];
        const merged = new Float32Array(existing.length + samples.length);
        merged.set(existing, 0);
        merged.set(samples, existing.length);
        this.outputQueue[channel] = merged;
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    if (!this.initialized || !this.rbApi || this.rbState === null) {
      for (let channel = 0; channel < output.length; channel += 1) {
        const out = output[channel];
        const source = input[channel] ?? input[0];
        if (source) {
          out.set(source.subarray(0, out.length));
          if (source.length < out.length) {
            out.fill(0, source.length);
          }
        } else {
          out.fill(0);
        }
      }
      return true;
    }

    const frameCount = input[0]?.length ?? 0;
    if (frameCount > 0) {
      this.ensureInputBuffers(frameCount);
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        const inChannel = input[channel] ?? input[0];
        this.rbApi.memWrite(this.channelDataPtr[channel], inChannel);
      }
      this.rbApi.rubberband_process(this.rbState, this.channelArrayPtr, frameCount, 0);
      this.enqueueOutput();
    }

    for (let channel = 0; channel < output.length; channel += 1) {
      const out = output[channel];
      const queued = this.outputQueue[channel];
      if (queued && queued.length >= out.length) {
        out.set(queued.subarray(0, out.length));
        this.outputQueue[channel] = queued.subarray(out.length);
      } else if (queued) {
        out.set(queued);
        out.fill(0, queued.length);
        this.outputQueue[channel] = new Float32Array(0);
      } else {
        out.fill(0);
      }
    }

    return true;
  }
}

registerProcessor("time-stretch-processor", TimeStretchProcessor);
