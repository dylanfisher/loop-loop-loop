import type { EqMode, ParametricEqBand } from "../../types/deck";

export const PARAMETRIC_EQ_MAX_BANDS = 12;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN_DB = -18;
const MAX_GAIN_DB = 18;
const MIN_Q = 0.15;
const MAX_Q = 20;
const COMPENSATION_MIN_DB = -18;
const COMPENSATION_MAX_DB = 0;
const RESPONSE_SAMPLE_COUNT = 96;
const RESPONSE_MIN_FREQ = 24;
const RESPONSE_MAX_FREQ = 18000;
const FIT_REGULARIZATION = 0.08;

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

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
};

const buildBiquadCoefficients = (
  band: ParametricEqBand,
  sampleRate: number
): BiquadCoefficients => {
  const safeSampleRate = Math.max(1, sampleRate);
  const w0 = (2 * Math.PI * clamp(band.frequency, MIN_FREQ, MAX_FREQ)) / safeSampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const q = clamp(band.q, MIN_Q, MAX_Q);
  const alpha = sinW0 / (2 * q);
  const gain = clamp(band.gain, MIN_GAIN_DB, MAX_GAIN_DB);
  const A = Math.pow(10, gain / 40);

  if (band.type === "lowshelf") {
    const sqrtA = Math.sqrt(A);
    const twoSqrtAAlpha = 2 * sqrtA * alpha;
    return {
      b0: A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha),
      b1: 2 * A * ((A - 1) - (A + 1) * cosW0),
      b2: A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha),
      a0: (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha,
      a1: -2 * ((A - 1) + (A + 1) * cosW0),
      a2: (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha,
    };
  }

  if (band.type === "highshelf") {
    const sqrtA = Math.sqrt(A);
    const twoSqrtAAlpha = 2 * sqrtA * alpha;
    return {
      b0: A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha),
      b1: -2 * A * ((A - 1) + (A + 1) * cosW0),
      b2: A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha),
      a0: (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha,
      a1: 2 * ((A - 1) - (A + 1) * cosW0),
      a2: (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha,
    };
  }

  return {
    b0: 1 + alpha * A,
    b1: -2 * cosW0,
    b2: 1 - alpha * A,
    a0: 1 + alpha / A,
    a1: -2 * cosW0,
    a2: 1 - alpha / A,
  };
};

const magnitudeForFrequency = (coeffs: BiquadCoefficients, normalizedFrequency: number) => {
  const omega = 2 * Math.PI * normalizedFrequency;
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);
  const numRe = coeffs.b0 + coeffs.b1 * cos1 + coeffs.b2 * cos2;
  const numIm = -(coeffs.b1 * sin1 + coeffs.b2 * sin2);
  const denRe = coeffs.a0 + coeffs.a1 * cos1 + coeffs.a2 * cos2;
  const denIm = -(coeffs.a1 * sin1 + coeffs.a2 * sin2);
  const numerator = Math.hypot(numRe, numIm);
  const denominator = Math.max(1e-12, Math.hypot(denRe, denIm));
  return numerator / denominator;
};

const responseDbForBandAtFrequency = (
  band: ParametricEqBand,
  frequency: number,
  sampleRate: number,
  gainOverride?: number
) => {
  const coeffs = buildBiquadCoefficients(
    gainOverride === undefined ? band : { ...band, gain: gainOverride },
    sampleRate
  );
  const normalizedFrequency = frequency / Math.max(1, sampleRate);
  const magnitude = magnitudeForFrequency(coeffs, normalizedFrequency);
  return 20 * Math.log10(Math.max(magnitude, 1e-6));
};

const solveLinearSystem = (matrix: number[][], rhs: number[]) => {
  const n = rhs.length;
  if (n === 0) return [];
  const a = matrix.map((row) => [...row]);
  const b = [...rhs];

  for (let i = 0; i < n; i += 1) {
    let pivotRow = i;
    let pivotValue = Math.abs(a[i][i] ?? 0);
    for (let row = i + 1; row < n; row += 1) {
      const value = Math.abs(a[row][i] ?? 0);
      if (value > pivotValue) {
        pivotRow = row;
        pivotValue = value;
      }
    }
    if (pivotRow !== i) {
      [a[i], a[pivotRow]] = [a[pivotRow], a[i]];
      [b[i], b[pivotRow]] = [b[pivotRow], b[i]];
    }
    const pivot = a[i][i];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-8) {
      return [...rhs];
    }
    for (let row = i + 1; row < n; row += 1) {
      const factor = (a[row][i] ?? 0) / pivot;
      if (!Number.isFinite(factor) || Math.abs(factor) < 1e-12) continue;
      for (let col = i; col < n; col += 1) {
        a[row][col] -= factor * (a[i][col] ?? 0);
      }
      b[row] -= factor * b[i];
    }
  }

  const result = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row];
    for (let col = row + 1; col < n; col += 1) {
      sum -= (a[row][col] ?? 0) * result[col];
    }
    const pivot = a[row][row];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-8) {
      return [...rhs];
    }
    result[row] = sum / pivot;
  }
  return result;
};

