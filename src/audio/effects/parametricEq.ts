import type { EqMode, ParametricEqBand } from "../../types/deck";

export const PARAMETRIC_EQ_MAX_BANDS = 12;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN_DB = -18;
const MAX_GAIN_DB = 18;
const MIN_Q = 0.15;
const MAX_Q = 20;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const isNeutralBand = (band: ParametricEqBand) =>
  !band.enabled || Math.abs(band.gain) <= 1e-4;

export const defaultParametricEqBands = (): ParametricEqBand[] => [
  {
    id: "peq-low",
    type: "lowshelf",
    frequency: 120,
    gain: 0,
    q: 0.8,
    enabled: true,
  },
  {
    id: "peq-mid",
    type: "peaking",
    frequency: 1200,
    gain: 0,
    q: 1.2,
    enabled: true,
  },
  {
    id: "peq-high",
    type: "highshelf",
    frequency: 8000,
    gain: 0,
    q: 0.8,
    enabled: true,
  },
];

export const normalizeParametricEqBand = (
  band: Partial<ParametricEqBand>,
  fallbackId: string
): ParametricEqBand => {
  const frequency = clamp(
    Number.isFinite(band.frequency) ? band.frequency! : 1200,
    MIN_FREQ,
    MAX_FREQ
  );
  const gain = clamp(Number.isFinite(band.gain) ? band.gain! : 0, MIN_GAIN_DB, MAX_GAIN_DB);
  const normalized: ParametricEqBand = {
    id: band.id || fallbackId,
    type:
      band.type === "lowshelf" || band.type === "highshelf" || band.type === "peaking"
        ? band.type
        : "peaking",
    frequency,
    gain,
    q: clamp(Number.isFinite(band.q) ? band.q! : 1, MIN_Q, MAX_Q),
    enabled: band.enabled ?? true,
  };
  const wander = band.wander;
  if (wander) {
    normalized.wander = {
      jitter: clamp(
        Number.isFinite(wander.jitter) ? Number(wander.jitter) : 0,
        0,
        1
      ),
      spread: clamp(
        Number.isFinite(wander.spread) ? Number(wander.spread) : 0,
        0,
        1
      ),
      seed: Number.isFinite(wander.seed) ? Number(wander.seed) : Math.random() * Math.PI * 2,
      baseFrequency: clamp(
        Number.isFinite(wander.baseFrequency)
          ? Number(wander.baseFrequency)
          : frequency,
        MIN_FREQ,
        MAX_FREQ
      ),
      baseGain: clamp(
        Number.isFinite(wander.baseGain) ? Number(wander.baseGain) : gain,
        MIN_GAIN_DB,
        MAX_GAIN_DB
      ),
    };
  }
  return normalized;
};

export const normalizeParametricEqBands = (bands: ParametricEqBand[] | undefined | null) => {
  if (!bands || bands.length === 0) return defaultParametricEqBands();
  return bands
    .slice(0, PARAMETRIC_EQ_MAX_BANDS)
    .map((band, index) => normalizeParametricEqBand(band, `peq-${index + 1}`));
};

export const hasActiveParametricEq = (
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined | null
) => {
  if (eqMode !== "parametric") return false;
  const normalized = normalizeParametricEqBands(bands);
  return normalized.some((band) => !isNeutralBand(band));
};

export const applyParametricEqOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined | null,
  renderDuration: number
) => {
  if (!hasActiveParametricEq(eqMode, bands)) return input;
  const normalized = normalizeParametricEqBands(bands);
  const filters = normalized.map((band) => {
    const node = context.createBiquadFilter();
    node.type = band.type;
    node.frequency.setValueAtTime(band.frequency, 0);
    node.gain.setValueAtTime(band.enabled ? band.gain : 0, 0);
    node.Q.setValueAtTime(band.q, 0);
    const wander = band.wander;
    const wanderActive =
      Boolean(wander) &&
      (wander?.jitter ?? 0) > 1e-3 &&
      (wander?.spread ?? 0) > 1e-3 &&
      band.enabled &&
      renderDuration > 0;
    if (wanderActive && wander) {
      const sampleRate = 30;
      const sampleCount = Math.max(2, Math.ceil(renderDuration * sampleRate));
      const freqCurve = new Float32Array(sampleCount);
      const gainCurve = new Float32Array(sampleCount);
      const speedHz = 0.08 + wander.jitter * 1.7;
      const octaveSpan = 0.08 + wander.spread * 1.1;
      const gainSpan = 0.5 + wander.spread * 10;
      for (let i = 0; i < sampleCount; i += 1) {
        const t = i / sampleRate;
        const phaseA = t * Math.PI * 2 * speedHz + wander.seed;
        const phaseB = t * Math.PI * 2 * (speedHz * 1.37) + wander.seed * 1.91;
        const phaseC = t * Math.PI * 2 * (speedHz * 0.61) + wander.seed * 2.71;
        const phaseD = t * Math.PI * 2 * (speedHz * 1.11) + wander.seed * 1.13;
        const freqNoise = Math.sin(phaseA) * 0.62 + Math.sin(phaseB) * 0.38;
        const gainNoise = Math.sin(phaseC) * 0.58 + Math.sin(phaseD) * 0.42;
        freqCurve[i] = clamp(
          wander.baseFrequency * Math.pow(2, freqNoise * octaveSpan),
          MIN_FREQ,
          MAX_FREQ
        );
        gainCurve[i] = clamp(wander.baseGain + gainNoise * gainSpan, MIN_GAIN_DB, MAX_GAIN_DB);
      }
      node.frequency.setValueCurveAtTime(freqCurve, 0, renderDuration);
      node.gain.setValueCurveAtTime(gainCurve, 0, renderDuration);
      node.Q.setValueAtTime(band.q, renderDuration);
    } else if (renderDuration > 0) {
      node.frequency.setValueAtTime(band.frequency, renderDuration);
      node.gain.setValueAtTime(band.enabled ? band.gain : 0, renderDuration);
      node.Q.setValueAtTime(band.q, renderDuration);
    }
    return node;
  });
  if (filters.length === 0) return input;
  input.connect(filters[0]);
  for (let i = 0; i < filters.length - 1; i += 1) {
    filters[i].connect(filters[i + 1]);
  }
  return filters[filters.length - 1];
};
