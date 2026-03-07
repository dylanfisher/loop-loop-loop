import type { OfflineEffectPlugin } from "./plugin";
import { createPitchShiftNodes, setPitchShift } from "../pitchShift";

export type DelayParams = {
  time: number;
  feedback: number;
  mix: number;
  tone: number;
  saturation: number;
  damping: number;
  safety: number;
  pingPong: boolean;
  rhythmMorph: number;
  rhythmRateHz: number;
  rhythmSwing: number;
  duckDepth: number;
  duckThreshold: number;
  duckResponseMs: number;
  spectralMix: number;
  spectralSpread: number;
  spectralMotion: number;
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
  rhythmMorph: 0,
  rhythmRateHz: 0,
  rhythmSwing: 0,
  duckDepth: 0,
  duckThreshold: 0.2,
  duckResponseMs: 80,
  spectralMix: 0,
  spectralSpread: 0.35,
  spectralMotion: 0.2,
};

const MIN_TIME = 0.01;
const MAX_TIME = 1.5;
const MIN_FEEDBACK = 0;
const MAX_FEEDBACK = 0.99;
const MIN_TONE = 400;
const MAX_TONE = 12000;
const MIN_PITCH_LADDER_SEMITONES = -12;
const MAX_PITCH_LADDER_SEMITONES = 12;
const MIN_DUCK_RESPONSE_MS = 8;
const MAX_DUCK_RESPONSE_MS = 800;
const MIX_BYPASS_EPSILON = 1e-3;
export const DELAY_FEEDBACK_AIR_TRIM_FREQ = 4200;
export const DELAY_FEEDBACK_AIR_TRIM_DB = -4.5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const logLerp = (min: number, max: number, t: number) =>
  Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * t);

export const mapDelayDampingToCutoff = (damping: number) =>
  logLerp(12000, 900, clamp(damping, 0, 1));

export const mapDelaySaturationDrive = (saturation: number) =>
  1 + clamp(saturation, 0, 1) * 2;

export const mapDelaySafetyFeedbackMultiplier = (safety: number) =>
  1 - Math.pow(clamp(safety, 0, 1), 1.4) * 0.5;

export const mapDelaySafetyOutputTrim = (safety: number) =>
  1 - Math.pow(clamp(safety, 0, 1), 0.85) * 0.22;

export const mapDelayDiffusionSettings = (diffusion: number) => {
  const amount = clamp(diffusion, 0, 1);
  const wet = Math.pow(amount, 0.7);
  const dry = Math.max(0, 1 - wet * 0.9);
  const frequency = 450 + amount * 5200;
  const q = 0.2 + amount * 5.5;
  return { wet, dry, frequency, q };
};

const applyDelaySafetyCompressor = (
  compressor: DynamicsCompressorNode,
  safety: number
) => {
  const amount = clamp(safety, 0, 1);
  if (amount <= 1e-4) {
    compressor.threshold.value = 0;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.08;
    return;
  }
  compressor.threshold.value = -12 - amount * 36;
  compressor.knee.value = 6 + amount * 24;
  compressor.ratio.value = 1 + amount * 19;
  compressor.attack.value = 0.001 + (1 - amount) * 0.004;
  compressor.release.value = 0.04 + (1 - amount) * 0.12;
};

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

const absCurveCache = new Map<number, Float32Array<ArrayBuffer>>();

