export type PitchShiftNodes = {
  input: GainNode;
  output: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  worklet?: AudioWorkletNode;
  pitch: number;
};

export type PitchShiftWorkletConfig = {
  fftFrameSize: number;
  osamp: number;
};

const DEFAULT_FFT_FRAME_SIZE = 1024;
const DEFAULT_OSAMP = 8;
const ZERO_THRESHOLD = 0.001;

const workletPromises = new WeakMap<BaseAudioContext, Promise<void>>();
const workletReady = new WeakMap<BaseAudioContext, boolean>();

export const ensurePitchShiftWorklet = async (context: BaseAudioContext) => {
  if (!context.audioWorklet) return false;
  const ready = workletReady.get(context);
  if (ready) return true;

  let promise = workletPromises.get(context);
  if (!promise) {
    promise = context.audioWorklet
      .addModule(new URL("./worklets/pitchVocoderProcessor.ts", import.meta.url))
      .then(() => {
        workletReady.set(context, true);
      })
      .catch((error) => {
        workletPromises.delete(context);
        throw error;
      });
    workletPromises.set(context, promise);
  }

  await promise;
  return true;
};

export const createPitchShiftNodes = (
  context: BaseAudioContext,
  options?: Partial<PitchShiftWorkletConfig>
): PitchShiftNodes => {
  const input = context.createGain();
  const output = context.createGain();
  const dryGain = context.createGain();
  const wetGain = context.createGain();
  dryGain.gain.value = 1;
  wetGain.gain.value = 0;
  let worklet: AudioWorkletNode | undefined;

  input.connect(dryGain);
  dryGain.connect(output);

  if (context.audioWorklet && workletReady.get(context)) {
    const config = {
      fftFrameSize: options?.fftFrameSize ?? DEFAULT_FFT_FRAME_SIZE,
      osamp: options?.osamp ?? DEFAULT_OSAMP,
    };
    worklet = new AudioWorkletNode(context, "pitch-vocoder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: {
        fftFrameSize: config.fftFrameSize,
        osamp: config.osamp,
      },
    });
    worklet.channelCountMode = "max";
    input.connect(worklet);
    worklet.connect(wetGain);
    wetGain.connect(output);
  }

  const nodes: PitchShiftNodes = {
    input,
    output,
    dryGain,
    wetGain,
    worklet,
    pitch: 0,
  };

  setPitchShift(nodes, 0);
  return nodes;
};

export const setPitchShift = (nodes: PitchShiftNodes, pitch: number) => {
  nodes.pitch = pitch;
  const isZero = Math.abs(pitch) < ZERO_THRESHOLD;
  nodes.dryGain.gain.value = isZero ? 1 : 0;
  nodes.wetGain.gain.value = isZero ? 0 : 1;
  const param = nodes.worklet?.parameters.get("pitch");
  if (param) {
    param.setValueAtTime(pitch, nodes.worklet!.context.currentTime);
  }
  if (isZero) {
    nodes.worklet?.port.postMessage({ type: "reset" });
  }
};

export const disposePitchShift = (nodes: PitchShiftNodes) => {
  nodes.input.disconnect();
  nodes.output.disconnect();
  nodes.dryGain.disconnect();
  nodes.wetGain.disconnect();
  nodes.worklet?.disconnect();
};
