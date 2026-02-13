import type {
  DeckSimpleAutomation,
  DeckFxPanelState,
  DeckState,
  EqMode,
  ParametricEqBand,
  ParametricEqMotionState,
  SimpleAutomationParam,
  SimpleAutomationState,
} from "../types/deck";
import { defaultParametricEqBands } from "../audio/effects/parametricEq";
import { MAX_REARRANGER_SLICES } from "../utils/rearranger";

export const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const AUTOMATION_SAMPLE_RATE = 30;
export const MIN_AUTOMATION_DURATION = 0.25;
export const AUTOMATION_UI_INTERVAL_MS = 100;
export const TEMPO_SNAP_STEP = 25;
export const TEMPO_SNAP_THRESHOLD = 1;
export const STRETCH_WINDOW_SIZES = [2048, 4096, 8192, 16384];
export const DEFAULT_STRETCH_RATIO = 2;
export const DEFAULT_STRETCH_WINDOW_SIZE = 16384;
export const DEFAULT_STRETCH_STEREO_WIDTH = 1;
export const DEFAULT_STRETCH_PHASE_RANDOMNESS = 0.5;
export const DEFAULT_STRETCH_TILT_DB = 0;
export const DEFAULT_STRETCH_SCATTER = 1;
export const DEFAULT_DELAY_TIME = 0.35;
export const DEFAULT_DELAY_FEEDBACK = 0.35;
export const DEFAULT_DELAY_MIX = 0;
export const DEFAULT_DELAY_TONE = 6000;
export const DEFAULT_DELAY_PINGPONG = false;
export const DEFAULT_DELAY_SLICE_SYNC = false;
export const DEFAULT_DELAY_SATURATION = 0;
export const DEFAULT_DELAY_DAMPING = 0;
export const DEFAULT_DELAY_SAFETY = 0;
export const DEFAULT_VOCODER_MIX = 0;
export const DEFAULT_VOCODER_CARRIER_DECK_ID: number | null = null;
export const DEFAULT_VOCODER_MODULATOR_MONITOR = 0;
export const DEFAULT_VOCODER_MOD_DRIVE = 2;
export const DEFAULT_VOCODER_BAND_COUNT = 12;
export const DEFAULT_VOCODER_BAND_SPREAD = 1;
export const DEFAULT_VOCODER_ATTACK_MS = 8;
export const DEFAULT_VOCODER_RELEASE_MS = 5;
export const DEFAULT_VOCODER_NOISE_MIX = 0;
export const DEFAULT_VOCODER_GATE_THRESHOLD = 0.5;
export const DEFAULT_REARRANGER_SLICES = 0;
export const DEFAULT_REARRANGER_SWAP_COUNT = 0;
export const DEFAULT_REARRANGER_CHAOS = 0;
export const DEFAULT_REARRANGER_REVERSE = 0;
export const DEFAULT_REARRANGER_SENSITIVITY = 0.6;
export const DEFAULT_REARRANGER_QUIET_THRESHOLD = 0.3;
export const DEFAULT_REARRANGER_SLICE_FADE_MS = 0;
export const DEFAULT_REARRANGER_SLICE_DELAY_SEC = 0;
export const DEFAULT_REARRANGER_PINGPONG = 0;
export const DEFAULT_REARRANGER_AUTO = false;
export const DEFAULT_RESONANCE = 0;
export const DEFAULT_EQ_MODE: EqMode = "eq3";
export const DEFAULT_PARAMETRIC_EQ_MOTION_CYCLE_SEC = 4;
export const DEFAULT_PARAMETRIC_EQ_MOTION_STATE: ParametricEqMotionState = {
  preset: null,
  cycleSec: DEFAULT_PARAMETRIC_EQ_MOTION_CYCLE_SEC,
  automationActive: false,
  targetBandId: null,
};
export const DEFAULT_SIMPLE_AUTOMATION_CYCLE_SEC = 4;
export const SIMPLE_AUTOMATION_PARAM_LIMITS: Record<
  SimpleAutomationParam,
  { min: number; max: number }
