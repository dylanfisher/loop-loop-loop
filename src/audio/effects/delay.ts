import type { OfflineEffectPlugin } from "./plugin";

export type DelayParams = {
  time: number;
  feedback: number;
  mix: number;
  tone: number;
  saturation: number;
  damping: number;
  safety: number;
  pingPong: boolean;
};

export const DELAY_DEFAULTS: DelayParams = {
  time: 0.35,
  feedback: 0.35,
  mix: 0,
  tone: 6000,
  saturation: 0,
  damping: 0,
  safety: 0,
  pingPong: false,
};

const MIN_TIME = 0.01;
const MAX_TIME = 1.5;
const MIN_FEEDBACK = 0;
const MAX_FEEDBACK = 0.99;
const MIN_TONE = 400;
const MAX_TONE = 12000;
const MIX_BYPASS_EPSILON = 1e-3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const logLerp = (min: number, max: number, t: number) =>
  Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * t);

export const mapDelayDampingToCutoff = (damping: number) =>
  logLerp(12000, 900, clamp(damping, 0, 1));

export const mapDelaySaturationDrive = (saturation: number) =>
  1 + clamp(saturation, 0, 1) * 2;

export const mapDelaySafetyDrive = (safety: number) =>
  1 + clamp(safety, 0, 1) * 6;

export const createSoftClipCurve = (drive: number, size = 2048) => {
  const amount = Math.max(1, drive);
  const curve = new Float32Array(size);
  const norm = Math.tanh(amount);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / norm;
  }
  return curve;
};

export const normalizeDelayParams = (
  params: Partial<DelayParams> | undefined
): DelayParams => ({
  time: clamp(params?.time ?? DELAY_DEFAULTS.time, MIN_TIME, MAX_TIME),
  feedback: clamp(params?.feedback ?? DELAY_DEFAULTS.feedback, MIN_FEEDBACK, MAX_FEEDBACK),
  mix: clamp(params?.mix ?? DELAY_DEFAULTS.mix, 0, 1),
  tone: clamp(params?.tone ?? DELAY_DEFAULTS.tone, MIN_TONE, MAX_TONE),
  saturation: clamp(params?.saturation ?? DELAY_DEFAULTS.saturation, 0, 1),
  damping: clamp(params?.damping ?? DELAY_DEFAULTS.damping, 0, 1),
  safety: clamp(params?.safety ?? DELAY_DEFAULTS.safety, 0, 1),
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
    const dampingL = context.createBiquadFilter();
    const dampingR = context.createBiquadFilter();
    const saturationDriveL = context.createGain();
    const saturationDriveR = context.createGain();
    const saturationShapeL = context.createWaveShaper();
    const saturationShapeR = context.createWaveShaper();
    const saturationOutL = context.createGain();
    const saturationOutR = context.createGain();
    const safetyDrive = context.createGain();
    const safetyShape = context.createWaveShaper();
    const safetyOut = context.createGain();
    toneL.type = "lowpass";
    toneR.type = "lowpass";
    dampingL.type = "lowpass";
    dampingR.type = "lowpass";

    delayL.delayTime.value = params.time;
    delayR.delayTime.value = params.time;
    feedbackL.gain.value = params.feedback;
    feedbackR.gain.value = params.feedback;
    toneL.frequency.value = params.tone;
    toneR.frequency.value = params.tone;
    dampingL.frequency.value = mapDelayDampingToCutoff(params.damping);
    dampingR.frequency.value = mapDelayDampingToCutoff(params.damping);
    saturationDriveL.gain.value = mapDelaySaturationDrive(params.saturation);
    saturationDriveR.gain.value = mapDelaySaturationDrive(params.saturation);
    saturationShapeL.curve = createSoftClipCurve(saturationDriveL.gain.value);
    saturationShapeR.curve = createSoftClipCurve(saturationDriveR.gain.value);
    saturationShapeL.oversample = "2x";
    saturationShapeR.oversample = "2x";
    saturationOutL.gain.value = 1 / saturationDriveL.gain.value;
    saturationOutR.gain.value = 1 / saturationDriveR.gain.value;
    safetyDrive.gain.value = mapDelaySafetyDrive(params.safety);
    safetyShape.curve = createSoftClipCurve(safetyDrive.gain.value);
    safetyShape.oversample = "2x";
    safetyOut.gain.value = 1 / safetyDrive.gain.value;

    input.connect(split);
    split.connect(delayL, 0);
    split.connect(delayR, 1);
    delayL.connect(merge, 0, 0);
    delayR.connect(merge, 0, 1);
    merge.connect(safetyDrive);
    safetyDrive.connect(safetyShape);
    safetyShape.connect(safetyOut);
    safetyOut.connect(wet);
    wet.connect(output);

    delayL.connect(feedbackL);
    delayR.connect(feedbackR);
    feedbackL.connect(toneL);
    feedbackR.connect(toneR);
    toneL.connect(dampingL);
    toneR.connect(dampingR);
    dampingL.connect(saturationDriveL);
    dampingR.connect(saturationDriveR);
    saturationDriveL.connect(saturationShapeL);
    saturationDriveR.connect(saturationShapeR);
    saturationShapeL.connect(saturationOutL);
    saturationShapeR.connect(saturationOutR);
    if (params.pingPong) {
      saturationOutL.connect(delayR);
      saturationOutR.connect(delayL);
    } else {
      saturationOutL.connect(delayL);
      saturationOutR.connect(delayR);
    }

    return output;
  },
};
