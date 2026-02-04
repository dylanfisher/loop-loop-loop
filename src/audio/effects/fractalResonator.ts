import type { OfflineEffectPlugin } from "./plugin";

export type FractalParams = {
  mix: number;
  structure: number;
  depth: number;
  drift: number;
  decay: number;
  tone: number;
};

export type FractalLiveNodes = {
  dry: GainNode;
  wet: GainNode;
  feedback: GainNode;
  feedbackDelay: DelayNode;
  tone: BiquadFilterNode;
  drive: WaveShaperNode;
  body: GainNode;
  modeFilters: BiquadFilterNode[];
  modeGains: GainNode[];
  seeds: number[];
};

export const FRACTAL_DEFAULTS: FractalParams = {
  mix: 0,
  structure: 0.45,
  depth: 0.35,
  drift: 0.15,
  decay: 0.2,
  tone: 6000,
};

const MIN_TONE = 300;
const MAX_TONE = 14000;
const MAX_DECAY = 0.985;
const MIX_BYPASS_EPSILON = 1e-4;
const MODE_COUNT = 16;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const createDriveCurve = (amount: number) => {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = Math.max(1, amount);
  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
};

export const fractalSeedForIndex = (index: number) => {
  const seed = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return ((seed - Math.floor(seed)) * 2) - 1;
};

export const normalizeFractalParams = (
  params: Partial<FractalParams> | undefined
): FractalParams => ({
  mix: clamp(params?.mix ?? FRACTAL_DEFAULTS.mix, 0, 1),
  structure: clamp(params?.structure ?? FRACTAL_DEFAULTS.structure, 0, 1),
  depth: clamp(params?.depth ?? FRACTAL_DEFAULTS.depth, 0, 1),
  drift: clamp(params?.drift ?? FRACTAL_DEFAULTS.drift, 0, 1),
  decay: clamp(params?.decay ?? FRACTAL_DEFAULTS.decay, 0, MAX_DECAY),
  tone: clamp(params?.tone ?? FRACTAL_DEFAULTS.tone, MIN_TONE, MAX_TONE),
});

const applyFractalCore = (
  params: FractalParams,
  modeFilters: BiquadFilterNode[],
  modeGains: GainNode[],
  seeds: number[],
  destination: {
    dry: GainNode;
    wet: GainNode;
    feedback: GainNode;
    feedbackDelay: DelayNode;
    tone: BiquadFilterNode;
    drive: WaveShaperNode;
    body: GainNode;
  }
) => {
  destination.dry.gain.value = 1 - params.mix;
  destination.wet.gain.value = params.mix * (0.75 + params.depth * 0.85);
  destination.feedback.gain.value = 0.08 + params.decay * 0.55;
  destination.feedbackDelay.delayTime.value = 0.012 + params.structure * 0.08;
  destination.tone.frequency.value = params.tone;
  destination.body.gain.value = 0.015 + (1 - params.depth) * 0.03;
  destination.drive.curve = createDriveCurve(3 + params.depth * 11);

  const minFreq = 70;
  const maxFreq = Math.min(12000, params.tone);
  const spreadPower = 0.25 + params.structure * 3.4;
  const baseQ = 12 + params.depth * 60;
  const normalization = 3 / Math.max(1, modeFilters.length);

  for (let i = 0; i < modeFilters.length; i += 1) {
    const t = modeFilters.length <= 1 ? 0 : i / (modeFilters.length - 1);
    const curve = Math.pow(t, spreadPower);
    const base = minFreq * Math.pow(maxFreq / minFreq, curve);
    const cents = (seeds[i] ?? 0) * params.drift * 1200;
    const freq = Math.min(12000, Math.max(80, base * Math.pow(2, cents / 1200)));
    modeFilters[i].frequency.value = freq;
    modeFilters[i].Q.value = baseQ + (1 - t) * 14;
    modeGains[i].gain.value = normalization * (0.6 + params.depth * (2.2 - t * 0.35));
  }
};

export const applyFractalLiveParams = (
  nodes: FractalLiveNodes,
  rawParams: Partial<FractalParams> | undefined
) => {
  const params = normalizeFractalParams(rawParams);
  applyFractalCore(params, nodes.modeFilters, nodes.modeGains, nodes.seeds, {
    dry: nodes.dry,
    wet: nodes.wet,
    feedback: nodes.feedback,
    feedbackDelay: nodes.feedbackDelay,
    tone: nodes.tone,
    drive: nodes.drive,
    body: nodes.body,
  });
  return params;
};

export const fractalPlugin: OfflineEffectPlugin<FractalParams> = {
  id: "fractal",
  applyOffline: (context, input, rawParams) => {
    const params = normalizeFractalParams(rawParams);
    if (params.mix <= MIX_BYPASS_EPSILON) {
      return input;
    }

    const output = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const fractalInput = context.createGain();
    const feedback = context.createGain();
    const feedbackDelay = context.createDelay(1);
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    const drive = context.createWaveShaper();
    drive.oversample = "4x";
    const body = context.createGain();
    const modeFilters = Array.from({ length: MODE_COUNT }, () => {
      const node = context.createBiquadFilter();
      node.type = "bandpass";
      return node;
    });
    const modeGains = Array.from({ length: MODE_COUNT }, () => context.createGain());
    const seeds = Array.from({ length: MODE_COUNT }, (_, i) => fractalSeedForIndex(i));

    input.connect(dry);
    dry.connect(output);
    input.connect(fractalInput);
    modeFilters.forEach((filter, index) => {
      fractalInput.connect(filter);
      filter.connect(modeGains[index]);
      modeGains[index].connect(tone);
    });
    fractalInput.connect(body);
    body.connect(tone);
    tone.connect(drive);
    drive.connect(wet);
    wet.connect(output);
    wet.connect(feedback);
    feedback.connect(feedbackDelay);
    feedbackDelay.connect(fractalInput);

    applyFractalCore(params, modeFilters, modeGains, seeds, {
      dry,
      wet,
      feedback,
      feedbackDelay,
      tone,
      drive,
      body,
    });
    return output;
  },
};