> = {
  delayTime: { min: 0.01, max: 1.5 },
  delayFeedback: { min: 0, max: 0.99 },
  delayMix: { min: 0, max: 1 },
  delayTone: { min: 400, max: 12000 },
  delaySaturation: { min: 0, max: 1 },
  delayDamping: { min: 0, max: 1 },
  delaySafety: { min: 0, max: 1 },
  vocoderMix: { min: 0, max: 1 },
  vocoderModulatorMonitor: { min: 0, max: 1 },
  vocoderModDrive: { min: 0.5, max: 10 },
  vocoderBandCount: { min: 4, max: 24 },
  vocoderBandSpread: { min: 0, max: 1 },
  vocoderAttackMs: { min: 1, max: 160 },
  vocoderReleaseMs: { min: 1, max: 1200 },
  vocoderNoiseMix: { min: 0, max: 1 },
  vocoderGateThreshold: { min: 0, max: 1 },
  rearrangerSwapCount: { min: 0, max: 64 },
  rearrangerChaos: { min: 0, max: 1 },
  rearrangerReverse: { min: 0, max: 1 },
  rearrangerSliceFadeMs: { min: 0, max: 12 },
  rearrangerSliceDelaySec: { min: 0, max: 5 },
  rearrangerPingPong: { min: 0, max: 1 },
};
export const EQ_MAX_DB = 18;
export const FX_ACTIVE_EPSILON = 1e-3;

const DEFAULT_FX_PANEL_OPEN: DeckFxPanelState = {
  gain: false,
  djFilter: false,
  resonance: false,
  eqLow: false,
  eqMid: false,
  eqHigh: false,
  parametricEq: false,
  balance: false,
  pitch: false,
  vocoder: false,
  delay: false,
  rearranger: false,
  stretch: false,
};

export const withDefaultFxPanelOpen = (
  state?: Partial<DeckFxPanelState> | null
): DeckFxPanelState => ({
  ...DEFAULT_FX_PANEL_OPEN,
  ...(state ?? {}),
});

export const cloneDefaultParametricEqBands = (): ParametricEqBand[] =>
  defaultParametricEqBands().map((band) => ({ ...band }));

export const normalizeParametricEqMotionState = (
  value?: Partial<ParametricEqMotionState> | null
): ParametricEqMotionState => ({
  preset: value?.preset === "sweep" ? "sweep" : null,
  cycleSec: clamp(
    Number.isFinite(value?.cycleSec) ? Number(value?.cycleSec) : DEFAULT_PARAMETRIC_EQ_MOTION_CYCLE_SEC,
    0.25,
    60
  ),
  automationActive:
    value?.preset === "sweep" ? value?.automationActive === true : false,
  targetBandId: typeof value?.targetBandId === "string" ? value.targetBandId : null,
});

const normalizeSimpleAutomationEntry = (
  param: SimpleAutomationParam,
  value: Partial<SimpleAutomationState> | undefined
): SimpleAutomationState => {
  const limits = SIMPLE_AUTOMATION_PARAM_LIMITS[param];
  const samples =
    Array.isArray(value?.samples)
      ? value.samples
          .filter((item) => Number.isFinite(item))
          .map((item) => clamp(Number(item), limits.min, limits.max))
      : undefined;
  const durationSec = Number.isFinite(value?.durationSec)
    ? clamp(Number(value?.durationSec), 0.05, 600)
    : undefined;
  const sampleRate = Number.isFinite(value?.sampleRate)
    ? clamp(Number(value?.sampleRate), 5, 240)
    : undefined;
  return {
    active: value?.active === true,
    baseline: clamp(
      Number.isFinite(value?.baseline) ? Number(value?.baseline) : limits.min,
      limits.min,
      limits.max
    ),
    target: clamp(
      Number.isFinite(value?.target) ? Number(value?.target) : limits.max,
      limits.min,
      limits.max
    ),
    cycleSec: clamp(
      Number.isFinite(value?.cycleSec) ? Number(value?.cycleSec) : DEFAULT_SIMPLE_AUTOMATION_CYCLE_SEC,
      0.25,
      60
    ),
    samples: samples && samples.length > 1 ? samples : undefined,
    sampleRate: samples && samples.length > 1 ? sampleRate : undefined,
    durationSec: samples && samples.length > 1 ? durationSec : undefined,
  };
};

