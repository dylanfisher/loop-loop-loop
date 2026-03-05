import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ParametricEqBand,
  ParametricEqBandType,
  ParametricEqBandWander,
  SimpleAutomationParam,
} from "../types/deck";
import {
  PARAMETRIC_EQ_MAX_BANDS,
  defaultParametricEqBands,
  normalizeParametricEqBands,
} from "../audio/effects/parametricEq";
import Knob from "./Knob";
import type { MidiActionId } from "../types/midi";

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN = -18;
const MAX_GAIN = 18;
const MIN_Q = 0.15;
const MAX_Q = 20;
const MAX_BANDS = PARAMETRIC_EQ_MAX_BANDS;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 320;
const JITTER_DEBOUNCE_MS = 90;
const SPREAD_DEBOUNCE_MS = 90;
const RESPONSE_POINTS = 240;
const NODE_AUTOMATION_SAMPLE_RATE = 30;
const GRAPH_LEFT_PAD = 28;
const GRAPH_RIGHT_PAD = 12;
const GRAPH_TOP_PAD = 10;
const GRAPH_BOTTOM_PAD = 20;

type ParametricEqEditorProps = {
  bands: ParametricEqBand[];
  playbackActive?: boolean;
  disabled?: boolean;
  outputGain?: number;
  isSimpleAutomated?: (param: SimpleAutomationParam) => boolean;
  onSimpleAutomationSet?: (
    param: SimpleAutomationParam,
    target: number,
    baseline: number,
    recording?: { samples: number[]; sampleRate: number; durationSec: number }
  ) => void;
  onSimpleAutomationClear?: (param: SimpleAutomationParam) => void;
  onOutputGainChange?: (next: number) => void;
  onResetAll?: () => void;
  onChange: (bands: ParametricEqBand[]) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const freqToX = (freq: number, width: number) => {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const clampedFreq = clamp(freq, MIN_FREQ, MAX_FREQ);
  const innerWidth = Math.max(1, width - GRAPH_LEFT_PAD - GRAPH_RIGHT_PAD);
  return ((Math.log10(clampedFreq) - minLog) / (maxLog - minLog)) * innerWidth + GRAPH_LEFT_PAD;
};

const xToFreq = (x: number, width: number) => {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const innerWidth = Math.max(1, width - GRAPH_LEFT_PAD - GRAPH_RIGHT_PAD);
  const t = clamp((x - GRAPH_LEFT_PAD) / innerWidth, 0, 1);
  return Math.pow(10, minLog + t * (maxLog - minLog));
};

const gainToY = (gain: number) => {
  const t = (clamp(gain, MIN_GAIN, MAX_GAIN) - MIN_GAIN) / (MAX_GAIN - MIN_GAIN);
  const innerHeight = Math.max(1, VIEWBOX_HEIGHT - GRAPH_TOP_PAD - GRAPH_BOTTOM_PAD);
  return (1 - t) * innerHeight + GRAPH_TOP_PAD;
};

const yToGain = (y: number) => {
  const innerHeight = Math.max(1, VIEWBOX_HEIGHT - GRAPH_TOP_PAD - GRAPH_BOTTOM_PAD);
  const t = 1 - clamp((y - GRAPH_TOP_PAD) / innerHeight, 0, 1);
  return MIN_GAIN + t * (MAX_GAIN - MIN_GAIN);
};

const clampUnit = (value: number) => clamp(value, 0, 1);

const ensureWander = (band: ParametricEqBand): ParametricEqBandWander => ({
  jitter: clampUnit(band.wander?.jitter ?? 0),
  spread: clampUnit(band.wander?.spread ?? 0),
  seed: Number.isFinite(band.wander?.seed) ? Number(band.wander?.seed) : Math.random() * Math.PI * 2,
  baseFrequency: clamp(
    Number.isFinite(band.wander?.baseFrequency)
      ? Number(band.wander?.baseFrequency)
      : band.frequency,
    MIN_FREQ,
    MAX_FREQ
  ),
  baseGain: clamp(
    Number.isFinite(band.wander?.baseGain) ? Number(band.wander?.baseGain) : band.gain,
    MIN_GAIN,
    MAX_GAIN
  ),
});

const sortedBands = (bands: ParametricEqBand[]) => [...bands].sort((a, b) => a.frequency - b.frequency);

const defaultFrequencyForSlot = (slot: number) => {
  const t = clamp((slot - 1) / Math.max(1, MAX_BANDS - 1), 0, 1);
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  return Math.pow(10, minLog + t * (maxLog - minLog));
};

const frequencyToUnit = (value: number) => {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const clampedFreq = clamp(value, MIN_FREQ, MAX_FREQ);
  return (Math.log10(clampedFreq) - minLog) / (maxLog - minLog);
};

const unitToFrequency = (value: number) => {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const t = clamp(value, 0, 1);
  return Math.pow(10, minLog + t * (maxLog - minLog));
};

const formatFrequency = (value: number, fine?: boolean) => {
  if (value >= 1000) {
    const precision = fine ? 3 : value >= 10000 ? 1 : 2;
    return `${(value / 1000).toFixed(precision)} kHz`;
  }
  return `${value.toFixed(fine ? 1 : 0)} Hz`;
};

const formatGain = (value: number, fine?: boolean) => `${value.toFixed(fine ? 2 : 1)} dB`;
const formatGridFrequency = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `${value}`;
const linearToDb = (value: number) => 20 * Math.log10(Math.max(1e-6, value));
const dbToLinear = (db: number) => Math.pow(10, db / 20);
const qToSliderUnit = (q: number) => {
  const clampedQ = clamp(q, MIN_Q, MAX_Q);
  return Math.log(clampedQ / MIN_Q) / Math.log(MAX_Q / MIN_Q);
};
const sliderUnitToQ = (value: number) => {
  const t = clamp(value, 0, 1);
  return MIN_Q * Math.pow(MAX_Q / MIN_Q, t);
};

const toBandMidiActionId = (
  slot: number,
  param: "frequency" | "gain" | "jitter" | "spread"
): MidiActionId | undefined => {
  if (slot < 1 || slot > MAX_BANDS) return undefined;
  return `deck.parametricBand${slot as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}.${param}` as MidiActionId;
};

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
};

