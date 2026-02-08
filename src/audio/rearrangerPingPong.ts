import rearrangerPingPongUrl from "./worklets/rearrangerPingPongProcessor.ts?worker&url";

export type RearrangerPingPongConfig = {
  enabled: boolean;
  loopStart: number;
  loopEnd: number;
  playbackRate: number;
  regions: number[];
  sliceDelaySec?: number;
  anchorTime: number;
  anchorPosition: number;
};

export type RearrangerPingPongNodes = {
  input: GainNode;
  output: GainNode;
  worklet?: AudioWorkletNode;
};

const workletPromises = new WeakMap<BaseAudioContext, Promise<void>>();
const workletReady = new WeakMap<BaseAudioContext, boolean>();

export const ensureRearrangerPingPongWorklet = async (context: BaseAudioContext) => {
  if (!context.audioWorklet) return false;
  if (workletReady.get(context)) return true;

  let promise = workletPromises.get(context);
  if (!promise) {
    promise = context.audioWorklet
      .addModule(rearrangerPingPongUrl)
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

export const createRearrangerPingPongNodes = (
  context: BaseAudioContext
): RearrangerPingPongNodes => {
  const input = context.createGain();
  const output = context.createGain();
  let worklet: AudioWorkletNode | undefined;

  if (context.audioWorklet && workletReady.get(context)) {
    try {
      worklet = new AudioWorkletNode(context, "rearranger-pingpong-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      input.connect(worklet);
      worklet.connect(output);
    } catch (error) {
      workletReady.delete(context);
      workletPromises.delete(context);
      if (import.meta.env.DEV) {
        console.warn("Rearranger ping pong worklet unavailable", error);
      }
    }
  }

  if (!worklet) {
    input.connect(output);
  }

  return { input, output, worklet };
};

export const setRearrangerPingPongAmount = (
  nodes: RearrangerPingPongNodes,
  value: number,
  atTime?: number
) => {
  const amount = Math.min(Math.max(value, 0), 1);
  const param = nodes.worklet?.parameters.get("amount");
  if (!param) return;
  if (atTime === undefined) {
    param.value = amount;
    return;
  }
  param.setValueAtTime(amount, Math.max(0, atTime));
};

export const setRearrangerPingPongConfig = (
  nodes: RearrangerPingPongNodes,
  config: RearrangerPingPongConfig | null
) => {
  if (!nodes.worklet) return;
  if (!config || !config.enabled) {
    nodes.worklet.port.postMessage({ type: "disable" });
    return;
  }
  nodes.worklet.port.postMessage({
    type: "config",
    enabled: true,
    loopStart: Number.isFinite(config.loopStart) ? config.loopStart : 0,
    loopEnd: Number.isFinite(config.loopEnd) ? config.loopEnd : 0,
    playbackRate: Number.isFinite(config.playbackRate) ? config.playbackRate : 1,
    regions: Array.isArray(config.regions) ? config.regions : [0, 1],
    sliceDelaySec: Number.isFinite(config.sliceDelaySec) ? config.sliceDelaySec : 0,
    anchorTime: Number.isFinite(config.anchorTime) ? config.anchorTime : 0,
    anchorPosition: Number.isFinite(config.anchorPosition) ? config.anchorPosition : 0,
  });
};

export const disposeRearrangerPingPong = (nodes: RearrangerPingPongNodes) => {
  nodes.input.disconnect();
  nodes.output.disconnect();
  nodes.worklet?.disconnect();
};