export const normalizeSimpleAutomation = (
  value?: DeckSimpleAutomation | null
): DeckSimpleAutomation => {
  const normalized: DeckSimpleAutomation = {};
  (Object.keys(SIMPLE_AUTOMATION_PARAM_LIMITS) as SimpleAutomationParam[]).forEach((param) => {
    const entry = value?.[param];
    if (!entry) return;
    const resolved = normalizeSimpleAutomationEntry(param, entry);
    if (!resolved.active) return;
    normalized[param] = resolved;
  });
  return normalized;
};

export const approxEqual = (a: number, b: number, epsilon = FX_ACTIVE_EPSILON) =>
  Math.abs(a - b) <= epsilon;

export const regionsEqual = (
  a: number[] | undefined,
  b: number[] | undefined,
  epsilon = 1e-6
) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > epsilon) return false;
  }
  return true;
};

export const sanitizeRearrangerRegions = (regions: number[] | null | undefined) => {
  if (!regions || regions.length === 0) return undefined;
  const points = regions
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(1, value)))
    .sort((a, b) => a - b);
  if (points.length === 0) return undefined;
  if (points[0] > 0) points.unshift(0);
  if (points[points.length - 1] < 1) points.push(1);
  if (points.length < 3) return undefined;
  if (points.length > MAX_REARRANGER_SLICES + 1) {
    return [0, ...points.slice(1, MAX_REARRANGER_SLICES), 1];
  }
  return points;
};

export const appendRearrangerBoundary = (regions: number[]) => {
  if (regions.length < 2) return regions;
  const prev = regions[regions.length - 2] ?? 0;
  const next = regions[regions.length - 1] ?? 1;
  const inserted = prev + (next - prev) * 0.5;
  const copy = [...regions];
  copy.splice(copy.length - 1, 0, inserted);
  return copy;
};

export type AutomationTrack = {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  recording: boolean;
  active: boolean;
  paused: boolean;
  pausedPositionSec: number;
  currentValue: number;
  amplitudeScale: number;
  lastIndex: number;
  lastPreviewLength: number;
  recordBuffer: number[];
  recordStartMs: number;
  lastSampleMs: number;
  playbackStartMs: number;
};

export type AutomationDeck = {
  gain: AutomationTrack;
  djFilter: AutomationTrack;
  resonance: AutomationTrack;
  eqLow: AutomationTrack;
  eqMid: AutomationTrack;
  eqHigh: AutomationTrack;
  balance: AutomationTrack;
  pitch: AutomationTrack;
};

export type AutomationView = {
  samples: Float32Array;
  previewSamples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  currentValue: number;
  amplitudeScale: number;
};

export const toAutomationView = (track: AutomationTrack): AutomationView => ({
  samples: track.samples,
  previewSamples: track.recording ? new Float32Array(track.recordBuffer) : new Float32Array(0),
  durationSec: track.durationSec,
  recording: track.recording,
  active: track.active,
  currentValue: track.currentValue,
  amplitudeScale: track.amplitudeScale,
});

export const createTrack = (initialValue: number): AutomationTrack => ({
  samples: new Float32Array(0),
  sampleRate: AUTOMATION_SAMPLE_RATE,
  durationSec: 0,
  recording: false,
  active: false,
  paused: false,
  pausedPositionSec: 0,
  currentValue: initialValue,
  amplitudeScale: 1,
  lastIndex: -1,
  lastPreviewLength: 0,
  recordBuffer: [],
  recordStartMs: 0,
  lastSampleMs: 0,
  playbackStartMs: 0,
});

