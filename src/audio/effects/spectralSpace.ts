import type { OfflineEffectPlugin } from "./plugin";
import { createAbsCurve, createThresholdCurve } from "./delay";

export type SpectralSpaceParams = {
  mix: number;
  spread: number;
  motion: number;
  tilt: number;
  lowMono: number;
  transientProtect: number;
};

export const SPECTRAL_SPACE_DEFAULTS: SpectralSpaceParams = {
  mix: 0,
  spread: 0.35,
  motion: 0.25,
  tilt: 0,
  lowMono: 0.6,
  transientProtect: 0.35,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const shapeCharacter = (value: number) =>
  clamp(value + value * value * 0.65 + value * value * value * 0.2, 0, 1);

export const normalizeSpectralSpaceParams = (
  params: Partial<SpectralSpaceParams> | undefined
): SpectralSpaceParams => ({
  mix: clamp(params?.mix ?? SPECTRAL_SPACE_DEFAULTS.mix, 0, 1),
  spread: clamp(params?.spread ?? SPECTRAL_SPACE_DEFAULTS.spread, 0, 1),
  motion: clamp(params?.motion ?? SPECTRAL_SPACE_DEFAULTS.motion, 0, 1),
  tilt: clamp(params?.tilt ?? SPECTRAL_SPACE_DEFAULTS.tilt, -1, 1),
  lowMono: clamp(params?.lowMono ?? SPECTRAL_SPACE_DEFAULTS.lowMono, 0, 1),
  transientProtect: clamp(
    params?.transientProtect ?? SPECTRAL_SPACE_DEFAULTS.transientProtect,
    0,
    1
  ),
});

export const spectralSpacePlugin: OfflineEffectPlugin<SpectralSpaceParams> = {
  id: "spectralSpace",
  applyOffline: (context, input, rawParams) => {
    const params = normalizeSpectralSpaceParams(rawParams);
    if (params.mix <= 1e-3) return input;

    const output = context.createGain();
    const dry = context.createGain();
    const wetInput = context.createGain();
    const wetEnergy = context.createGain();
    const wet = context.createGain();
    dry.gain.value = 1 - params.mix;
    wet.gain.value = params.mix;
    input.connect(dry);
    dry.connect(output);
    input.connect(wetInput);

    const spread = params.spread;
    const tilt = params.tilt;
    const motion = params.motion;
    const lowMono = params.lowMono;
    const spreadHot = shapeCharacter(spread);
    const motionHot = shapeCharacter(motion);
    wetEnergy.gain.value =
      1 + params.mix * 0.2 + spreadHot * 0.25 + motionHot * 0.24;
    const panBase = (0.16 + spreadHot * 0.92) * (1 - lowMono * 0.88);

    const bandDefs = [
      {
        type: "lowpass" as BiquadFilterType,
        frequency: 300,
        q: 0.7,
        delayMs: 12 + spreadHot * 40,
        pan: -panBase,
        gain: 1.08 - tilt * 0.44,
      },
      {
        type: "bandpass" as BiquadFilterType,
        frequency: 1450,
        q: 0.9,
        delayMs: 8 + spreadHot * 26,
        pan: 0,
        gain: 1.08,
      },
      {
        type: "highpass" as BiquadFilterType,
        frequency: 3200,
        q: 0.7,
        delayMs: 4 + spreadHot * 16,
        pan: panBase,
        gain: 1.08 + tilt * 0.6,
      },
    ];

    const wetSum = context.createGain();
    for (let i = 0; i < bandDefs.length; i += 1) {
      const def = bandDefs[i];
      const filter = context.createBiquadFilter();
      filter.type = def.type;
      filter.frequency.value = def.frequency;
      filter.Q.value = def.q;
      const delay = context.createDelay(0.08);
      delay.delayTime.value = def.delayMs / 1000;
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = clamp(11200 - spreadHot * 7000 + i * 600, 900, 12000);
      const gain = context.createGain();
      gain.gain.value = clamp(def.gain, 0.35, 2);
      const panner = context.createStereoPanner();
      panner.pan.value = def.pan;

      if (motionHot > 1e-3) {
        const lfo = context.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 0.08 + motionHot * 1.3 + i * 0.06;
        const panDepth = context.createGain();
        panDepth.gain.value = (0.1 + spreadHot * 0.32) * motionHot * (i === 1 ? 0.4 : 1);
        lfo.connect(panDepth);
        panDepth.connect(panner.pan);
        const delayDepth = context.createGain();
        delayDepth.gain.value = (0.0012 + spreadHot * 0.0042) * motionHot;
        lfo.connect(delayDepth);
        delayDepth.connect(delay.delayTime);
        lfo.start(0);
      }

      wetInput.connect(filter);
      filter.connect(delay);
      delay.connect(tone);
      tone.connect(gain);
      gain.connect(panner);
      panner.connect(wetSum);
    }

    if (params.transientProtect > 1e-3) {
      const duckGain = context.createGain();
      duckGain.gain.value = 1;
      const rectifier = context.createWaveShaper();
      rectifier.curve = createAbsCurve();
      const follower = context.createBiquadFilter();
      follower.type = "lowpass";
      follower.frequency.value = 8 + params.transientProtect * 60;
      const threshold = context.createWaveShaper();
      threshold.curve = createThresholdCurve(0.06 + (1 - params.transientProtect) * 0.22);
      const depth = context.createGain();
      depth.gain.value = -(0.2 + params.transientProtect * 0.7);
      input.connect(rectifier);
      rectifier.connect(follower);
      follower.connect(threshold);
      threshold.connect(depth);
      depth.connect(duckGain.gain);
      wetSum.connect(duckGain);
      duckGain.connect(wet);
      wet.connect(wetEnergy);
    } else {
      wetSum.connect(wet);
      wet.connect(wetEnergy);
    }

    wetEnergy.connect(output);
    return output;
  },
};