const buildBiquadCoefficients = (band: ParametricEqBand, sampleRate: number): BiquadCoefficients => {
  const safeSampleRate = Math.max(1, sampleRate);
  const w0 = (2 * Math.PI * clamp(band.frequency, MIN_FREQ, MAX_FREQ)) / safeSampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const q = clamp(band.q, MIN_Q, MAX_Q);
  const alpha = sinW0 / (2 * q);
  const gain = clamp(band.gain, MIN_GAIN, MAX_GAIN);
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
  sampleRate = 44100
) => {
  if (!band.enabled) return 0;
  if (Math.abs(band.gain) <= 1e-4) return 0;
  const coeffs = buildBiquadCoefficients(band, sampleRate);
  const normalizedFrequency = frequency / Math.max(1, sampleRate);
  const magnitude = magnitudeForFrequency(coeffs, normalizedFrequency);
  return 20 * Math.log10(Math.max(magnitude, 1e-6));
};

const toFrequencyAutomationParam = (slot: number) =>
  `parametricEqBand${slot}Frequency` as SimpleAutomationParam;
const toGainAutomationParam = (slot: number) =>
  `parametricEqBand${slot}Gain` as SimpleAutomationParam;

const ParametricEqEditor = ({
  bands,
  playbackActive = false,
  disabled = false,
  outputGain,
  isSimpleAutomated,
  onSimpleAutomationSet,
  onSimpleAutomationClear,
  onOutputGainChange,
  onResetAll,
  onChange,
}: ParametricEqEditorProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [graphWidth, setGraphWidth] = useState(VIEWBOX_WIDTH);
  const dragBandIdRef = useRef<string | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointerDownBandIdRef = useRef<string | null>(null);
  const lastNodeTapRef = useRef<{ bandId: string | null; atMs: number }>({ bandId: null, atMs: 0 });
  const nodeDragMovedRef = useRef(false);
  const nodeDragStartXRef = useRef(0);
  const nodeDragStartYRef = useRef(0);
  const bandsRef = useRef(bands);
  const onChangeRef = useRef(onChange);
  const nodeAutomationCaptureRef = useRef<{
    bandId: string;
    freqParam: SimpleAutomationParam;
    gainParam: SimpleAutomationParam;
    baselineFrequency: number;
    baselineGain: number;
    startedAtMs: number;
    frequencySamples: number[];
    gainSamples: number[];
    moved: boolean;
  } | null>(null);
  const nodeAutomationLatestRef = useRef<{ frequency: number; gain: number } | null>(null);
  const nodeAutomationIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    bandsRef.current = bands;
  }, [bands]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (bands.length === MAX_BANDS) return;
    onChange(normalizeParametricEqBands(bands));
  }, [bands, onChange]);

  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [scalePercent, setScalePercent] = useState(100);
  const [jitterDraft, setJitterDraft] = useState<{ bandId: string; value: number } | null>(null);
  const [spreadDraft, setSpreadDraft] = useState<{ bandId: string; value: number } | null>(null);
  const jitterDebounceTimeoutRef = useRef<number | null>(null);
  const pendingJitterRef = useRef<{ bandId: string; value: number } | null>(null);
  const spreadDebounceTimeoutRef = useRef<number | null>(null);
  const pendingSpreadRef = useRef<{ bandId: string; value: number } | null>(null);
  const wanderPhaseRef = useRef<
    Map<string, { phaseA: number; phaseB: number; gainPhaseA: number; gainPhaseB: number }>
  >(new Map());
  const wanderLastTickMsRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;
    const updateWidth = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextWidth = Math.max(1, (rect.width / rect.height) * VIEWBOX_HEIGHT);
      setGraphWidth((prev) => (Math.abs(prev - nextWidth) > 0.5 ? nextWidth : prev));
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const resolvedSelectedBandId =
    selectedBandId && bands.some((band) => band.id === selectedBandId) ? selectedBandId : bands[0]?.id ?? null;

  const selectedBand = useMemo(
    () => bands.find((band) => band.id === resolvedSelectedBandId) ?? null,
    [bands, resolvedSelectedBandId]
  );

  const slotByBandId = useMemo(() => {
    const lookup = new Map<string, number>();
    bands.forEach((band, index) => lookup.set(band.id, index + 1));
    return lookup;
  }, [bands]);

  const applyWanderPatch = useCallback((bandId: string, patch: Partial<ParametricEqBandWander>) => {
    const sourceBands = bandsRef.current;
    let changed = false;
    const next = sourceBands.map((band) => {
      if (band.id !== bandId) return band;
      const nextWander = { ...ensureWander(band), ...patch };
      const normalized = { ...nextWander, jitter: clampUnit(nextWander.jitter), spread: clampUnit(nextWander.spread) };
      if (
        band.wander &&
        Math.abs((band.wander.jitter ?? 0) - normalized.jitter) <= 1e-4 &&
        Math.abs((band.wander.spread ?? 0) - normalized.spread) <= 1e-4
      ) {
        return band;
      }
      changed = true;
      return { ...band, wander: normalized };
    });
    if (changed) onChangeRef.current(next);
  }, []);

  useEffect(() => {
    return () => {
      if (jitterDebounceTimeoutRef.current !== null) window.clearTimeout(jitterDebounceTimeoutRef.current);
      if (spreadDebounceTimeoutRef.current !== null) window.clearTimeout(spreadDebounceTimeoutRef.current);
      if (nodeAutomationIntervalRef.current !== null) {
        window.clearInterval(nodeAutomationIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (jitterDebounceTimeoutRef.current !== null) {
      window.clearTimeout(jitterDebounceTimeoutRef.current);
      jitterDebounceTimeoutRef.current = null;
    }
    pendingJitterRef.current = null;
    if (spreadDebounceTimeoutRef.current !== null) {
      window.clearTimeout(spreadDebounceTimeoutRef.current);
      spreadDebounceTimeoutRef.current = null;
    }
    pendingSpreadRef.current = null;
  }, [resolvedSelectedBandId]);

  useEffect(() => {
    const handlePointerDownOutside = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(event.target as Node)) return;
      setSelectedBandId(null);
    };
    window.addEventListener("pointerdown", handlePointerDownOutside);
    return () => window.removeEventListener("pointerdown", handlePointerDownOutside);
  }, []);

  const hasActiveWander = bands.some((band) => {
    const wander = band.wander;
    return Boolean(wander && wander.jitter > 0.001 && wander.spread > 0.001);
  });

  useEffect(() => {
    if (hasActiveWander) return;
    let changed = false;
    const reset = bands.map((band) => {
      const wander = band.wander;
      if (!wander) return band;
      const baseFrequency = clamp(wander.baseFrequency, MIN_FREQ, MAX_FREQ);
      const baseGain = clamp(wander.baseGain, MIN_GAIN, MAX_GAIN);
      if (Math.abs(band.frequency - baseFrequency) <= 1e-4 && Math.abs(band.gain - baseGain) <= 1e-4) {
        return band;
      }
      changed = true;
      return { ...band, frequency: baseFrequency, gain: baseGain };
    });
    if (changed) onChange(reset);
  }, [bands, hasActiveWander, onChange]);

  useEffect(() => {
    if (!playbackActive || !hasActiveWander) return undefined;
    const wanderPhaseMap = wanderPhaseRef.current;
    wanderLastTickMsRef.current = performance.now();
    const intervalId = window.setInterval(() => {
      if (dragBandIdRef.current) return;
      const nowMs = performance.now();
      const lastTickMs = wanderLastTickMsRef.current ?? nowMs;
      wanderLastTickMsRef.current = nowMs;
      const dtSec = clamp((nowMs - lastTickMs) / 1000, 0.001, 0.1);
      const sourceBands = bandsRef.current;
      let changed = false;
      const next = sourceBands.map((band) => {
        const wander = band.wander;
        if (!wander || wander.jitter <= 0.001 || wander.spread <= 0.001) {
          wanderPhaseMap.delete(band.id);
          return band;
        }
        const speedHz = 0.02 + Math.pow(wander.jitter, 1.5) * 1.76;
        let phases = wanderPhaseMap.get(band.id);
        if (!phases) {
          phases = {
            phaseA: wander.seed,
            phaseB: wander.seed * 1.91,
            gainPhaseA: wander.seed * 2.71 + 1.7,
            gainPhaseB: wander.seed * 1.13 + 0.2,
          };
          wanderPhaseMap.set(band.id, phases);
        }
        phases.phaseA += dtSec * Math.PI * 2 * speedHz;
        phases.phaseB += dtSec * Math.PI * 2 * (speedHz * 1.37);
        phases.gainPhaseA += dtSec * Math.PI * 2 * (speedHz * 0.79);
        phases.gainPhaseB += dtSec * Math.PI * 2 * (speedHz * 1.5207);
        const freqNoise = (Math.sin(phases.phaseA) + 0.65 * Math.sin(phases.phaseB)) / 1.65;
        const gainNoise = (Math.sin(phases.gainPhaseA) + 0.6 * Math.sin(phases.gainPhaseB)) / 1.6;
        const octaveSpan = 0.08 + wander.spread * 1.1;
        const gainSpan = 0.5 + wander.spread * 10;
        const frequency = clamp(wander.baseFrequency * Math.pow(2, freqNoise * octaveSpan), MIN_FREQ, MAX_FREQ);
        const gain = clamp(wander.baseGain + gainNoise * gainSpan, MIN_GAIN, MAX_GAIN);
        if (Math.abs(frequency - band.frequency) > 1e-4 || Math.abs(gain - band.gain) > 1e-4) {
          changed = true;
          return { ...band, frequency, gain };
        }
        return band;
      });
      if (changed) onChangeRef.current(next);
    }, 1000 / 30);

    return () => {
      wanderLastTickMsRef.current = null;
      wanderPhaseMap.clear();
      window.clearInterval(intervalId);
    };
  }, [playbackActive, hasActiveWander]);

  const updateBand = useCallback((id: string, updates: Partial<ParametricEqBand>) => {
    const sourceBands = bandsRef.current;
    onChangeRef.current(
      sourceBands.map((band) => {
        if (band.id !== id) return band;
        const nextFrequency = updates.frequency === undefined ? band.frequency : clamp(updates.frequency, MIN_FREQ, MAX_FREQ);
        const nextGain = updates.gain === undefined ? band.gain : clamp(updates.gain, MIN_GAIN, MAX_GAIN);
        const nextWander =
          updates.wander === undefined
            ? band.wander
            : {
                ...ensureWander(band),
                ...updates.wander,
              };
        const hasDirectFrequencyUpdate = updates.frequency !== undefined;
        const hasDirectGainUpdate = updates.gain !== undefined;
        return {
          ...band,
          ...updates,
          frequency: nextFrequency,
          gain: nextGain,
          q: updates.q === undefined ? band.q : clamp(updates.q, MIN_Q, MAX_Q),
          wander:
            nextWander === undefined
              ? undefined
              : {
                  ...nextWander,
                  jitter: clampUnit(nextWander.jitter),
                  spread: clampUnit(nextWander.spread),
                  seed: Number.isFinite(nextWander.seed) ? Number(nextWander.seed) : ensureWander(band).seed,
                  baseFrequency: hasDirectFrequencyUpdate
                    ? nextFrequency
                    : clamp(nextWander.baseFrequency, MIN_FREQ, MAX_FREQ),
                  baseGain: hasDirectGainUpdate ? nextGain : clamp(nextWander.baseGain, MIN_GAIN, MAX_GAIN),
                },
        };
      })
    );
  }, []);

  const defaultBands = useMemo(() => defaultParametricEqBands().slice(0, MAX_BANDS), []);

  const resetBands = () => {
    onResetAll?.();
    const next = defaultBands.map((band, index) => ({ ...band, id: bands[index]?.id ?? band.id }));
    onChange(next);
    setSelectedBandId(next[0]?.id ?? null);
    setScalePercent(100);
  };

  const resetBand = useCallback(
    (id: string) => {
      const index = bands.findIndex((band) => band.id === id);
      if (index < 0 || index >= MAX_BANDS) return;
      const template = defaultBands[index] ?? defaultBands[0];
      const next = bands.map((band, bandIndex) =>
        bandIndex === index
          ? {
              ...template,
              id: band.id,
            }
          : band
      );
      onChange(next);
      if (resolvedSelectedBandId === id) setSelectedBandId(id);
    },
    [bands, defaultBands, onChange, resolvedSelectedBandId]
  );

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * graphWidth,
      y: ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT,
    };
  };

  const handleSvgPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as HTMLElement;
    if (target.dataset.bandId) return;
    setSelectedBandId(null);
  };

  const handleBandPointerDown = (event: ReactPointerEvent<SVGCircleElement>, bandId: string) => {
    event.stopPropagation();
    dragBandIdRef.current = bandId;
    pointerIdRef.current = event.pointerId;
    pointerDownBandIdRef.current = bandId;
    nodeDragMovedRef.current = false;
    nodeDragStartXRef.current = event.clientX;
    nodeDragStartYRef.current = event.clientY;
    setSelectedBandId(bandId);
    svgRef.current?.setPointerCapture(event.pointerId);
    if (nodeAutomationIntervalRef.current !== null) {
      window.clearInterval(nodeAutomationIntervalRef.current);
      nodeAutomationIntervalRef.current = null;
    }
    nodeAutomationCaptureRef.current = null;
    nodeAutomationLatestRef.current = null;
    if (!event.altKey || !onSimpleAutomationSet) return;
    const slot = slotByBandId.get(bandId);
    const band = bandsRef.current.find((item) => item.id === bandId);
    if (!slot || !band) return;
    const freqParam = toFrequencyAutomationParam(slot);
    const gainParam = toGainAutomationParam(slot);
    nodeAutomationCaptureRef.current = {
      bandId,
      freqParam,
      gainParam,
      baselineFrequency: band.frequency,
      baselineGain: band.gain,
      startedAtMs: event.timeStamp,
      frequencySamples: [band.frequency],
      gainSamples: [band.gain],
      moved: false,
    };
    nodeAutomationLatestRef.current = { frequency: band.frequency, gain: band.gain };
    nodeAutomationIntervalRef.current = window.setInterval(() => {
      const capture = nodeAutomationCaptureRef.current;
      const latest = nodeAutomationLatestRef.current;
      if (!capture || !latest) return;
      capture.frequencySamples.push(latest.frequency);
      capture.gainSamples.push(latest.gain);
    }, 1000 / NODE_AUTOMATION_SAMPLE_RATE);
  };

  const handleSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointerIdRef.current === null || pointerIdRef.current !== event.pointerId) return;
    if (!dragBandIdRef.current) return;
    if (
      !nodeDragMovedRef.current &&
      (Math.abs(event.clientX - nodeDragStartXRef.current) > 2 || Math.abs(event.clientY - nodeDragStartYRef.current) > 2)
    ) {
      nodeDragMovedRef.current = true;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    updateBand(dragBandIdRef.current, {
      frequency: xToFreq(point.x, graphWidth),
      gain: yToGain(point.y),
      enabled: true,
    });
    const capture = nodeAutomationCaptureRef.current;
    if (capture && capture.bandId === dragBandIdRef.current) {
      const nextFrequency = xToFreq(point.x, graphWidth);
      const nextGain = yToGain(point.y);
      nodeAutomationLatestRef.current = { frequency: nextFrequency, gain: nextGain };
      capture.moved = true;
    }
  };

  const handleSvgPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const activeBandId = pointerDownBandIdRef.current;
    if (pointerIdRef.current !== null && pointerIdRef.current === event.pointerId) {
      if (activeBandId && !nodeDragMovedRef.current) {
        if (event.shiftKey) {
          resetBand(activeBandId);
        } else {
          const now = event.timeStamp;
          const lastTap = lastNodeTapRef.current;
          if (lastTap.bandId === activeBandId && now - lastTap.atMs < 280) {
            resetBand(activeBandId);
            lastNodeTapRef.current = { bandId: null, atMs: 0 };
          } else {
            lastNodeTapRef.current = { bandId: activeBandId, atMs: now };
          }
        }
      }
      pointerIdRef.current = null;
      dragBandIdRef.current = null;
      pointerDownBandIdRef.current = null;
      nodeDragMovedRef.current = false;
    }
    const capture = nodeAutomationCaptureRef.current;
    if (capture && onSimpleAutomationSet) {
      if (nodeAutomationIntervalRef.current !== null) {
        window.clearInterval(nodeAutomationIntervalRef.current);
        nodeAutomationIntervalRef.current = null;
      }
      const latest = nodeAutomationLatestRef.current;
      if (latest) {
        capture.frequencySamples.push(latest.frequency);
        capture.gainSamples.push(latest.gain);
      }
      const band = bandsRef.current.find((item) => item.id === capture.bandId);
      const targetFrequency = band?.frequency ?? latest?.frequency ?? capture.baselineFrequency;
      const targetGain = band?.gain ?? latest?.gain ?? capture.baselineGain;
      if (capture.moved) {
        const durationSec = Math.max(
          0.05,
          (event.timeStamp - capture.startedAtMs) / 1000
        );
        const hasRecordedSamples =
          capture.frequencySamples.length > 1 && capture.gainSamples.length > 1;
        const frequencyRecording = hasRecordedSamples
          ? {
              samples: capture.frequencySamples,
              sampleRate: NODE_AUTOMATION_SAMPLE_RATE,
              durationSec,
            }
          : undefined;
        const gainRecording = hasRecordedSamples
          ? {
              samples: capture.gainSamples,
              sampleRate: NODE_AUTOMATION_SAMPLE_RATE,
              durationSec,
            }
          : undefined;
        onSimpleAutomationSet(
          capture.freqParam,
          targetFrequency,
          capture.baselineFrequency,
          frequencyRecording
        );
        onSimpleAutomationSet(
          capture.gainParam,
          targetGain,
          capture.baselineGain,
          gainRecording
        );
      }
      nodeAutomationCaptureRef.current = null;
      nodeAutomationLatestRef.current = null;
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const sorted = useMemo(() => sortedBands(bands), [bands]);
  const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const gridFreqsMinor = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];
  const gridGains = [-18, -12, -6, 0, 6, 12, 18];
  const stripSlots = Array.from({ length: MAX_BANDS }, (_, index) => index + 1);

  const responseCurves = useMemo(() => {
    const frequencies = Array.from({ length: RESPONSE_POINTS }, (_, index) =>
      xToFreq((index / Math.max(1, RESPONSE_POINTS - 1)) * graphWidth, graphWidth)
    );
    const buildPath = (values: number[]) =>
      values
        .map((value, index) => {
          const command = index === 0 ? "M" : "L";
          const x = (index / Math.max(1, RESPONSE_POINTS - 1)) * graphWidth;
          return `${command}${x.toFixed(2)},${gainToY(value).toFixed(2)}`;
        })
        .join(" ");

    const activeBands = sorted.filter((band) => band.enabled && Math.abs(band.gain) > 1e-4);
    const bandPaths = activeBands.map((band) => {
      const values = frequencies.map((frequency) =>
        clamp(responseDbForBandAtFrequency(band, frequency), MIN_GAIN, MAX_GAIN)
      );
      return { bandId: band.id, path: buildPath(values) };
    });

    const summedValues = frequencies.map((frequency) =>
      clamp(
        activeBands.reduce((total, band) => total + responseDbForBandAtFrequency(band, frequency), 0),
        MIN_GAIN,
        MAX_GAIN
      )
    );

    return {
      bandPaths,
      sumPath: buildPath(summedValues),
    };
  }, [graphWidth, sorted]);

  return (
    <div ref={containerRef} className={`peq ${disabled ? "is-disabled" : ""}`.trim()}>
      <svg
        ref={svgRef}
        className="peq__graph"
        viewBox={`0 0 ${graphWidth} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Parametric EQ graph with draggable numbered nodes."
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        onPointerCancel={handleSvgPointerUp}
      >
        <rect x={0} y={0} width={graphWidth} height={VIEWBOX_HEIGHT} className="peq__bg" />
        {gridFreqsMinor.map((freq) => {
          const x = freqToX(freq, graphWidth);
          return (
            <line
              key={`fm-${freq}`}
              x1={x}
              y1={GRAPH_TOP_PAD}
              x2={x}
              y2={VIEWBOX_HEIGHT - GRAPH_BOTTOM_PAD}
              className="peq__grid peq__grid--minor"
            />
          );
        })}
        {gridFreqs.map((freq) => {
          const x = freqToX(freq, graphWidth);
          return (
            <line key={`f-${freq}`} x1={x} y1={GRAPH_TOP_PAD} x2={x} y2={VIEWBOX_HEIGHT - GRAPH_BOTTOM_PAD} className="peq__grid" />
          );
        })}
        {gridGains.map((gain) => {
          const y = gainToY(gain);
          return (
            <line
              key={`g-${gain}`}
              x1={GRAPH_LEFT_PAD}
              y1={y}
              x2={graphWidth - GRAPH_RIGHT_PAD}
              y2={y}
              className={`peq__grid ${gain === 0 ? "peq__grid--zero" : ""}`.trim()}
            />
          );
        })}
        {gridFreqs.map((freq) => (
          <text key={`fl-${freq}`} x={freqToX(freq, graphWidth)} y={VIEWBOX_HEIGHT - 6} className="peq__axis-label peq__axis-label--freq" textAnchor="middle" aria-hidden="true">
            {formatGridFrequency(freq)}
          </text>
        ))}
        {gridGains.map((gain) => (
          <text
            key={`gl-${gain}`}
            x={GRAPH_LEFT_PAD - 6}
            y={gainToY(gain)}
            className="peq__axis-label peq__axis-label--gain"
            textAnchor="end"
            dominantBaseline="middle"
            aria-hidden="true"
          >
            {gain > 0 ? `+${gain}` : `${gain}`}
          </text>
        ))}

        {responseCurves.bandPaths.map(({ bandId, path }) => (
          <path key={`curve-${bandId}`} d={path} className={`peq__band-curve ${resolvedSelectedBandId === bandId ? "is-selected" : ""}`.trim()} />
        ))}
        <path d={responseCurves.sumPath} className="peq__curve" />

        {sorted.map((band) => {
          const nodeX = freqToX(band.frequency, graphWidth);
          const nodeY = gainToY(band.gain);
          const isSelected = resolvedSelectedBandId === band.id;
          const nodeRadius = isSelected ? 12 : 9;
          const wander = ensureWander(band);
          const jitter = band.wander ? clampUnit(wander.jitter) : 0;
          const spread = band.wander ? clampUnit(wander.spread) : 0;
          const ringRadius = nodeRadius + 2 + spread * 16;
          const hue = 212 + jitter * 4;
          const saturation = 72 + jitter * 24;
          const lightness = 70 - jitter * 18;
          const slot = slotByBandId.get(band.id) ?? 0;

          return (
            <g key={band.id}>
              {spread > 0.001 ? (
                <circle
                  className={`peq__node-spread ${isSelected ? "is-selected" : ""}`.trim()}
                  cx={nodeX}
                  cy={nodeY}
                  r={ringRadius}
                  style={{ strokeOpacity: 0.12 + spread * 0.38, strokeWidth: 0.9 + spread * 1.4 }}
                />
              ) : null}
              <circle
                data-band-id={band.id}
                className={`peq__node ${isSelected ? "is-selected" : ""} ${band.enabled ? "" : "is-muted"}`.trim()}
                cx={nodeX}
                cy={nodeY}
                r={nodeRadius}
                style={band.enabled ? { fill: `hsl(${hue} ${saturation}% ${lightness}%)` } : undefined}
                onPointerDown={(event) => handleBandPointerDown(event, band.id)}
              />
              <text x={nodeX} y={nodeY + 1} className="peq__node-label" textAnchor="middle" dominantBaseline="middle" aria-hidden="true">
                {slot}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="peq__bands" role="group" aria-label="Parametric EQ bands">
        {stripSlots.map((slot) => {
          const band = bands[slot - 1] ?? null;
          if (!band) return null;
          const isSelected = band.id === resolvedSelectedBandId;
          const freqParam = toFrequencyAutomationParam(slot);
          const gainParam = toGainAutomationParam(slot);

          return (
            <div
              key={band.id}
              className={`peq__band-strip ${isSelected ? "is-selected" : ""} ${band.enabled ? "" : "is-muted"}`.trim()}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedBandId(band.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedBandId(band.id);
                }
              }}
              aria-pressed={isSelected}
            >
              <div className="peq__band-title">{slot}</div>
              <Knob
                className="knob--compact"
                label="Freq"
                midiActionId={toBandMidiActionId(slot, "frequency")}
                min={0}
                max={1}
                step={0.001}
                value={frequencyToUnit(band.frequency)}
                defaultValue={frequencyToUnit(defaultFrequencyForSlot(slot))}
                labelTitle="Band center frequency. Hold Option and drag to capture simple automation."
                onChange={(next) => updateBand(band.id, { frequency: unitToFrequency(next) })}
                formatValue={(value, fine) => formatFrequency(unitToFrequency(value), fine)}
                isSimpleAutomated={isSimpleAutomated?.(freqParam) ?? false}
                onSimpleAutomationSet={(target, baseline, recording) => {
                  const frequencyRecording =
                    recording && recording.samples.length > 1
                      ? {
                          ...recording,
                          samples: recording.samples.map((sample) => unitToFrequency(sample)),
                        }
                      : recording;
                  onSimpleAutomationSet?.(
                    freqParam,
                    unitToFrequency(target),
                    unitToFrequency(baseline),
                    frequencyRecording
                  );
                }}
                onSimpleAutomationClear={() => onSimpleAutomationClear?.(freqParam)}
              />
              <Knob
                className="knob--compact"
                label="Gain"
                midiActionId={toBandMidiActionId(slot, "gain")}
                min={MIN_GAIN}
                max={MAX_GAIN}
                step={0.05}
                value={band.gain}
                defaultValue={0}
                centerSnap={0.25}
                labelTitle="Band gain. Hold Option and drag to capture simple automation."
                onChange={(next) => updateBand(band.id, { gain: next })}
                formatValue={formatGain}
                isSimpleAutomated={isSimpleAutomated?.(gainParam) ?? false}
                onSimpleAutomationSet={(target, baseline, recording) => {
                  onSimpleAutomationSet?.(gainParam, target, baseline, recording);
                }}
                onSimpleAutomationClear={() => onSimpleAutomationClear?.(gainParam)}
              />

              <div className="peq__band-footer">
                <label className="peq__band-enable" title="Enable or bypass this band.">
                  <input
                    type="checkbox"
                    checked={band.enabled}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateBand(band.id, { enabled: event.target.checked })}
                  />
                  On
                </label>
                <label className="peq__band-mode">
                  <span>Mode</span>
                  <select
                    value={band.type}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateBand(band.id, { type: event.target.value as ParametricEqBandType })}
                  >
                    <option value="lowshelf">Low</option>
                    <option value="peaking">Bell</option>
                    <option value="highshelf">High</option>
                  </select>
                </label>
                <label className="peq__band-q">
                  <span>Q {band.q.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={qToSliderUnit(band.q)}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      const defaultQ = defaultBands[slot - 1]?.q ?? 1.2;
                      updateBand(band.id, { q: defaultQ });
                    }}
                    onChange={(event) =>
                      updateBand(band.id, { q: sliderUnitToQ(Number(event.target.value)) })
                    }
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="peq__details">
        <div className={`peq__detail ${selectedBand ? "" : "peq__detail--empty"}`.trim()}>
          {selectedBand ? (
            <>
              <div className="peq__detail-head">
                <strong>Band {slotByBandId.get(selectedBand.id) ?? "-"}</strong>
              </div>
              <div className="peq__detail-row peq__detail-row--knobs">
                <Knob
                  className="knob--compact"
                  label="Jitter"
                  midiActionId={toBandMidiActionId(slotByBandId.get(selectedBand.id) ?? 0, "jitter")}
                  min={0}
                  max={1}
                  step={0.001}
                  value={
                    jitterDraft !== null && jitterDraft.bandId === selectedBand.id
                      ? jitterDraft.value
                      : ensureWander(selectedBand).jitter
                  }
                  defaultValue={0}
                  labelTitle="How erratic and lively this node moves while playing."
                  onChange={(next) => {
                    if (!playbackActive) {
                      setJitterDraft(null);
                      applyWanderPatch(selectedBand.id, { jitter: next });
                      return;
                    }
                    setJitterDraft({ bandId: selectedBand.id, value: next });
                    pendingJitterRef.current = { bandId: selectedBand.id, value: next };
                    if (jitterDebounceTimeoutRef.current !== null) window.clearTimeout(jitterDebounceTimeoutRef.current);
                    jitterDebounceTimeoutRef.current = window.setTimeout(() => {
                      jitterDebounceTimeoutRef.current = null;
                      const pending = pendingJitterRef.current;
                      pendingJitterRef.current = null;
                      if (!pending) return;
                      applyWanderPatch(pending.bandId, { jitter: pending.value });
                      setJitterDraft(null);
                    }, JITTER_DEBOUNCE_MS);
                  }}
                  formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
                />
                <Knob
                  className="knob--compact"
                  label="Spread"
                  midiActionId={toBandMidiActionId(slotByBandId.get(selectedBand.id) ?? 0, "spread")}
                  min={0}
                  max={1}
                  step={0.01}
                  value={
                    spreadDraft !== null && spreadDraft.bandId === selectedBand.id
                      ? spreadDraft.value
                      : ensureWander(selectedBand).spread
                  }
                  defaultValue={0}
                  labelTitle="How far this node wanders from its base frequency and gain."
                  onChange={(next) => {
                    if (!playbackActive) {
                      setSpreadDraft(null);
                      applyWanderPatch(selectedBand.id, { spread: next });
                      return;
                    }
                    setSpreadDraft({ bandId: selectedBand.id, value: next });
                    pendingSpreadRef.current = { bandId: selectedBand.id, value: next };
                    if (spreadDebounceTimeoutRef.current !== null) window.clearTimeout(spreadDebounceTimeoutRef.current);
                    spreadDebounceTimeoutRef.current = window.setTimeout(() => {
                      spreadDebounceTimeoutRef.current = null;
                      const pending = pendingSpreadRef.current;
                      pendingSpreadRef.current = null;
                      if (!pending) return;
                      applyWanderPatch(pending.bandId, { spread: pending.value });
                      setSpreadDraft(null);
                    }, SPREAD_DEBOUNCE_MS);
                  }}
                  formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
                />
              </div>
            </>
          ) : (
            <span>Select a band to edit jitter/spread.</span>
          )}
        </div>
        <div className="peq__detail peq__detail--globals">
          <div className="peq__detail-head">
            <strong>Global</strong>
          </div>
          <div className="peq__detail-row peq__detail-row--globals">
            <Knob
              className="knob--compact"
              label="Scale"
              midiActionId="deck.parametricScale"
              min={0}
              max={200}
              step={0.1}
              value={scalePercent}
              defaultValue={100}
              labelTitle="Scales all band gains proportionally."
              onChange={(next) => {
                const prev = Math.max(1e-3, scalePercent);
                const ratio = next / prev;
                setScalePercent(next);
                onChange(
                  bands.map((band) => ({
                    ...band,
                    gain: clamp(band.gain * ratio, MIN_GAIN, MAX_GAIN),
                  }))
                );
              }}
              formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)}%`}
            />
            <Knob
              className="knob--compact"
              label="Gain"
              midiActionId="deck.gain"
              min={-24}
              max={12}
              step={0.1}
              value={linearToDb(outputGain ?? 1)}
              defaultValue={0}
              centerSnap={0.25}
              labelTitle="Output trim while working in parametric EQ mode."
              onChange={(next) => onOutputGainChange?.(dbToLinear(next))}
              formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)} dB`}
            />
            <button
              type="button"
              className="deck__action peq__global-reset"
              title="Reset parametric EQ to default bands."
              onClick={resetBands}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParametricEqEditor;