export const buildInitialDecks = (): DeckState[] => [
  {
    id: 1,
    status: "idle",
    gain: 0.9,
    djFilter: 0,
    filterResonance: 0,
    eqLowGain: 0,
    eqMidGain: 0,
    eqHighGain: 0,
    eqMode: DEFAULT_EQ_MODE,
    parametricEqBands: cloneDefaultParametricEqBands(),
    parametricEqMotion: { ...DEFAULT_PARAMETRIC_EQ_MOTION_STATE },
    balance: 0,
    pitchShift: 0,
    vocoderMix: DEFAULT_VOCODER_MIX,
    vocoderCarrierDeckId: DEFAULT_VOCODER_CARRIER_DECK_ID,
    vocoderModulatorMonitor: DEFAULT_VOCODER_MODULATOR_MONITOR,
    vocoderModDrive: DEFAULT_VOCODER_MOD_DRIVE,
    vocoderBandCount: DEFAULT_VOCODER_BAND_COUNT,
    vocoderBandSpread: DEFAULT_VOCODER_BAND_SPREAD,
    vocoderAttackMs: DEFAULT_VOCODER_ATTACK_MS,
    vocoderReleaseMs: DEFAULT_VOCODER_RELEASE_MS,
    vocoderNoiseMix: DEFAULT_VOCODER_NOISE_MIX,
    vocoderGateThreshold: DEFAULT_VOCODER_GATE_THRESHOLD,
    simpleAutomation: {},
    deckWidthOverride: undefined,
    offsetSeconds: 0,
    zoom: 1,
    loopEnabled: true,
    loopStartSeconds: 0,
    loopEndSeconds: 0,
    tempoOffset: 0,
    tempoPitchSync: false,
    stretchRatio: DEFAULT_STRETCH_RATIO,
    stretchWindowSize: DEFAULT_STRETCH_WINDOW_SIZE,
    stretchStereoWidth: DEFAULT_STRETCH_STEREO_WIDTH,
    stretchPhaseRandomness: DEFAULT_STRETCH_PHASE_RANDOMNESS,
    stretchTiltDb: DEFAULT_STRETCH_TILT_DB,
    stretchScatter: DEFAULT_STRETCH_SCATTER,
    delayTime: DEFAULT_DELAY_TIME,
    delayFeedback: DEFAULT_DELAY_FEEDBACK,
    delayMix: DEFAULT_DELAY_MIX,
    delayTone: DEFAULT_DELAY_TONE,
    delayPingPong: DEFAULT_DELAY_PINGPONG,
    delaySliceSync: DEFAULT_DELAY_SLICE_SYNC,
    delaySaturation: DEFAULT_DELAY_SATURATION,
    delayDamping: DEFAULT_DELAY_DAMPING,
    delaySafety: DEFAULT_DELAY_SAFETY,
    rearrangerSlices: DEFAULT_REARRANGER_SLICES,
    rearrangerSwapCount: DEFAULT_REARRANGER_SWAP_COUNT,
    rearrangerChaos: DEFAULT_REARRANGER_CHAOS,
    rearrangerReverse: DEFAULT_REARRANGER_REVERSE,
    rearrangerSensitivity: DEFAULT_REARRANGER_SENSITIVITY,
    rearrangerQuietThreshold: DEFAULT_REARRANGER_QUIET_THRESHOLD,
    rearrangerSliceFadeMs: DEFAULT_REARRANGER_SLICE_FADE_MS,
    rearrangerSliceDelaySec: DEFAULT_REARRANGER_SLICE_DELAY_SEC,
    rearrangerPingPong: DEFAULT_REARRANGER_PINGPONG,
    rearrangerAuto: DEFAULT_REARRANGER_AUTO,
    rearrangerRegionsManual: false,
    fxPanelOpen: withDefaultFxPanelOpen(),
  },
];