export const fitParametricEqBandsToCurve = (
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined | null,
  sampleRate: number
) => {
  const normalized = normalizeParametricEqBands(bands);
  if (eqMode !== "parametric") return normalized;
  const adjustable = normalized
    .map((band, index) => ({ band, index }))
    .filter((entry) => entry.band.enabled);
  if (adjustable.length === 0) return normalized;

  const n = adjustable.length;
  const target = new Array<number>(n);
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    const targetBand = adjustable[i].band;
    target[i] = targetBand.gain;
    const frequency = clamp(targetBand.frequency, MIN_FREQ, MAX_FREQ);
    for (let j = 0; j < n; j += 1) {
      const sourceBand = adjustable[j].band;
      matrix[i][j] = responseDbForBandAtFrequency(sourceBand, frequency, sampleRate, 1);
      if (i === j) {
        matrix[i][j] += FIT_REGULARIZATION;
      }
    }
  }
  const solved = solveLinearSystem(matrix, target).map((gain) =>
    clamp(gain, MIN_GAIN_DB, MAX_GAIN_DB)
  );

  const nextBands = normalized.map((band) => ({ ...band }));
  for (let i = 0; i < n; i += 1) {
    nextBands[adjustable[i].index].gain = solved[i];
  }
  return nextBands;
};

const responseDbForBandsAtFrequency = (
  bands: ParametricEqBand[],
  frequency: number,
  sampleRate: number
) => {
  if (bands.length === 0) return 0;
  let magnitude = 1;
  for (const band of bands) {
    const coeffs = buildBiquadCoefficients(band, sampleRate);
    const normalizedFrequency = frequency / Math.max(1, sampleRate);
    magnitude *= magnitudeForFrequency(coeffs, normalizedFrequency);
  }
  return 20 * Math.log10(Math.max(magnitude, 1e-6));
};

export const evaluateParametricEqResponseDb = (
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined | null,
  frequency: number,
  sampleRate: number
) => {
  if (!hasActiveParametricEq(eqMode, bands)) return 0;
  const normalized = normalizeParametricEqBands(bands).filter((band) => band.enabled);
  return responseDbForBandsAtFrequency(
    normalized,
    clamp(frequency, MIN_FREQ, MAX_FREQ),
    sampleRate
  );
};

export const computeParametricEqCompensationGain = (
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined | null,
  sampleRate: number
) => {
  if (!hasActiveParametricEq(eqMode, bands)) return 1;
  const activeBands = fitParametricEqBandsToCurve(eqMode, bands, sampleRate).filter(
    (band) => band.enabled && Math.abs(band.gain) > 1e-4
  );
  if (activeBands.length === 0) return 1;
  let peakDb = -Infinity;
  for (let i = 0; i < RESPONSE_SAMPLE_COUNT; i += 1) {
    const t = i / (RESPONSE_SAMPLE_COUNT - 1);
    const freq =
      RESPONSE_MIN_FREQ *
      Math.pow(RESPONSE_MAX_FREQ / RESPONSE_MIN_FREQ, t);
    peakDb = Math.max(peakDb, responseDbForBandsAtFrequency(activeBands, freq, sampleRate));
  }
  const targetPeakDb = activeBands.reduce(
    (maxDb, band) => Math.max(maxDb, Math.max(0, band.gain)),
    0
  );
  const excessPeakDb = Math.max(0, peakDb - targetPeakDb);
  const compensationDb = clamp(-excessPeakDb, COMPENSATION_MIN_DB, COMPENSATION_MAX_DB);
  return Math.pow(10, compensationDb / 20);
};

export const applyParametricEqOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined | null,
  renderDuration: number
) => {
  if (!hasActiveParametricEq(eqMode, bands)) return input;
  const fitted = fitParametricEqBandsToCurve(eqMode, bands, context.sampleRate);
  const filters = fitted.map((band) => {
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
  const outputGain = context.createGain();
  outputGain.gain.setValueAtTime(
    computeParametricEqCompensationGain(eqMode, fitted, context.sampleRate),
    0
  );
  filters[filters.length - 1].connect(outputGain);
  return outputGain;
};
