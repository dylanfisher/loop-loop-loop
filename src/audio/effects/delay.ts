import type { OfflineEffectPlugin } from "./plugin";

export type DelayParams = {
  time: number;
  feedback: number;
  mix: number;
  tone: number;
  pingPong: boolean;
};

export const DELAY_DEFAULTS: DelayParams = {
  time: 0.35,
  feedback: 0.35,
  mix: 0,
  tone: 6000,
  pingPong: false,
};

const MIN_TIME = 0.01;
const MAX_TIME = 1.5;
const MIN_FEEDBACK = 0;
const MAX_FEEDBACK = 0.95;
const MIN_TONE = 400;
const MAX_TONE = 12000;
const MIX_BYPASS_EPSILON = 1e-3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const normalizeDelayParams = (
  params: Partial<DelayParams> | undefined
): DelayParams => ({
  time: clamp(params?.time ?? DELAY_DEFAULTS.time, MIN_TIME, MAX_TIME),
  feedback: clamp(params?.feedback ?? DELAY_DEFAULTS.feedback, MIN_FEEDBACK, MAX_FEEDBACK),
  mix: clamp(params?.mix ?? DELAY_DEFAULTS.mix, 0, 1),
  tone: clamp(params?.tone ?? DELAY_DEFAULTS.tone, MIN_TONE, MAX_TONE),
  pingPong: params?.pingPong ?? DELAY_DEFAULTS.pingPong,
});

export const delayPlugin: OfflineEffectPlugin<DelayParams> = {
  id: "delay",
  applyOffline: (context, input, rawParams) => {
    const params = normalizeDelayParams(rawParams);
    if (params.mix <= MIX_BYPASS_EPSILON) {
      return input;
    }

    const output = context.createGain();
    const dry = context.createGain();
    dry.gain.value = 1 - params.mix;
    input.connect(dry);
    dry.connect(output);

    const wet = context.createGain();
    wet.gain.value = params.mix;

    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const delayL = context.createDelay(2.5);
    const delayR = context.createDelay(2.5);
    const feedbackL = context.createGain();
    const feedbackR = context.createGain();
    const toneL = context.createBiquadFilter();
    const toneR = context.createBiquadFilter();
    toneL.type = "lowpass";
    toneR.type = "lowpass";

    delayL.delayTime.value = params.time;
    delayR.delayTime.value = params.time;
    feedbackL.gain.value = params.feedback;
    feedbackR.gain.value = params.feedback;
    toneL.frequency.value = params.tone;
    toneR.frequency.value = params.tone;

    input.connect(split);
    split.connect(delayL, 0);
    split.connect(delayR, 1);
    delayL.connect(merge, 0, 0);
    delayR.connect(merge, 0, 1);
    merge.connect(wet);
    wet.connect(output);

    delayL.connect(feedbackL);
    delayR.connect(feedbackR);
    feedbackL.connect(toneL);
    feedbackR.connect(toneR);
    if (params.pingPong) {
      toneL.connect(delayR);
      toneR.connect(delayL);
    } else {
      toneL.connect(delayL);
      toneR.connect(delayR);
    }

    return output;
  },
};