export const createAbsCurve = (size = 2048): Float32Array<ArrayBuffer> => {
  const cached = absCurveCache.get(size);
  if (cached) return cached;
  const curve = new Float32Array(new ArrayBuffer(size * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.abs(x);
  }
  absCurveCache.set(size, curve);
  return curve;
};

export const createThresholdCurve = (threshold: number, size = 2048) => {
  const t = clamp(threshold, 0, 0.98);
  const curve = new Float32Array(size);
  const denom = Math.max(1e-4, 1 - t);
  for (let i = 0; i < size; i += 1) {
    const x = i / (size - 1);
    const normalized = (x - t) / denom;
    curve[i] = clamp(normalized, 0, 1);
  }
  return curve;
};

export const mapDuckResponseToFollowerCutoff = (ms: number) => {
  const clampedMs = clamp(ms, MIN_DUCK_RESPONSE_MS, MAX_DUCK_RESPONSE_MS);
  const hz = 1000 / clampedMs;
  return clamp(hz, 2, 120);
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
  rhythmMorph: clamp(params?.rhythmMorph ?? DELAY_DEFAULTS.rhythmMorph, 0, 1),
  rhythmRateHz: clamp(
    params?.rhythmRateHz ?? DELAY_DEFAULTS.rhythmRateHz,
    MIN_PITCH_LADDER_SEMITONES,
    MAX_PITCH_LADDER_SEMITONES
  ),
  rhythmSwing: clamp(params?.rhythmSwing ?? DELAY_DEFAULTS.rhythmSwing, 0, 1),
  duckDepth: clamp(params?.duckDepth ?? DELAY_DEFAULTS.duckDepth, 0, 1),
  duckThreshold: clamp(params?.duckThreshold ?? DELAY_DEFAULTS.duckThreshold, 0, 1),
  duckResponseMs: clamp(
    params?.duckResponseMs ?? DELAY_DEFAULTS.duckResponseMs,
    MIN_DUCK_RESPONSE_MS,
    MAX_DUCK_RESPONSE_MS
  ),
  spectralMix: clamp(params?.spectralMix ?? DELAY_DEFAULTS.spectralMix, 0, 1),
  spectralSpread: clamp(params?.spectralSpread ?? DELAY_DEFAULTS.spectralSpread, 0, 1),
  spectralMotion: clamp(params?.spectralMotion ?? DELAY_DEFAULTS.spectralMotion, 0, 1),
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
    const wetDuckGain = context.createGain();
    wetDuckGain.gain.value = 1;

    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const delayL = context.createDelay(2.5);
    const delayR = context.createDelay(2.5);
    const feedbackL = context.createGain();
    const feedbackR = context.createGain();
    const toneL = context.createBiquadFilter();
    const toneR = context.createBiquadFilter();
    const airTrimL = context.createBiquadFilter();
    const airTrimR = context.createBiquadFilter();
    const dampingL = context.createBiquadFilter();
    const dampingR = context.createBiquadFilter();
    const saturationDriveL = context.createGain();
    const saturationDriveR = context.createGain();
    const saturationShapeL = context.createWaveShaper();
    const saturationShapeR = context.createWaveShaper();
    const saturationOutL = context.createGain();
    const saturationOutR = context.createGain();
    const safetyCompressor = context.createDynamicsCompressor();
    const safetyOut = context.createGain();
    toneL.type = "lowpass";
    toneR.type = "lowpass";
    airTrimL.type = "highshelf";
    airTrimR.type = "highshelf";
    airTrimL.frequency.value = DELAY_FEEDBACK_AIR_TRIM_FREQ;
    airTrimR.frequency.value = DELAY_FEEDBACK_AIR_TRIM_FREQ;
    airTrimL.gain.value = DELAY_FEEDBACK_AIR_TRIM_DB;
    airTrimR.gain.value = DELAY_FEEDBACK_AIR_TRIM_DB;
    dampingL.type = "lowpass";
    dampingR.type = "lowpass";
    delayL.delayTime.value = params.time;
    delayR.delayTime.value = params.time;
    const safetyFeedbackMultiplier = mapDelaySafetyFeedbackMultiplier(params.safety);
    feedbackL.gain.value = params.feedback * safetyFeedbackMultiplier;
    feedbackR.gain.value = params.feedback * safetyFeedbackMultiplier;
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
    applyDelaySafetyCompressor(safetyCompressor, params.safety);
    safetyOut.gain.value = mapDelaySafetyOutputTrim(params.safety);

    input.connect(split);
    split.connect(delayL, 0);
    split.connect(delayR, 1);
    delayL.connect(merge, 0, 0);
    delayR.connect(merge, 0, 1);
    merge.connect(safetyCompressor);
    safetyCompressor.connect(safetyOut);
    safetyOut.connect(wetDuckGain);
    wetDuckGain.connect(wet);
    wet.connect(output);

    if (params.duckDepth > 1e-3) {
      const duckRectifier = context.createWaveShaper();
      duckRectifier.curve = createAbsCurve();
      const duckFollower = context.createBiquadFilter();
      duckFollower.type = "lowpass";
      duckFollower.frequency.value = mapDuckResponseToFollowerCutoff(params.duckResponseMs);
      const duckThreshold = context.createWaveShaper();
      duckThreshold.curve = createThresholdCurve(params.duckThreshold);
      const duckDepth = context.createGain();
      duckDepth.gain.value = -params.duckDepth;
      input.connect(duckRectifier);
      duckRectifier.connect(duckFollower);
      duckFollower.connect(duckThreshold);
      duckThreshold.connect(duckDepth);
      duckDepth.connect(wetDuckGain.gain);
    }

    const pitchMix = clamp(params.rhythmMorph, 0, 1);
    const stepSemitones = clamp(params.rhythmRateHz, MIN_PITCH_LADDER_SEMITONES, MAX_PITCH_LADDER_SEMITONES);
    const pitchShiftRequested = pitchMix > 1e-3 && Math.abs(stepSemitones) > 1e-3;
    const diffusionAmount = clamp(params.rhythmSwing, 0, 1);
    const diffusionActive = diffusionAmount > 1e-3;
    let feedbackInputL: AudioNode = airTrimL;
    let feedbackInputR: AudioNode = airTrimR;

    if (pitchShiftRequested) {
      const pitchL = createPitchShiftNodes(context);
      const pitchR = createPitchShiftNodes(context);
      const canPitchShift = Boolean(pitchL.worklet && pitchR.worklet);
      if (canPitchShift) {
        setPitchShift(pitchL, stepSemitones);
        setPitchShift(pitchR, stepSemitones);
        pitchL.dryGain.gain.value = 1 - pitchMix;
        pitchL.wetGain.gain.value = pitchMix;
        pitchR.dryGain.gain.value = 1 - pitchMix;
        pitchR.wetGain.gain.value = pitchMix;
      } else {
        setPitchShift(pitchL, 0);
        setPitchShift(pitchR, 0);
        pitchL.dryGain.gain.value = 1;
        pitchL.wetGain.gain.value = 0;
        pitchR.dryGain.gain.value = 1;
        pitchR.wetGain.gain.value = 0;
      }
      airTrimL.connect(pitchL.input);
      airTrimR.connect(pitchR.input);
      feedbackInputL = pitchL.output;
      feedbackInputR = pitchR.output;
    }

    if (diffusionActive) {
      const diffusionSettings = mapDelayDiffusionSettings(diffusionAmount);
      const diffusionL1 = context.createBiquadFilter();
      const diffusionL2 = context.createBiquadFilter();
      const diffusionR1 = context.createBiquadFilter();
      const diffusionR2 = context.createBiquadFilter();
      const diffusionDryL = context.createGain();
      const diffusionDryR = context.createGain();
      const diffusionWetL = context.createGain();
      const diffusionWetR = context.createGain();
      const diffusionMergeL = context.createGain();
      const diffusionMergeR = context.createGain();
      diffusionL1.type = "allpass";
      diffusionL2.type = "allpass";
      diffusionR1.type = "allpass";
      diffusionR2.type = "allpass";
      diffusionL1.frequency.value = diffusionSettings.frequency;
      diffusionL2.frequency.value = diffusionSettings.frequency * 1.31;
      diffusionR1.frequency.value = diffusionSettings.frequency * 1.17;
      diffusionR2.frequency.value = diffusionSettings.frequency * 1.53;
      diffusionL1.Q.value = diffusionSettings.q;
      diffusionL2.Q.value = diffusionSettings.q;
      diffusionR1.Q.value = diffusionSettings.q;
      diffusionR2.Q.value = diffusionSettings.q;
      diffusionDryL.gain.value = diffusionSettings.dry;
      diffusionDryR.gain.value = diffusionSettings.dry;
      diffusionWetL.gain.value = diffusionSettings.wet;
      diffusionWetR.gain.value = diffusionSettings.wet;
      feedbackInputL.connect(diffusionDryL);
      feedbackInputR.connect(diffusionDryR);
      diffusionDryL.connect(diffusionMergeL);
      diffusionDryR.connect(diffusionMergeR);
      feedbackInputL.connect(diffusionL1);
      feedbackInputR.connect(diffusionR1);
      diffusionL1.connect(diffusionL2);
      diffusionR1.connect(diffusionR2);
      diffusionL2.connect(diffusionWetL);
      diffusionR2.connect(diffusionWetR);
      diffusionWetL.connect(diffusionMergeL);
      diffusionWetR.connect(diffusionMergeR);
      diffusionMergeL.connect(dampingL);
      diffusionMergeR.connect(dampingR);
    } else {
      feedbackInputL.connect(dampingL);
      feedbackInputR.connect(dampingR);
    }

    delayL.connect(feedbackL);
    delayR.connect(feedbackR);
    feedbackL.connect(toneL);
    feedbackR.connect(toneR);
    toneL.connect(airTrimL);
    toneR.connect(airTrimR);
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

    if (params.spectralMix > 1e-3) {
      const spectralInput = context.createGain();
      const spectralWet = context.createGain();
      spectralWet.gain.value = params.spectralMix;
      const spectralDryComp = context.createGain();
      spectralDryComp.gain.value = 1 - params.spectralMix;
      safetyOut.disconnect();
      safetyOut.connect(spectralDryComp);
      spectralDryComp.connect(wetDuckGain);
      safetyOut.connect(spectralInput);

      const spread = params.spectralSpread;
      const motion = params.spectralMotion;
      const lowTime = clamp(params.time * (1.3 + spread * 0.9), MIN_TIME, MAX_TIME);
      const midTime = clamp(params.time, MIN_TIME, MAX_TIME);
      const highTime = clamp(params.time * (0.7 - spread * 0.3), MIN_TIME, MAX_TIME);
      const lowFeedback = clamp(
        params.feedback * safetyFeedbackMultiplier * (0.95 + spread * 0.04),
        MIN_FEEDBACK,
        MAX_FEEDBACK
      );
      const midFeedback = clamp(
        params.feedback * safetyFeedbackMultiplier,
        MIN_FEEDBACK,
        MAX_FEEDBACK
      );
      const highFeedback = clamp(
        params.feedback * safetyFeedbackMultiplier * (0.85 - spread * 0.1),
        MIN_FEEDBACK,
        MAX_FEEDBACK
      );
      const panAmount = (0.08 + spread * 0.82) * (1 - motion * 0.5);
      const spectralLfo = context.createOscillator();
      spectralLfo.type = "sine";
      spectralLfo.frequency.value = 0.04 + motion * 0.45;
      spectralLfo.start();
      const panDrift = context.createGain();
      panDrift.gain.value = (0.1 + spread * 0.4) * motion;
      spectralLfo.connect(panDrift);

      const makeBand = (
        type: BiquadFilterType,
        frequency: number,
        q: number,
        delayTimeSec: number,
        feedback: number,
        pan: number,
        index: number
      ) => {
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const delay = context.createDelay(2.5);
        delay.delayTime.value = delayTimeSec;
        const fb = context.createGain();
        fb.gain.value = feedback;
        const tone = context.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = clamp(params.tone * (0.8 + (1 - Math.abs(pan)) * 0.2), MIN_TONE, MAX_TONE);
        const panner = context.createStereoPanner();
        panner.pan.value = pan;
        if (motion > 1e-3) {
          const panDepth = context.createGain();
          panDepth.gain.value = (0.04 + spread * 0.16) * motion * (index === 1 ? 0.4 : 1);
          spectralLfo.connect(panDepth);
          panDepth.connect(panner.pan);
          panDrift.connect(panner.pan);
          const delayDepth = context.createGain();
          delayDepth.gain.value = (0.0005 + spread * 0.002) * motion;
          spectralLfo.connect(delayDepth);
          delayDepth.connect(delay.delayTime);
        }
        spectralInput.connect(filter);
        filter.connect(delay);
        delay.connect(tone);
        tone.connect(panner);
        panner.connect(spectralWet);
        delay.connect(fb);
        fb.connect(delay);
      };

      makeBand("lowpass", 320, 0.7, lowTime, lowFeedback, -panAmount, 0);
      makeBand("bandpass", 1400, 0.8, midTime, midFeedback, 0, 1);
      makeBand("highpass", 3200, 0.7, highTime, highFeedback, panAmount, 2);
      spectralWet.connect(wetDuckGain);
    }

    return output;
  },
};
