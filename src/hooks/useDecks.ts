import { useCallback, useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type {
  DeckFxPanel,
  DeckFxPanelState,
  DeckState,
  DeckStatus,
  DeckWidthOverride,
} from "../types/deck";
import type { AutomationParam, AutomationSnapshot, ClipSettings, DeckSession } from "../types/session";
import {
  MAX_REARRANGER_SLICES,
  normalizeRearrangerRegionIds,
  normalizeRearrangerRegions,
} from "../utils/rearranger";
const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const AUTOMATION_SAMPLE_RATE = 30;
const MIN_AUTOMATION_DURATION = 0.25;
const AUTOMATION_UI_INTERVAL_MS = 100;
const TEMPO_SNAP_STEP = 25;
const TEMPO_SNAP_THRESHOLD = 1;
const STRETCH_WINDOW_SIZES = [2048, 4096, 8192, 16384];
const DEFAULT_STRETCH_RATIO = 2;
const DEFAULT_STRETCH_WINDOW_SIZE = 16384;
const DEFAULT_STRETCH_STEREO_WIDTH = 1;
const DEFAULT_STRETCH_PHASE_RANDOMNESS = 0.5;
const DEFAULT_STRETCH_TILT_DB = 0;
const DEFAULT_STRETCH_SCATTER = 1;
const DEFAULT_DELAY_TIME = 0.35;
const DEFAULT_DELAY_FEEDBACK = 0.35;
const DEFAULT_DELAY_MIX = 0;
const DEFAULT_DELAY_TONE = 6000;
const DEFAULT_DELAY_PINGPONG = false;
const DEFAULT_DELAY_SLICE_SYNC = false;
const DEFAULT_FRACTAL_MIX = 0;
const DEFAULT_FRACTAL_STRUCTURE = 0.45;
const DEFAULT_FRACTAL_DEPTH = 0.35;
const DEFAULT_FRACTAL_DRIFT = 0.15;
const DEFAULT_FRACTAL_DECAY = 0.2;
const DEFAULT_FRACTAL_TONE = 6000;
const DEFAULT_REARRANGER_SLICES = 0;
const DEFAULT_REARRANGER_OFFSET = 0;
const DEFAULT_REARRANGER_CHAOS = 0;
const DEFAULT_REARRANGER_REVERSE = 0;
const DEFAULT_REARRANGER_SENSITIVITY = 0.6;
const DEFAULT_REARRANGER_QUIET_THRESHOLD = 0.3;
const DEFAULT_REARRANGER_AUTO = false;
const DEFAULT_RESONANCE = 0;
const EQ_MAX_DB = 18;
const FX_ACTIVE_EPSILON = 1e-3;
const DEFAULT_FX_PANEL_OPEN: DeckFxPanelState = {
  gain: false,
  djFilter: false,
  resonance: false,
  eqLow: false,
  eqMid: false,
  eqHigh: false,
  balance: false,
  pitch: false,
  delay: false,
  fractal: false,
  rearranger: false,
  stretch: false,
};

const withDefaultFxPanelOpen = (
  state?: Partial<DeckFxPanelState> | null
): DeckFxPanelState => ({
  ...DEFAULT_FX_PANEL_OPEN,
  ...(state ?? {}),
});

const approxEqual = (a: number, b: number, epsilon = FX_ACTIVE_EPSILON) =>
  Math.abs(a - b) <= epsilon;
const regionsEqual = (a: number[] | undefined, b: number[] | undefined, epsilon = 1e-6) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > epsilon) return false;
  }
  return true;
};

const sanitizeRearrangerRegions = (regions: number[] | null | undefined) => {
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

const appendRearrangerBoundary = (regions: number[]) => {
  if (regions.length < 2) return regions;
  const prev = regions[regions.length - 2] ?? 0;
  const next = regions[regions.length - 1] ?? 1;
  const inserted = prev + (next - prev) * 0.5;
  const copy = [...regions];
  copy.splice(copy.length - 1, 0, inserted);
  return copy;
};

type AutomationTrack = {
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

type AutomationDeck = {
  gain: AutomationTrack;
  djFilter: AutomationTrack;
  resonance: AutomationTrack;
  eqLow: AutomationTrack;
  eqMid: AutomationTrack;
  eqHigh: AutomationTrack;
  balance: AutomationTrack;
  pitch: AutomationTrack;
};

type AutomationView = {
  samples: Float32Array;
  previewSamples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  currentValue: number;
  amplitudeScale: number;
};

const toAutomationView = (track: AutomationTrack): AutomationView => ({
  samples: track.samples,
  previewSamples: track.recording ? new Float32Array(track.recordBuffer) : new Float32Array(0),
  durationSec: track.durationSec,
  recording: track.recording,
  active: track.active,
  currentValue: track.currentValue,
  amplitudeScale: track.amplitudeScale,
});

const createTrack = (initialValue: number): AutomationTrack => ({
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
const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const playbackRateRef = useRef<Map<number, number>>(new Map());
  const playbackStartRef = useRef<Map<number, number>>(new Map());
  const automationRef = useRef<Map<number, AutomationDeck>>(new Map());
  const automationPlayheadRef = useRef<Map<number, Record<AutomationParam, number>>>(new Map());
  const automationUiUpdateRef = useRef<Map<number, number>>(new Map());
  const loadRequestRef = useRef<Map<number, number>>(new Map());
  const automationTickEnabledRef = useRef(false);
  const [automationState, setAutomationState] = useState<Map<number, Record<AutomationParam, AutomationView>>>(
    new Map()
  );
  const [automationTickEnabled, setAutomationTickEnabled] = useState(false);
  const createInitialDecks = useCallback((): DeckState[] => [
    {
      id: 1,
      status: "idle",
      gain: 0.9,
      djFilter: 0,
      filterResonance: 0,
      eqLowGain: 0,
      eqMidGain: 0,
      eqHighGain: 0,
      balance: 0,
      pitchShift: 0,
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
      fractalMix: DEFAULT_FRACTAL_MIX,
      fractalStructure: DEFAULT_FRACTAL_STRUCTURE,
      fractalDepth: DEFAULT_FRACTAL_DEPTH,
      fractalDrift: DEFAULT_FRACTAL_DRIFT,
      fractalDecay: DEFAULT_FRACTAL_DECAY,
      fractalTone: DEFAULT_FRACTAL_TONE,
      rearrangerSlices: DEFAULT_REARRANGER_SLICES,
      rearrangerOffset: DEFAULT_REARRANGER_OFFSET,
      rearrangerChaos: DEFAULT_REARRANGER_CHAOS,
      rearrangerReverse: DEFAULT_REARRANGER_REVERSE,
      rearrangerSensitivity: DEFAULT_REARRANGER_SENSITIVITY,
      rearrangerQuietThreshold: DEFAULT_REARRANGER_QUIET_THRESHOLD,
      rearrangerAuto: DEFAULT_REARRANGER_AUTO,
      rearrangerRegionsManual: false,
      fxPanelOpen: withDefaultFxPanelOpen(),
    },
  ], []);

  const [decks, setDecks] = useState<DeckState[]>(createInitialDecks);
  const {
    decodeFile,
    playBuffer,
    stop,
    setDeckGain,
    setDeckFilter,
    setDeckHighpass,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckBalance,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckFractalMix,
    setDeckFractalStructure,
    setDeckFractalDepth,
    setDeckFractalDrift,
    setDeckFractalDecay,
    setDeckFractalTone,
    setDeckPitchShift,
    removeDeck: removeDeckNodes,
    getDeckPosition,
    getDeckPlaybackSnapshot: _getDeckPlaybackSnapshot,
    setDeckLoopParams,
    setDeckPlaybackRate,
    setDeckPlaybackOffset,
  } = useAudioEngine();

  const getFilterTargets = useCallback((djFilter: number) => {
    const min = 60;
    const max = 20000;
    const highpassMax = 12000;
    const normalized = clamp(djFilter, -1, 1);
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const logHighMax = Math.log10(highpassMax);
    if (normalized < 0) {
      const t = 1 + normalized;
      const lowpass = Math.pow(10, logMin + t * (logMax - logMin));
      return { lowpass, highpass: min };
    }
    if (normalized > 0) {
      const t = normalized;
      const highpass = Math.pow(10, logMin + t * (logHighMax - logMin));
      return { lowpass: max, highpass };
    }
    return { lowpass: max, highpass: min };
  }, []);

  const ensureAutomationDeck = useCallback((deckId: number, deck: DeckState) => {
    let automation = automationRef.current.get(deckId);
    if (!automation) {
      automation = {
        gain: createTrack(deck.gain),
        djFilter: createTrack(deck.djFilter),
        resonance: createTrack(deck.filterResonance),
        eqLow: createTrack(deck.eqLowGain),
        eqMid: createTrack(deck.eqMidGain),
        eqHigh: createTrack(deck.eqHighGain),
        balance: createTrack(deck.balance),
        pitch: createTrack(deck.pitchShift),
      };
      automationRef.current.set(deckId, automation);
      automationPlayheadRef.current.set(deckId, {
        gain: 0,
        djFilter: 0,
        resonance: 0,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        balance: 0,
        pitch: 0,
      });
      setAutomationState((prev) => {
        const next = new Map(prev);
        next.set(deckId, {
          gain: toAutomationView(automation!.gain),
          djFilter: toAutomationView(automation!.djFilter),
          resonance: toAutomationView(automation!.resonance),
          eqLow: toAutomationView(automation!.eqLow),
          eqMid: toAutomationView(automation!.eqMid),
          eqHigh: toAutomationView(automation!.eqHigh),
          balance: toAutomationView(automation!.balance),
          pitch: toAutomationView(automation!.pitch),
        });
        return next;
      });
    }
    return automation;
  }, []);

  const updateAutomationTickEnabled = useCallback(() => {
    let enabled = false;
    automationRef.current.forEach((tracks) => {
      if (enabled) return;
      (Object.values(tracks) as AutomationTrack[]).forEach((track) => {
        if (track.recording || track.active) {
          enabled = true;
        }
      });
    });
    if (automationTickEnabledRef.current !== enabled) {
      automationTickEnabledRef.current = enabled;
      setAutomationTickEnabled(enabled);
    }
  }, []);

  const applyDeckSettingsToEngine = useCallback(
    (
      deckId: number,
      settings: {
        gain: number;
        djFilter: number;
        filterResonance: number;
        eqLowGain: number;
        eqMidGain: number;
        eqHighGain: number;
        balance: number;
        pitchShift: number;
        tempoOffset: number;
        delayTime: number;
        delayFeedback: number;
        delayMix: number;
        delayTone: number;
        delayPingPong: boolean;
        delaySliceSync?: boolean;
        fractalMix: number;
        fractalStructure: number;
        fractalDepth: number;
        fractalDrift: number;
        fractalDecay: number;
        fractalTone: number;
      }
    ) => {
      const targets = getFilterTargets(settings.djFilter);
      setDeckGain(deckId, settings.gain);
      setDeckFilter(deckId, targets.lowpass);
      setDeckHighpass(deckId, targets.highpass);
      setDeckResonance(deckId, settings.filterResonance);
      setDeckEqLow(deckId, settings.eqLowGain);
      setDeckEqMid(deckId, settings.eqMidGain);
      setDeckEqHigh(deckId, settings.eqHighGain);
      setDeckBalance(deckId, settings.balance);
      setDeckPitchShift(deckId, settings.pitchShift);
      setDeckDelayTime(deckId, settings.delayTime);
      setDeckDelayFeedback(deckId, settings.delayFeedback);
      setDeckDelayMix(deckId, settings.delayMix);
      setDeckDelayTone(deckId, settings.delayTone);
      setDeckDelayPingPong(deckId, settings.delayPingPong);
      setDeckFractalMix(deckId, settings.fractalMix);
      setDeckFractalStructure(deckId, settings.fractalStructure);
      setDeckFractalDepth(deckId, settings.fractalDepth);
      setDeckFractalDrift(deckId, settings.fractalDrift);
      setDeckFractalDecay(deckId, settings.fractalDecay);
      setDeckFractalTone(deckId, settings.fractalTone);
      setDeckPlaybackRate(deckId, clampPlaybackRate(1 + settings.tempoOffset / 100));
    },
    [
      getFilterTargets,
      setDeckBalance,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelayPingPong,
      setDeckDelayTime,
      setDeckDelayTone,
      setDeckFractalDecay,
      setDeckFractalDepth,
      setDeckFractalDrift,
      setDeckFractalMix,
      setDeckFractalStructure,
      setDeckFractalTone,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckGain,
      setDeckHighpass,
      setDeckPitchShift,
      setDeckPlaybackRate,
      setDeckResonance,
    ]
  );

  const updateAutomationView = useCallback((deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    setAutomationState((prev) => {
      const next = new Map(prev);
      next.set(deckId, {
        gain: toAutomationView(automation.gain),
        djFilter: toAutomationView(automation.djFilter),
        resonance: toAutomationView(automation.resonance),
        eqLow: toAutomationView(automation.eqLow),
        eqMid: toAutomationView(automation.eqMid),
        eqHigh: toAutomationView(automation.eqHigh),
        balance: toAutomationView(automation.balance),
        pitch: toAutomationView(automation.pitch),
      });
      return next;
    });
  }, []);

  const resetAutomation = useCallback(
    (
      deckId: number,
      gainValue: number,
      djFilterValue: number,
      resonanceValue: number,
      eqLowGain: number,
      eqMidGain: number,
      eqHighGain: number,
      balance: number,
      pitchShift: number
    ) => {
      const automation: AutomationDeck = {
        gain: createTrack(gainValue),
        djFilter: createTrack(djFilterValue),
        resonance: createTrack(resonanceValue),
        eqLow: createTrack(eqLowGain),
        eqMid: createTrack(eqMidGain),
        eqHigh: createTrack(eqHighGain),
        balance: createTrack(balance),
        pitch: createTrack(pitchShift),
      };
      automationRef.current.set(deckId, automation);
      automationPlayheadRef.current.set(deckId, {
        gain: 0,
        djFilter: 0,
        resonance: 0,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        balance: 0,
        pitch: 0,
      });
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const applyAutomationSnapshots = useCallback(
    (
      deckId: number,
      snapshots: Record<AutomationParam, AutomationSnapshot>,
      fallbackValues: {
        gain: number;
        djFilter: number;
        resonance: number;
        eqLow: number;
        eqMid: number;
        eqHigh: number;
        balance: number;
        pitch: number;
      }
    ) => {
      const buildTrack = (
        snapshot: AutomationSnapshot | undefined,
        fallbackValue: number
      ): AutomationTrack => {
        const hasSamples = (snapshot?.samples?.length ?? 0) > 0;
        const isActive = snapshot?.active ?? hasSamples;
        return {
        samples: new Float32Array(snapshot?.samples ?? []),
        sampleRate: snapshot?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
        durationSec: snapshot?.durationSec ?? 0,
        recording: false,
        active: isActive,
        paused: isActive,
        pausedPositionSec: 0,
        currentValue: snapshot?.currentValue ?? fallbackValue,
        amplitudeScale: 1,
        lastIndex: -1,
        lastPreviewLength: 0,
        recordBuffer: [],
        recordStartMs: 0,
        lastSampleMs: 0,
        playbackStartMs: 0,
        };
      };

      const automation: AutomationDeck = {
        gain: buildTrack(snapshots.gain, fallbackValues.gain),
        djFilter: buildTrack(snapshots.djFilter, fallbackValues.djFilter),
        resonance: buildTrack(snapshots.resonance, fallbackValues.resonance),
        eqLow: buildTrack(snapshots.eqLow, fallbackValues.eqLow),
        eqMid: buildTrack(snapshots.eqMid, fallbackValues.eqMid),
        eqHigh: buildTrack(snapshots.eqHigh, fallbackValues.eqHigh),
        balance: buildTrack(snapshots.balance, fallbackValues.balance),
        pitch: buildTrack(snapshots.pitch, fallbackValues.pitch),
      };

      automationRef.current.set(deckId, automation);
      automationPlayheadRef.current.set(deckId, {
        gain: 0,
        djFilter: 0,
        resonance: 0,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        balance: 0,
        pitch: 0,
      });
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const buildAutomationPresetSamples = useCallback(
    (
      preset: "sine" | "triangle" | "ramp",
      min: number,
      max: number,
      durationSec: number
    ) => {
      const sampleRate = AUTOMATION_SAMPLE_RATE;
      const length = Math.max(2, Math.round(durationSec * sampleRate));
      const range = max - min || 1;
      const samples = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        const t = length > 1 ? i / (length - 1) : 0;
        let normalized = 0;
        if (preset === "sine") {
          normalized = (Math.sin(t * Math.PI * 2) + 1) * 0.5;
        } else if (preset === "triangle") {
          normalized = t < 0.5 ? t * 2 : 2 - t * 2;
        } else {
          normalized = t;
        }
        samples[i] = clamp(min + normalized * range, min, max);
      }
      return { samples, sampleRate };
    },
    []
  );

  const applyAutomationPreset = useCallback(
    (
      deckId: number,
      param: AutomationParam,
      preset: "sine" | "triangle" | "ramp",
      min: number,
      max: number
    ) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck) return;
      const automation = ensureAutomationDeck(deckId, deck);
      const track = automation[param];
      const duration = track.durationSec > 0 ? track.durationSec : 2;
      const { samples, sampleRate } = buildAutomationPresetSamples(
        preset,
        min,
        max,
        duration
      );
      track.samples = samples;
      track.sampleRate = sampleRate;
      track.durationSec = samples.length / sampleRate;
      track.recording = false;
      track.active = true;
      track.amplitudeScale = 1;
      track.currentValue = samples[0] ?? track.currentValue;
      track.lastIndex = -1;
      track.lastPreviewLength = 0;
      track.recordBuffer = [];
      track.recordStartMs = 0;
      track.lastSampleMs = 0;
      if (deck.status === "playing") {
        track.paused = false;
        track.pausedPositionSec = 0;
        track.playbackStartMs = performance.now();
      } else {
        track.paused = true;
        track.pausedPositionSec = 0;
        track.playbackStartMs = 0;
      }
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [
      buildAutomationPresetSamples,
      decks,
      ensureAutomationDeck,
      updateAutomationTickEnabled,
      updateAutomationView,
    ]
  );

  const adjustAutomationLength = useCallback(
    (deckId: number, param: AutomationParam, factor: number) => {
      const automation = automationRef.current.get(deckId);
      if (!automation) return;
      const track = automation[param];
      if (!track.samples.length || factor <= 0) return;
      const currentDuration = track.durationSec || track.samples.length / track.sampleRate;
      const nextDuration = Math.max(MIN_AUTOMATION_DURATION, currentDuration * factor);
      const nextSampleRate = track.samples.length / nextDuration;
      track.sampleRate = nextSampleRate;
      track.durationSec = track.samples.length / nextSampleRate;
      const playheads = automationPlayheadRef.current.get(deckId);
      const playhead = playheads ? playheads[param] : 0;
      if (track.paused) {
        track.pausedPositionSec = playhead * track.durationSec;
      } else {
        track.playbackStartMs = performance.now() - playhead * track.durationSec * 1000;
      }
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const setAutomationDuration = useCallback(
    (deckId: number, param: AutomationParam, durationSec: number) => {
      const automation = automationRef.current.get(deckId);
      if (!automation) return;
      const track = automation[param];
      if (!track.samples.length || durationSec <= 0) return;
      const nextSampleRate = track.samples.length / durationSec;
      track.sampleRate = nextSampleRate;
      track.durationSec = track.samples.length / nextSampleRate;
      const playheads = automationPlayheadRef.current.get(deckId);
      const playhead = playheads ? playheads[param] : 0;
      if (track.paused) {
        track.pausedPositionSec = playhead * track.durationSec;
      } else {
        track.playbackStartMs = performance.now() - playhead * track.durationSec * 1000;
      }
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const adjustAutomationAmplitude = useCallback(
    (deckId: number, param: AutomationParam, factor: number, min: number, max: number) => {
      const automation = automationRef.current.get(deckId);
      if (!automation) return;
      const track = automation[param];
      if (!track.samples.length || factor <= 0) return;
      const minScale = 1 / 3;
      const nextScale = clamp(track.amplitudeScale * factor, minScale, 1);
      const actualFactor =
        track.amplitudeScale > 0 ? nextScale / track.amplitudeScale : 1;
      if (Math.abs(actualFactor - 1) < 1e-6) {
        return;
      }
      const mid = (min + max) / 2;
      const nextSamples = new Float32Array(track.samples.length);
      for (let i = 0; i < track.samples.length; i += 1) {
        const scaled = mid + (track.samples[i] - mid) * actualFactor;
        nextSamples[i] = clamp(scaled, min, max);
      }
      track.samples = nextSamples;
      track.amplitudeScale = nextScale;
      track.currentValue = nextSamples[0] ?? track.currentValue;
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const invertAutomation = useCallback(
    (deckId: number, param: AutomationParam, min: number, max: number) => {
      const automation = automationRef.current.get(deckId);
      if (!automation) return;
      const track = automation[param];
      if (!track.samples.length) return;
      const mid = (min + max) / 2;
      const nextSamples = new Float32Array(track.samples.length);
      for (let i = 0; i < track.samples.length; i += 1) {
        nextSamples[i] = clamp(mid - (track.samples[i] - mid), min, max);
      }
      track.samples = nextSamples;
      track.currentValue = nextSamples[0] ?? track.currentValue;
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const getDeckPlaybackRate = useCallback(
    (deck: DeckState) => clampPlaybackRate(1 + deck.tempoOffset / 100),
    []
  );

  const getTempoSyncedPitch = useCallback((tempoOffset: number) => {
    const rate = clampPlaybackRate(1 + tempoOffset / 100);
    const semitones = -12 * Math.log2(rate);
    return Math.min(24, Math.max(-24, semitones));
  }, []);

  const historyRef = useRef<{ past: DeckState[][]; future: DeckState[][] }>({
    past: [],
    future: [],
  });
  const loopBoundsHistorySnapshotRef = useRef<Map<number, DeckState[]>>(new Map());
  const historyDisabledRef = useRef(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const historyLimit = 100;

  const snapshotDecks = useCallback(
    (source: DeckState[]) =>
      source.map((deck) => ({
        ...deck,
        startedAtMs: deck.status === "playing" ? undefined : deck.startedAtMs,
      })),
    []
  );

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: historyRef.current.past.length > 0,
      canRedo: historyRef.current.future.length > 0,
    });
  }, []);

  const recordHistory = useCallback(
    (prev: DeckState[]) => {
      const snapshot = snapshotDecks(prev);
      historyRef.current.past.push(snapshot);
      if (historyRef.current.past.length > historyLimit) {
        historyRef.current.past.shift();
      }
      historyRef.current.future = [];
      syncHistoryState();
    },
    [snapshotDecks, syncHistoryState]
  );

  const setDecksWithHistory = useCallback(
    (updater: (prev: DeckState[]) => DeckState[]) => {
      setDecks((prev) => {
        if (!historyDisabledRef.current) {
          recordHistory(prev);
        }
        return updater(prev);
      });
    },
    [recordHistory]
  );

  const setDecksNoHistory = useCallback((updater: (prev: DeckState[]) => DeckState[]) => {
    setDecks((prev) => updater(prev));
  }, []);

  const updateDeck = useCallback(
    (id: number, updates: Partial<DeckState>, record = true) => {
      const setter = record ? setDecksWithHistory : setDecksNoHistory;
      setter((prev) =>
        prev.map((deck) => (deck.id === id ? { ...deck, ...updates } : deck))
      );
    },
    [setDecksNoHistory, setDecksWithHistory]
  );

  useEffect(() => () => {
    loopBoundsHistorySnapshotRef.current.clear();
  }, []);

  const applyDeckSnapshot = useCallback(
    (snapshot: DeckState[]) => {
      historyDisabledRef.current = true;
      snapshot.forEach((deck) => {
        const nextRequest = (loadRequestRef.current.get(deck.id) ?? 0) + 1;
        loadRequestRef.current.set(deck.id, nextRequest);
      });
      const snapshotById = new Map(snapshot.map((deck) => [deck.id, deck]));
      const currentById = new Map(decks.map((deck) => [deck.id, deck]));
      const keepPlayingIds = new Set<number>();
      const restartIds = new Set<number>();
      const restartStartMs = new Map<number, number>();
      decks.forEach((deck) => {
        const target = snapshotById.get(deck.id);
        if (
          deck.status === "playing" &&
          target?.status === "playing"
        ) {
          if (target.buffer) {
            restartIds.add(deck.id);
            restartStartMs.set(deck.id, performance.now());
          }
        } else if (target?.status === "playing" && target.buffer) {
          restartIds.add(deck.id);
          restartStartMs.set(deck.id, performance.now());
        }
      });
      decks.forEach((deck) => {
        if (!keepPlayingIds.has(deck.id)) {
          stop(deck.id);
        }
      });
      playbackStartRef.current.forEach((_, id) => {
        if (!keepPlayingIds.has(id)) {
          playbackStartRef.current.delete(id);
        }
      });
      setDecksNoHistory(() => {
        const base = snapshotDecks(snapshot);
        return base.map((deck) => {
          if (keepPlayingIds.has(deck.id)) {
            const current = currentById.get(deck.id);
            return {
              ...deck,
              status: "playing",
              startedAtMs: current?.startedAtMs,
              offsetSeconds: current?.offsetSeconds,
            };
          }
          if (restartIds.has(deck.id)) {
            const startedAtMs = restartStartMs.get(deck.id);
            const duration = deck.buffer?.duration ?? deck.duration ?? 0;
            let offsetSeconds = deck.offsetSeconds ?? 0;
            if (deck.loopEnabled && deck.loopEndSeconds > deck.loopStartSeconds) {
              const maxOffset = Math.max(
                deck.loopStartSeconds,
                deck.loopEndSeconds - 0.01
              );
              offsetSeconds = Math.min(
                Math.max(offsetSeconds, deck.loopStartSeconds),
                maxOffset
              );
            } else if (duration > 0) {
              offsetSeconds = Math.min(Math.max(offsetSeconds, 0), duration);
            }
            return {
              ...deck,
              status: "playing",
              startedAtMs,
              offsetSeconds,
            };
          }
          if (deck.status === "playing") {
            return {
              ...deck,
              status: "paused",
              startedAtMs: undefined,
            };
          }
          return deck;
        });
      });
      snapshot.forEach((deck) => {
        setDeckGain(deck.id, deck.gain);
        setDeckFilter(deck.id, deck.djFilter);
        setDeckResonance(deck.id, deck.filterResonance);
        setDeckEqLow(deck.id, deck.eqLowGain);
        setDeckEqMid(deck.id, deck.eqMidGain);
        setDeckEqHigh(deck.id, deck.eqHighGain);
        setDeckBalance(deck.id, deck.balance);
        setDeckDelayTime(deck.id, deck.delayTime);
        setDeckDelayFeedback(deck.id, deck.delayFeedback);
        setDeckDelayMix(deck.id, deck.delayMix);
        setDeckDelayTone(deck.id, deck.delayTone);
        setDeckDelayPingPong(deck.id, deck.delayPingPong);
        setDeckFractalMix(deck.id, deck.fractalMix);
        setDeckFractalStructure(deck.id, deck.fractalStructure);
        setDeckFractalDepth(deck.id, deck.fractalDepth);
        setDeckFractalDrift(deck.id, deck.fractalDrift);
        setDeckFractalDecay(deck.id, deck.fractalDecay);
        setDeckFractalTone(deck.id, deck.fractalTone);
        setDeckPitchShift(deck.id, deck.pitchShift);
        setDeckPlaybackRate(deck.id, clampPlaybackRate(1 + deck.tempoOffset / 100));
        setDeckLoopParams(
          deck.id,
          deck.loopEnabled,
          deck.loopStartSeconds,
          deck.loopEndSeconds
        );
      });
      snapshot.forEach((deck) => {
        if (!restartIds.has(deck.id) || !deck.buffer) return;
        const startedAtMs = restartStartMs.get(deck.id) ?? performance.now();
        playbackStartRef.current.set(deck.id, startedAtMs);
        const tempoRatio = clampPlaybackRate(1 + deck.tempoOffset / 100);
        const targets = getFilterTargets(deck.djFilter);
        const duration = deck.buffer.duration;
        let offsetSeconds = deck.offsetSeconds ?? 0;
        if (deck.loopEnabled && deck.loopEndSeconds > deck.loopStartSeconds) {
          const maxOffset = Math.max(deck.loopStartSeconds, deck.loopEndSeconds - 0.01);
          offsetSeconds = Math.min(
            Math.max(offsetSeconds, deck.loopStartSeconds),
            maxOffset
          );
        } else {
          offsetSeconds = Math.min(Math.max(offsetSeconds, 0), duration);
        }
        playBuffer(
          deck.id,
          deck.buffer,
          () => {
            console.info("Deck ended", { deckId: deck.id, loopEnabled: deck.loopEnabled });
            playbackStartRef.current.delete(deck.id);
            updateDeck(
              deck.id,
              { status: "ready", startedAtMs: undefined, offsetSeconds: 0 },
              false
            );
          },
          deck.gain,
          offsetSeconds,
          tempoRatio,
          deck.loopEnabled,
          deck.loopStartSeconds,
          deck.loopEndSeconds,
          targets.lowpass,
          targets.highpass,
          deck.filterResonance,
          deck.eqLowGain,
          deck.eqMidGain,
          deck.eqHighGain,
          deck.delayTime,
          deck.delayFeedback,
          deck.delayMix,
          deck.delayTone,
          deck.delayPingPong,
          deck.balance,
          deck.pitchShift,
          deck.fractalMix,
          deck.fractalStructure,
          deck.fractalDepth,
          deck.fractalDrift,
          deck.fractalDecay,
          deck.fractalTone
        ).catch((error) => {
          console.warn("Undo playback failed", error);
          playbackStartRef.current.delete(deck.id);
          updateDeck(
            deck.id,
            { status: "ready", startedAtMs: undefined, offsetSeconds: 0 },
            false
          );
        });
      });
      historyDisabledRef.current = false;
    },
    [
      decks,
      getFilterTargets,
      playBuffer,
      setDeckBalance,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckGain,
      setDeckDelayTime,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelayTone,
      setDeckDelayPingPong,
      setDeckFractalDecay,
      setDeckFractalDepth,
      setDeckFractalDrift,
      setDeckFractalMix,
      setDeckFractalStructure,
      setDeckFractalTone,
      setDeckPitchShift,
      setDeckPlaybackRate,
      setDeckResonance,
      setDeckLoopParams,
      setDecksNoHistory,
      snapshotDecks,
      stop,
      updateDeck,
    ]
  );

  const undo = useCallback(() => {
    const past = historyRef.current.past;
    if (past.length === 0) return;
    loopBoundsHistorySnapshotRef.current.clear();
    const current = snapshotDecks(decks);
    const previous = past.pop();
    if (!previous) return;
    historyRef.current.future.push(current);
    applyDeckSnapshot(previous);
    syncHistoryState();
  }, [applyDeckSnapshot, decks, snapshotDecks, syncHistoryState]);

  const redo = useCallback(() => {
    const future = historyRef.current.future;
    if (future.length === 0) return;
    loopBoundsHistorySnapshotRef.current.clear();
    const current = snapshotDecks(decks);
    const next = future.pop();
    if (!next) return;
    historyRef.current.past.push(current);
    applyDeckSnapshot(next);
    syncHistoryState();
  }, [applyDeckSnapshot, decks, snapshotDecks, syncHistoryState]);

  const setDeckBalanceValue = useCallback(
    (id: number, value: number) => {
      const clamped = Math.min(Math.max(value, -1), 1);
      setDeckBalance(id, clamped);
      updateDeck(id, { balance: clamped }, false);
      const automation = automationRef.current.get(id);
      const track = automation?.balance;
      if (track && track.active && !track.recording) {
        track.active = false;
        track.playbackStartMs = 0;
        updateAutomationView(id);
      }
      updateAutomationTickEnabled();
    },
    [setDeckBalance, updateDeck, updateAutomationTickEnabled, updateAutomationView]
  );

  useEffect(() => {
    if (!automationTickEnabled) return;
    const intervalMs = 1000 / AUTOMATION_SAMPLE_RATE;
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const automation = automationRef.current;
      if (automation.size === 0) return;
      automation.forEach((tracks, deckId) => {
        let hasActive = false;
        let shouldUpdateView = false;
        (Object.keys(tracks) as AutomationParam[]).forEach((param) => {
          const track = tracks[param];
          if (track.recording || (track.active && track.durationSec > 0)) {
            hasActive = true;
          }
          if (track.paused && track.active && !track.recording) {
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] =
                track.durationSec > 0 ? track.pausedPositionSec / track.durationSec : 0;
            }
            return;
          }
          if (track.recording) {
            const interval = 1000 / track.sampleRate;
            while (now - track.lastSampleMs >= interval) {
              track.recordBuffer.push(track.currentValue);
              track.lastSampleMs += interval;
              track.durationSec = track.recordBuffer.length / track.sampleRate;
            }
            if (track.recordBuffer.length !== track.lastPreviewLength) {
              shouldUpdateView = true;
            }
          }
          if (!track.recording && track.active && track.durationSec > 0) {
            const elapsedSec = (now - track.playbackStartMs) / 1000;
            const positionSec = elapsedSec % track.durationSec;
            const index = Math.min(
              track.samples.length - 1,
              Math.floor(positionSec * track.sampleRate)
            );
            const value = track.samples[index] ?? track.currentValue;
            track.currentValue = value;
            if (param === "djFilter") {
              const targets = getFilterTargets(value);
              setDeckFilter(deckId, targets.lowpass);
              setDeckHighpass(deckId, targets.highpass);
            } else if (param === "gain") {
              setDeckGain(deckId, value);
            } else if (param === "resonance") {
              setDeckResonance(deckId, value);
            } else if (param === "eqLow") {
              setDeckEqLow(deckId, value);
            } else if (param === "eqMid") {
              setDeckEqMid(deckId, value);
            } else if (param === "eqHigh") {
              setDeckEqHigh(deckId, value);
            } else if (param === "balance") {
              setDeckBalance(deckId, value);
            } else if (param === "pitch") {
              setDeckPitchShift(deckId, value);
            } else {
              setDeckResonance(deckId, value);
            }
            if (index !== track.lastIndex) {
              track.lastIndex = index;
              shouldUpdateView = true;
            }
            const playhead = positionSec / track.durationSec;
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] = playhead;
            }
          }
          if (!track.active || track.durationSec <= 0) {
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] = 0;
            }
          }
        });
        if (shouldUpdateView) {
          const lastUpdate = automationUiUpdateRef.current.get(deckId) ?? 0;
          if (now - lastUpdate >= AUTOMATION_UI_INTERVAL_MS) {
            automationUiUpdateRef.current.set(deckId, now);
            (Object.values(tracks) as AutomationTrack[]).forEach((track) => {
              if (track.recording) {
                track.lastPreviewLength = track.recordBuffer.length;
              }
            });
            updateAutomationView(deckId);
          }
        }
        if (!hasActive) {
          const playheads = automationPlayheadRef.current.get(deckId);
          if (playheads) {
            (Object.keys(playheads) as AutomationParam[]).forEach((param) => {
              playheads[param] = 0;
            });
          }
        }
      });
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    automationTickEnabled,
    getFilterTargets,
    setDeckFilter,
    setDeckHighpass,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckGain,
    setDeckBalance,
    setDeckPitchShift,
    updateAutomationView,
  ]);

  useEffect(() => {
    const seen = new Set<number>();
    decks.forEach((deck) => {
      seen.add(deck.id);
      const targetRate = getDeckPlaybackRate(deck);
      const prevRate = playbackRateRef.current.get(deck.id);
      if (prevRate === undefined) {
        playbackRateRef.current.set(deck.id, targetRate);
        return;
      }
      if (prevRate !== targetRate) {
        playbackRateRef.current.set(deck.id, targetRate);
        setDeckPlaybackRate(deck.id, targetRate);
      }
    });

    Array.from(playbackRateRef.current.keys()).forEach((deckId) => {
      if (!seen.has(deckId)) {
        playbackRateRef.current.delete(deckId);
      }
    });
  }, [decks, getDeckPlaybackRate, setDeckPlaybackRate]);

  const pitchSyncExpectedRef = useRef(new Map<number, number>());

  useEffect(() => {
    const seen = new Set<number>();
    decks.forEach((deck) => {
      seen.add(deck.id);
      if (!deck.tempoPitchSync) {
        pitchSyncExpectedRef.current.delete(deck.id);
        return;
      }
      const expected = getTempoSyncedPitch(deck.tempoOffset);
      const last = pitchSyncExpectedRef.current.get(deck.id);
      if (last === expected && deck.pitchShift === expected) return;
      pitchSyncExpectedRef.current.set(deck.id, expected);
      if (deck.pitchShift !== expected) {
        updateDeck(deck.id, { pitchShift: expected }, false);
      }
      setDeckPitchShift(deck.id, expected);
    });
    Array.from(pitchSyncExpectedRef.current.keys()).forEach((deckId) => {
      if (!seen.has(deckId)) {
        pitchSyncExpectedRef.current.delete(deckId);
      }
    });
  }, [decks, getTempoSyncedPitch, setDeckPitchShift, updateDeck]);

  const addDeck = () => {
    const id = nextDeckId.current;
    nextDeckId.current += 1;
    resetAutomation(id, 0.9, 0, DEFAULT_RESONANCE, 0, 0, 0, 0, 0);
    setDecksWithHistory((prev) => [
      ...prev,
      {
        id,
        status: "idle",
        gain: 0.9,
        djFilter: 0,
        filterResonance: 0,
        eqLowGain: 0,
        eqMidGain: 0,
        eqHighGain: 0,
        balance: 0,
        pitchShift: 0,
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
        fractalMix: DEFAULT_FRACTAL_MIX,
        fractalStructure: DEFAULT_FRACTAL_STRUCTURE,
        fractalDepth: DEFAULT_FRACTAL_DEPTH,
        fractalDrift: DEFAULT_FRACTAL_DRIFT,
        fractalDecay: DEFAULT_FRACTAL_DECAY,
        fractalTone: DEFAULT_FRACTAL_TONE,
        rearrangerSlices: DEFAULT_REARRANGER_SLICES,
        rearrangerOffset: DEFAULT_REARRANGER_OFFSET,
        rearrangerChaos: DEFAULT_REARRANGER_CHAOS,
        rearrangerReverse: DEFAULT_REARRANGER_REVERSE,
        rearrangerSensitivity: DEFAULT_REARRANGER_SENSITIVITY,
        rearrangerQuietThreshold: DEFAULT_REARRANGER_QUIET_THRESHOLD,
        rearrangerAuto: DEFAULT_REARRANGER_AUTO,
        rearrangerRegionsManual: false,
        fxPanelOpen: withDefaultFxPanelOpen(),
      },
    ]);
  };

  const removeDeck = (id: number) => {
    setDecksWithHistory((prev) => {
      stop(id);
      removeDeckNodes(id);
      playbackStartRef.current.delete(id);
      automationRef.current.delete(id);
      automationPlayheadRef.current.delete(id);
      setAutomationState((state) => {
        const next = new Map(state);
        next.delete(id);
        return next;
      });
      if (prev.length <= 1) {
        return [
          {
            id,
            status: "idle",
            gain: 0.9,
            djFilter: 0,
            filterResonance: 0,
            eqLowGain: 0,
            eqMidGain: 0,
            eqHighGain: 0,
            balance: 0,
            pitchShift: 0,
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
            fractalMix: DEFAULT_FRACTAL_MIX,
            fractalStructure: DEFAULT_FRACTAL_STRUCTURE,
            fractalDepth: DEFAULT_FRACTAL_DEPTH,
            fractalDrift: DEFAULT_FRACTAL_DRIFT,
            fractalDecay: DEFAULT_FRACTAL_DECAY,
            fractalTone: DEFAULT_FRACTAL_TONE,
            rearrangerSlices: DEFAULT_REARRANGER_SLICES,
            rearrangerOffset: DEFAULT_REARRANGER_OFFSET,
            rearrangerChaos: DEFAULT_REARRANGER_CHAOS,
            rearrangerReverse: DEFAULT_REARRANGER_REVERSE,
            rearrangerSensitivity: DEFAULT_REARRANGER_SENSITIVITY,
            rearrangerQuietThreshold: DEFAULT_REARRANGER_QUIET_THRESHOLD,
            rearrangerAuto: DEFAULT_REARRANGER_AUTO,
            rearrangerRegionsManual: false,
            fxPanelOpen: withDefaultFxPanelOpen(),
          },
        ];
      }
      return prev.filter((deck) => deck.id !== id);
    });
  };

  const setFileInputRef = (id: number, node: HTMLInputElement | null) => {
    fileInputRefs.current.set(id, node);
  };

  const handleLoadClick = (id: number) => {
    fileInputRefs.current.get(id)?.click();
  };

  const handleFileSelected = async (
    id: number,
    file: File | null,
    options?: {
      gain?: number;
      pitchShift?: number;
      balance?: number;
      tempoOffset?: number;
      settings?: ClipSettings;
    }
  ) => {
    if (!file) return;

    const requestId = (loadRequestRef.current.get(id) ?? 0) + 1;
    loadRequestRef.current.set(id, requestId);
    const currentDeck = decks.find((deck) => deck.id === id);
    const wasPlaying = currentDeck?.status === "playing";
    const clipSettings = options?.settings;
    const nextGain = clipSettings?.gain ?? options?.gain ?? 0.9;
    const nextPitchShift = clipSettings?.pitchShift ?? options?.pitchShift ?? 0;
    const nextBalance = clipSettings?.balance ?? options?.balance ?? 0;
    const nextTempoOffset = clipSettings?.tempoOffset ?? options?.tempoOffset ?? 0;
    const nextDjFilter = clipSettings?.djFilter ?? 0;
    const nextResonance = clipSettings?.filterResonance ?? DEFAULT_RESONANCE;
    const nextEqLow = clipSettings?.eqLowGain ?? 0;
    const nextEqMid = clipSettings?.eqMidGain ?? 0;
    const nextEqHigh = clipSettings?.eqHighGain ?? 0;
    const nextTempoPitchSync = clipSettings?.tempoPitchSync ?? false;
    const nextStretchRatio = clipSettings?.stretchRatio ?? DEFAULT_STRETCH_RATIO;
    const nextStretchWindowSize =
      clipSettings?.stretchWindowSize ?? DEFAULT_STRETCH_WINDOW_SIZE;
    const nextStretchStereoWidth =
      clipSettings?.stretchStereoWidth ?? DEFAULT_STRETCH_STEREO_WIDTH;
    const nextStretchPhaseRandomness =
      clipSettings?.stretchPhaseRandomness ?? DEFAULT_STRETCH_PHASE_RANDOMNESS;
    const nextStretchTiltDb = clipSettings?.stretchTiltDb ?? DEFAULT_STRETCH_TILT_DB;
    const nextStretchScatter = clipSettings?.stretchScatter ?? DEFAULT_STRETCH_SCATTER;
    const nextDelayTime = clipSettings?.delayTime ?? DEFAULT_DELAY_TIME;
    const nextDelayFeedback = clipSettings?.delayFeedback ?? DEFAULT_DELAY_FEEDBACK;
    const nextDelayMix = clipSettings?.delayMix ?? DEFAULT_DELAY_MIX;
    const nextDelayTone = clipSettings?.delayTone ?? DEFAULT_DELAY_TONE;
    const nextDelayPingPong = clipSettings?.delayPingPong ?? DEFAULT_DELAY_PINGPONG;
    const nextDelaySliceSync = clipSettings?.delaySliceSync ?? DEFAULT_DELAY_SLICE_SYNC;
    const nextFractalMix = clipSettings?.fractalMix ?? DEFAULT_FRACTAL_MIX;
    const nextFractalStructure = clipSettings?.fractalStructure ?? DEFAULT_FRACTAL_STRUCTURE;
    const nextFractalDepth = clipSettings?.fractalDepth ?? DEFAULT_FRACTAL_DEPTH;
    const nextFractalDrift = clipSettings?.fractalDrift ?? DEFAULT_FRACTAL_DRIFT;
    const nextFractalDecay = clipSettings?.fractalDecay ?? DEFAULT_FRACTAL_DECAY;
    const nextFractalTone = clipSettings?.fractalTone ?? DEFAULT_FRACTAL_TONE;
    const nextRearrangerSlices = Math.max(
      0,
      Math.min(MAX_REARRANGER_SLICES, Math.round(clipSettings?.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES))
    );
    const nextRearrangerOffset = Math.max(
      -32,
      Math.min(32, Math.round(clipSettings?.rearrangerOffset ?? DEFAULT_REARRANGER_OFFSET))
    );
    const nextRearrangerChaos = Math.max(
      0,
      Math.min(1, clipSettings?.rearrangerChaos ?? DEFAULT_REARRANGER_CHAOS)
    );
    const nextRearrangerReverse = Math.max(
      0,
      Math.min(1, clipSettings?.rearrangerReverse ?? DEFAULT_REARRANGER_REVERSE)
    );
    const nextRearrangerSensitivity = Math.max(
      0,
      Math.min(1, clipSettings?.rearrangerSensitivity ?? DEFAULT_REARRANGER_SENSITIVITY)
    );
    const nextRearrangerQuietThreshold = Math.max(
      0,
      Math.min(
        1,
        clipSettings?.rearrangerQuietThreshold ?? DEFAULT_REARRANGER_QUIET_THRESHOLD
      )
    );
    const nextRearrangerAuto = clipSettings?.rearrangerAuto ?? DEFAULT_REARRANGER_AUTO;
    const nextRearrangerRegions = sanitizeRearrangerRegions(clipSettings?.rearrangerRegions);
    const nextRearrangerRegionIds = normalizeRearrangerRegionIds(
      clipSettings?.rearrangerRegionIds,
      nextRearrangerSlices
    );
    const nextRearrangerRegionsManual = clipSettings?.rearrangerRegionsManual ?? false;
    const nextFxPanelOpen = (() => {
      const currentPanels = withDefaultFxPanelOpen(currentDeck?.fxPanelOpen);
      if (!clipSettings) return currentPanels;
      const automation = clipSettings.automation;
      const hasActiveAutomation = (param: AutomationParam) => automation?.[param]?.active === true;
      const stretchChanged =
        !approxEqual(nextStretchRatio, DEFAULT_STRETCH_RATIO) ||
        nextStretchWindowSize !== DEFAULT_STRETCH_WINDOW_SIZE ||
        !approxEqual(nextStretchStereoWidth, DEFAULT_STRETCH_STEREO_WIDTH) ||
        !approxEqual(nextStretchPhaseRandomness, DEFAULT_STRETCH_PHASE_RANDOMNESS) ||
        !approxEqual(nextStretchTiltDb, DEFAULT_STRETCH_TILT_DB) ||
        !approxEqual(nextStretchScatter, DEFAULT_STRETCH_SCATTER);

      return {
        ...currentPanels,
        djFilter: currentPanels.djFilter || !approxEqual(nextDjFilter, 0) || hasActiveAutomation("djFilter"),
        resonance:
          currentPanels.resonance ||
          !approxEqual(nextResonance, 0) ||
          hasActiveAutomation("resonance"),
        eqLow: currentPanels.eqLow || !approxEqual(nextEqLow, 0) || hasActiveAutomation("eqLow"),
        eqMid: currentPanels.eqMid || !approxEqual(nextEqMid, 0) || hasActiveAutomation("eqMid"),
        eqHigh: currentPanels.eqHigh || !approxEqual(nextEqHigh, 0) || hasActiveAutomation("eqHigh"),
        balance:
          currentPanels.balance || !approxEqual(nextBalance, 0) || hasActiveAutomation("balance"),
        pitch: currentPanels.pitch || !approxEqual(nextPitchShift, 0) || hasActiveAutomation("pitch"),
        delay:
          currentPanels.delay ||
          nextDelayMix > FX_ACTIVE_EPSILON ||
          nextDelaySliceSync,
        fractal: currentPanels.fractal || nextFractalMix > FX_ACTIVE_EPSILON,
        rearranger:
          currentPanels.rearranger ||
          nextRearrangerAuto ||
          nextRearrangerSlices !== DEFAULT_REARRANGER_SLICES ||
          !approxEqual(nextRearrangerOffset, DEFAULT_REARRANGER_OFFSET) ||
          nextRearrangerChaos > FX_ACTIVE_EPSILON ||
          nextRearrangerReverse > FX_ACTIVE_EPSILON ||
          !approxEqual(nextRearrangerSensitivity, DEFAULT_REARRANGER_SENSITIVITY) ||
          !approxEqual(
            nextRearrangerQuietThreshold,
            DEFAULT_REARRANGER_QUIET_THRESHOLD
          ) ||
          (nextRearrangerRegions?.length ?? 0) > 0,
        stretch: currentPanels.stretch || stretchChanged,
      };
    })();
    applyDeckSettingsToEngine(id, {
      gain: nextGain,
      djFilter: nextDjFilter,
      filterResonance: nextResonance,
      eqLowGain: nextEqLow,
      eqMidGain: nextEqMid,
      eqHighGain: nextEqHigh,
      balance: nextBalance,
      pitchShift: nextPitchShift,
      tempoOffset: nextTempoOffset,
      delayTime: nextDelayTime,
      delayFeedback: nextDelayFeedback,
      delayMix: nextDelayMix,
      delayTone: nextDelayTone,
      delayPingPong: nextDelayPingPong,
      delaySliceSync: nextDelaySliceSync,
      fractalMix: nextFractalMix,
      fractalStructure: nextFractalStructure,
      fractalDepth: nextFractalDepth,
      fractalDrift: nextFractalDrift,
      fractalDecay: nextFractalDecay,
      fractalTone: nextFractalTone,
    });
    if (wasPlaying) {
      stop(id);
      playbackStartRef.current.delete(id);
    }
    if (clipSettings?.automation) {
      applyAutomationSnapshots(id, clipSettings.automation, {
        gain: nextGain,
        djFilter: nextDjFilter,
        resonance: nextResonance,
        eqLow: nextEqLow,
        eqMid: nextEqMid,
        eqHigh: nextEqHigh,
        balance: nextBalance,
        pitch: nextPitchShift,
      });
    } else {
      resetAutomation(
        id,
        nextGain,
        nextDjFilter,
        nextResonance,
        nextEqLow,
        nextEqMid,
        nextEqHigh,
        nextBalance,
        nextPitchShift
      );
    }
    updateDeck(id, {
      status: "loading",
      fileName: file.name,
      gain: nextGain,
      startedAtMs: undefined,
      offsetSeconds: 0,
      djFilter: nextDjFilter,
      filterResonance: nextResonance,
      eqLowGain: nextEqLow,
      eqMidGain: nextEqMid,
      eqHighGain: nextEqHigh,
      balance: nextBalance,
      pitchShift: nextPitchShift,
      zoom: 1,
      loopEnabled: clipSettings?.loopEnabled ?? true,
      loopStartSeconds: clipSettings?.loopStartSeconds ?? 0,
      loopEndSeconds: clipSettings?.loopEndSeconds ?? 0,
      tempoOffset: nextTempoOffset,
      tempoPitchSync: nextTempoPitchSync,
      stretchRatio: nextStretchRatio,
      stretchWindowSize: nextStretchWindowSize,
      stretchStereoWidth: nextStretchStereoWidth,
      stretchPhaseRandomness: nextStretchPhaseRandomness,
      stretchTiltDb: nextStretchTiltDb,
      stretchScatter: nextStretchScatter,
      delayTime: nextDelayTime,
      delayFeedback: nextDelayFeedback,
      delayMix: nextDelayMix,
      delayTone: nextDelayTone,
      delayPingPong: nextDelayPingPong,
      delaySliceSync: nextDelaySliceSync,
      fractalMix: nextFractalMix,
      fractalStructure: nextFractalStructure,
      fractalDepth: nextFractalDepth,
      fractalDrift: nextFractalDrift,
      fractalDecay: nextFractalDecay,
      fractalTone: nextFractalTone,
      rearrangerSlices: nextRearrangerSlices,
      rearrangerOffset: nextRearrangerOffset,
      rearrangerChaos: nextRearrangerChaos,
      rearrangerReverse: nextRearrangerReverse,
      rearrangerSensitivity: nextRearrangerSensitivity,
      rearrangerQuietThreshold: nextRearrangerQuietThreshold,
      rearrangerAuto: nextRearrangerAuto,
      rearrangerRegions: nextRearrangerRegions,
      rearrangerRegionIds: nextRearrangerRegionIds,
      rearrangerRegionsManual: nextRearrangerRegionsManual,
      fxPanelOpen: nextFxPanelOpen,
    }, true);
    setDeckPitchShift(id, nextPitchShift);
    setDeckBalance(id, nextBalance);
    setDeckDelayTime(id, nextDelayTime);
    setDeckDelayFeedback(id, nextDelayFeedback);
    setDeckDelayMix(id, nextDelayMix);
    setDeckDelayTone(id, nextDelayTone);
    setDeckDelayPingPong(id, nextDelayPingPong);
    setDeckFractalMix(id, nextFractalMix);
    setDeckFractalStructure(id, nextFractalStructure);
    setDeckFractalDepth(id, nextFractalDepth);
    setDeckFractalDrift(id, nextFractalDrift);
    setDeckFractalDecay(id, nextFractalDecay);
    setDeckFractalTone(id, nextFractalTone);
    try {
      const buffer = await decodeFile(file);
      if (loadRequestRef.current.get(id) !== requestId) return;
      const duration = Number.isFinite(buffer.duration)
        ? buffer.duration
        : buffer.length / buffer.sampleRate;
      const loopStart = clipSettings?.loopStartSeconds ?? 0;
      const loopEnd = duration
        ? Math.min(Math.max(loopStart + 0.01, clipSettings?.loopEndSeconds ?? duration), duration)
        : clipSettings?.loopEndSeconds ?? duration;
      const baseDeck = {
        buffer,
        duration,
        gain: nextGain,
        offsetSeconds: 0,
        djFilter: nextDjFilter,
        filterResonance: nextResonance,
        eqLowGain: nextEqLow,
        eqMidGain: nextEqMid,
        eqHighGain: nextEqHigh,
        balance: nextBalance,
        pitchShift: nextPitchShift,
        zoom: 1,
        loopEnabled: clipSettings?.loopEnabled ?? true,
        loopStartSeconds: loopStart,
        loopEndSeconds: loopEnd,
        tempoOffset: nextTempoOffset,
        tempoPitchSync: nextTempoPitchSync,
        stretchRatio: nextStretchRatio,
        stretchWindowSize: nextStretchWindowSize,
        stretchStereoWidth: nextStretchStereoWidth,
        stretchPhaseRandomness: nextStretchPhaseRandomness,
        stretchTiltDb: nextStretchTiltDb,
        stretchScatter: nextStretchScatter,
        delayTime: nextDelayTime,
        delayFeedback: nextDelayFeedback,
        delayMix: nextDelayMix,
        delayTone: nextDelayTone,
        delayPingPong: nextDelayPingPong,
        delaySliceSync: nextDelaySliceSync,
        fractalMix: nextFractalMix,
        fractalStructure: nextFractalStructure,
        fractalDepth: nextFractalDepth,
        fractalDrift: nextFractalDrift,
        fractalDecay: nextFractalDecay,
        fractalTone: nextFractalTone,
        rearrangerSlices: nextRearrangerSlices,
        rearrangerOffset: nextRearrangerOffset,
        rearrangerChaos: nextRearrangerChaos,
        rearrangerReverse: nextRearrangerReverse,
        rearrangerSensitivity: nextRearrangerSensitivity,
        rearrangerQuietThreshold: nextRearrangerQuietThreshold,
        rearrangerAuto: nextRearrangerAuto,
        rearrangerRegions: nextRearrangerRegions,
        rearrangerRegionIds: nextRearrangerRegionIds,
        rearrangerRegionsManual: nextRearrangerRegionsManual,
        fxPanelOpen: nextFxPanelOpen,
      };
      if (wasPlaying) {
        const startedAtMs = performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        updateDeck(id, {
          ...baseDeck,
          status: "playing",
          startedAtMs,
        }, false);
        const filters = getFilterTargets(nextDjFilter);
        const gain = nextGain;
        const tempoRatio = clampPlaybackRate(1 + nextTempoOffset / 100);
        void playBuffer(
          id,
          buffer,
          () => {
            console.info("Deck ended", { deckId: id, loopEnabled: true });
            playbackStartRef.current.delete(id);
            updateDeck(id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
          gain,
          0,
          tempoRatio,
          baseDeck.loopEnabled,
          baseDeck.loopStartSeconds,
          baseDeck.loopEndSeconds,
          filters.lowpass,
          filters.highpass,
          nextResonance,
          nextEqLow,
          nextEqMid,
          nextEqHigh,
          nextDelayTime,
          nextDelayFeedback,
          nextDelayMix,
          nextDelayTone,
          nextDelayPingPong,
          nextBalance,
          nextPitchShift,
          nextFractalMix,
          nextFractalStructure,
          nextFractalDepth,
          nextFractalDrift,
          nextFractalDecay,
          nextFractalTone
        );
      } else {
        updateDeck(id, {
          ...baseDeck,
          status: "ready",
        }, false);
      }
    } catch (error) {
      if (loadRequestRef.current.get(id) !== requestId) return;
      updateDeck(id, { status: "error" }, false);
      console.error("Failed to decode audio", error);
    }
  };

  const playDeck = async (deck: DeckState) => {
    if (!deck.buffer) return;
    stop(deck.id);
    let offsetSeconds = deck.offsetSeconds ?? 0;
    if (deck.loopEnabled && deck.loopEndSeconds > deck.loopStartSeconds) {
      const maxOffset = Math.max(deck.loopStartSeconds, deck.loopEndSeconds - 0.01);
      offsetSeconds = Math.min(Math.max(offsetSeconds, deck.loopStartSeconds), maxOffset);
    }
    // eslint-disable-next-line react-hooks/purity -- timestamp is captured during user action
    const startedAtMs = performance.now();
    playbackStartRef.current.set(deck.id, startedAtMs);
    resumeAutomationDeck(deck.id);
    updateDeck(deck.id, {
      status: "playing",
      startedAtMs,
      duration: deck.buffer.duration,
      offsetSeconds,
    }, false);
    const tempoRatio = getDeckPlaybackRate(deck);
    const filters = getFilterTargets(deck.djFilter);
    await playBuffer(
      deck.id,
      deck.buffer,
      () => {
        console.info("Deck ended", { deckId: deck.id, loopEnabled: deck.loopEnabled });
        playbackStartRef.current.delete(deck.id);
        updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
      },
      deck.gain,
      offsetSeconds,
      tempoRatio,
      deck.loopEnabled,
      deck.loopStartSeconds,
      deck.loopEndSeconds,
      filters.lowpass,
      filters.highpass,
      deck.filterResonance,
      deck.eqLowGain,
      deck.eqMidGain,
      deck.eqHighGain,
      deck.delayTime,
      deck.delayFeedback,
      deck.delayMix,
      deck.delayTone,
      deck.delayPingPong,
      deck.balance,
      deck.pitchShift,
      deck.fractalMix,
      deck.fractalStructure,
      deck.fractalDepth,
      deck.fractalDrift,
      deck.fractalDecay,
      deck.fractalTone
    );
    if (deck.status === "paused") {
      resumeAutomationDeck(deck.id);
    }
  };

  const pauseAutomationDeck = (deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    const now = performance.now();
    (Object.keys(automation) as AutomationParam[]).forEach((param) => {
      const track = automation[param];
      if (!track.active || track.recording || track.durationSec <= 0) {
        return;
      }
      const elapsedSec = (now - track.playbackStartMs) / 1000;
      const positionSec = elapsedSec % track.durationSec;
      track.paused = true;
      track.pausedPositionSec = positionSec;
      track.playbackStartMs = 0;
      const playheads = automationPlayheadRef.current.get(deckId);
      if (playheads) {
        playheads[param] = positionSec / track.durationSec;
      }
    });
    updateAutomationView(deckId);
  };

  const resumeAutomationDeck = (deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    const now = performance.now();
    (Object.keys(automation) as AutomationParam[]).forEach((param) => {
      const track = automation[param];
      if (!track.paused || !track.active || track.durationSec <= 0) {
        track.paused = false;
        track.pausedPositionSec = 0;
        return;
      }
      track.playbackStartMs = now - track.pausedPositionSec * 1000;
      track.paused = false;
      track.pausedPositionSec = 0;
    });
    updateAutomationView(deckId);
  };

  const pauseDeck = (deck: DeckState) => {
    if (deck.status !== "playing") return;
    const position = getDeckPosition(deck.id);
    const duration = deck.duration ?? deck.buffer?.duration ?? 0;
    const offsetSeconds =
      position !== null ? Math.min(Math.max(0, position), duration) : deck.offsetSeconds ?? 0;

    stop(deck.id);
    playbackStartRef.current.delete(deck.id);
    pauseAutomationDeck(deck.id);
    updateDeck(deck.id, {
      status: "paused",
      startedAtMs: undefined,
      offsetSeconds,
    }, false);
  };

  const stopDeck = (deck: DeckState) => {
    stop(deck.id);
    playbackStartRef.current.delete(deck.id);
    pauseAutomationDeck(deck.id);
    const nextStatus: DeckStatus = deck.buffer ? "ready" : "idle";
    updateDeck(
      deck.id,
      {
        status: nextStatus,
        startedAtMs: undefined,
        offsetSeconds: 0,
      },
      false
    );
    setDeckPlaybackOffset(deck.id, 0);
  };

  const seekDeck = (id: number, progress: number) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck || !deck.duration || !deck.buffer) return;

    const clamped = Math.min(Math.max(0, progress), 1);
    const offsetSeconds = clamped * deck.duration;

    if (deck.status === "playing") {
      updateDeck(id, {
        startedAtMs: performance.now(),
        offsetSeconds,
        status: "playing",
      }, false);
      const tempoRatio = getDeckPlaybackRate(deck);
      const filters = getFilterTargets(deck.djFilter);
      void playBuffer(
        deck.id,
        deck.buffer,
        () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false),
        deck.gain,
        offsetSeconds,
        tempoRatio,
        deck.loopEnabled,
        deck.loopStartSeconds,
        deck.loopEndSeconds,
        filters.lowpass,
        filters.highpass,
        deck.filterResonance,
        deck.eqLowGain,
        deck.eqMidGain,
        deck.eqHighGain,
        deck.delayTime,
        deck.delayFeedback,
        deck.delayMix,
        deck.delayTone,
        deck.delayPingPong,
        deck.balance,
        deck.pitchShift,
        deck.fractalMix,
        deck.fractalStructure,
        deck.fractalDepth,
        deck.fractalDrift,
        deck.fractalDecay,
        deck.fractalTone
      );
      return;
    }

    updateDeck(id, { offsetSeconds }, false);
    setDeckPlaybackOffset(id, offsetSeconds);
  };

  const setDeckGainValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1.5);
    setDeckGain(id, clamped);
    updateDeck(id, { gain: clamped }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.gain;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckFilterValue = (id: number, value: number) => {
    const targets = getFilterTargets(value);
    setDeckFilter(id, targets.lowpass);
    setDeckHighpass(id, targets.highpass);
    updateDeck(id, { djFilter: clamp(value, -1, 1) }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.djFilter;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckResonanceValue = (id: number, value: number) => {
    setDeckResonance(id, value);
    updateDeck(id, { filterResonance: value }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.resonance;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckEqLowValue = (id: number, value: number) => {
    const clamped = clamp(value, -EQ_MAX_DB, EQ_MAX_DB);
    setDeckEqLow(id, clamped);
    updateDeck(id, { eqLowGain: clamped }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.eqLow;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckEqMidValue = (id: number, value: number) => {
    const clamped = clamp(value, -EQ_MAX_DB, EQ_MAX_DB);
    setDeckEqMid(id, clamped);
    updateDeck(id, { eqMidGain: clamped }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.eqMid;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckEqHighValue = (id: number, value: number) => {
    const clamped = clamp(value, -EQ_MAX_DB, EQ_MAX_DB);
    setDeckEqHigh(id, clamped);
    updateDeck(id, { eqHighGain: clamped }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.eqHigh;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckPitchShiftValue = (id: number, value: number) => {
    const deck = decks.find((item) => item.id === id);
    if (deck?.tempoPitchSync) return;
    const clamped = Math.min(Math.max(value, -24), 24);
    setDeckPitchShift(id, clamped);
    updateDeck(id, { pitchShift: clamped }, false);
    const automation = automationRef.current.get(id);
    const track = automation?.pitch;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckDelayTimeValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0.01), 1.5);
    setDeckDelayTime(id, clamped);
    updateDeck(id, { delayTime: clamped }, false);
  };

  const setDeckDelayFeedbackValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 0.95);
    setDeckDelayFeedback(id, clamped);
    updateDeck(id, { delayFeedback: clamped }, false);
  };

  const setDeckDelayMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayMix(id, clamped);
    updateDeck(id, { delayMix: clamped }, false);
  };

  const setDeckDelayToneValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 400), 12000);
    setDeckDelayTone(id, clamped);
    updateDeck(id, { delayTone: clamped }, false);
  };

  const setDeckDelayPingPongValue = (id: number, value: boolean) => {
    setDeckDelayPingPong(id, value);
    updateDeck(id, { delayPingPong: value }, false);
  };

  const setDeckDelaySliceSyncValue = (id: number, value: boolean) => {
    updateDeck(id, { delaySliceSync: value }, false);
  };

  const setDeckDelayTimeTransient = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0.01), 1.5);
    setDeckDelayTime(id, clamped);
  };

  const setDeckFractalMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckFractalMix(id, clamped);
    updateDeck(id, { fractalMix: clamped }, false);
  };

  const setDeckFractalStructureValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckFractalStructure(id, clamped);
    updateDeck(id, { fractalStructure: clamped }, false);
  };

  const setDeckFractalDepthValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckFractalDepth(id, clamped);
    updateDeck(id, { fractalDepth: clamped }, false);
  };

  const setDeckFractalDriftValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckFractalDrift(id, clamped);
    updateDeck(id, { fractalDrift: clamped }, false);
  };

  const setDeckFractalDecayValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 0.96);
    setDeckFractalDecay(id, clamped);
    updateDeck(id, { fractalDecay: clamped }, false);
  };

  const setDeckFractalToneValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 300), 14000);
    setDeckFractalTone(id, clamped);
    updateDeck(id, { fractalTone: clamped }, false);
  };


  const startAutomationRecording = (id: number, param: AutomationParam) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck) return;
    if (param === "pitch" && deck.tempoPitchSync) return;
    const automation = ensureAutomationDeck(id, deck);
    const track = automation[param];
      track.recording = true;
      track.active = true;
      track.paused = false;
      track.pausedPositionSec = 0;
      track.amplitudeScale = 1;
    track.recordBuffer = [];
    track.samples = new Float32Array(0);
    track.durationSec = 0;
    track.recordStartMs = performance.now();
    track.lastSampleMs = track.recordStartMs;
    track.lastPreviewLength = 0;
    if (param === "gain") {
      track.currentValue = deck.gain;
    } else if (param === "djFilter") {
      track.currentValue = deck.djFilter;
    } else if (param === "resonance") {
      track.currentValue = deck.filterResonance;
    } else if (param === "eqLow") {
      track.currentValue = deck.eqLowGain;
    } else if (param === "eqMid") {
      track.currentValue = deck.eqMidGain;
    } else if (param === "eqHigh") {
      track.currentValue = deck.eqHighGain;
    } else if (param === "balance") {
      track.currentValue = deck.balance;
    } else if (param === "pitch") {
      track.currentValue = deck.pitchShift;
    } else {
      track.currentValue = deck.pitchShift;
    }
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const stopAutomationRecording = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    if (!track.recording) return;
    track.recording = false;
    const duration = track.recordBuffer.length / track.sampleRate;
    if (duration >= MIN_AUTOMATION_DURATION) {
      track.samples = new Float32Array(track.recordBuffer);
      track.durationSec = duration;
      track.playbackStartMs = performance.now();
    } else {
      track.samples = new Float32Array(0);
      track.durationSec = 0;
    }
    track.amplitudeScale = 1;
    track.recordBuffer = [];
    track.lastPreviewLength = 0;
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const updateAutomationValue = (id: number, param: AutomationParam, value: number) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const deck = decks.find((item) => item.id === id);
    if (param === "pitch" && deck?.tempoPitchSync) return;
    const track = automation[param];
    track.currentValue = value;
    if (param === "gain") {
      setDeckGainValue(id, value);
    } else if (param === "djFilter") {
      setDeckFilterValue(id, value);
    } else if (param === "resonance") {
      setDeckResonanceValue(id, value);
    } else if (param === "eqLow") {
      setDeckEqLowValue(id, value);
    } else if (param === "eqMid") {
      setDeckEqMidValue(id, value);
    } else if (param === "eqHigh") {
      setDeckEqHighValue(id, value);
    } else if (param === "balance") {
      setDeckBalanceValue(id, value);
    } else if (param === "pitch") {
      setDeckPitchShiftValue(id, value);
    } else {
      setDeckPitchShiftValue(id, value);
    }
    if (track.active) {
      updateAutomationView(id);
    }
  };

  const getAutomationPlayhead = (id: number, param: AutomationParam) => {
    const playheads = automationPlayheadRef.current.get(id);
    return playheads ? playheads[param] : 0;
  };

  const toggleAutomationActive = (id: number, param: AutomationParam, next: boolean) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const deck = decks.find((item) => item.id === id);
    if (param === "pitch" && deck?.tempoPitchSync) return;
    const track = automation[param];
    track.active = next;
    if (next) {
      track.playbackStartMs = performance.now();
    }
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const resetAutomationTrack = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    track.samples = new Float32Array(0);
    track.recordBuffer = [];
    track.durationSec = 0;
    track.recording = false;
    track.active = false;
    track.paused = false;
    track.pausedPositionSec = 0;
    track.amplitudeScale = 1;
    track.playbackStartMs = 0;
    track.lastPreviewLength = 0;
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const setDeckZoomValue = (id: number, value: number) => {
    updateDeck(id, { zoom: value }, false);
  };

  const setDeckLoopValue = (id: number, value: boolean) => {
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const duration = deck.duration ?? deck.buffer?.duration ?? 0;
        const nextStart = deck.loopStartSeconds ?? 0;
        const nextEnd =
          deck.loopEndSeconds > nextStart + 0.01 ? deck.loopEndSeconds : duration;
        const nextDeck = {
          ...deck,
          loopEnabled: value,
          loopStartSeconds: nextStart,
          loopEndSeconds: nextEnd,
        };
        if (deck.status !== "playing" || !deck.buffer) {
          return nextDeck;
        }

        const currentPosition = getDeckPosition(deck.id);
        const offsetSeconds =
          currentPosition !== null ? currentPosition : deck.offsetSeconds ?? 0;
        const clampedOffset = value
          ? Math.min(Math.max(offsetSeconds, nextStart), Math.max(nextStart, nextEnd - 0.01))
          : offsetSeconds;
        const tempoRatio = getDeckPlaybackRate(deck);

        const filters = getFilterTargets(deck.djFilter);
        void playBuffer(
          deck.id,
          deck.buffer,
          () => {
            console.info("Deck ended", { deckId: deck.id, loopEnabled: true });
            playbackStartRef.current.delete(deck.id);
            updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
          deck.gain,
          clampedOffset,
          tempoRatio,
          value,
          nextDeck.loopStartSeconds,
          nextDeck.loopEndSeconds,
          filters.lowpass,
          filters.highpass,
          deck.filterResonance,
          deck.eqLowGain,
          deck.eqMidGain,
          deck.eqHighGain,
          deck.delayTime,
          deck.delayFeedback,
          deck.delayMix,
          deck.delayTone,
          deck.delayPingPong,
          deck.balance,
          deck.pitchShift,
          deck.fractalMix,
          deck.fractalStructure,
          deck.fractalDepth,
          deck.fractalDrift,
          deck.fractalDecay,
          deck.fractalTone
        );

        const startedAtMs = performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        return {
          ...nextDeck,
          status: "playing",
          startedAtMs,
          offsetSeconds: clampedOffset,
          duration,
        };
      })
    );
  };

  const setDeckLoopBounds = (id: number, startSeconds: number, endSeconds: number) => {
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id || !deck.buffer) return deck;
        const duration = deck.duration ?? deck.buffer.duration;
        const minGap = Math.min(0.05, Math.max(0.005, duration * 0.25));
        const nextStart = Math.min(Math.max(0, startSeconds), duration);
        const nextEnd = Math.min(Math.max(nextStart + minGap, endSeconds), duration);
        const prevLoopStart = Math.max(0, deck.loopStartSeconds ?? 0);
        const prevLoopEnd =
          deck.loopEndSeconds && deck.loopEndSeconds > prevLoopStart + 0.01
            ? Math.min(deck.loopEndSeconds, duration)
            : duration;
        const prevLoopDuration = Math.max(0.001, prevLoopEnd - prevLoopStart);
        const nextLoopDuration = Math.max(0.001, nextEnd - nextStart);
        const nextRearrangerRegions = (() => {
          if ((deck.rearrangerSlices ?? 0) <= 1) return deck.rearrangerRegions;
          const normalized = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
          const remapped = normalized.map((point, index) => {
            if (index === 0) return 0;
            if (index === normalized.length - 1) return 1;
            const absolute = prevLoopStart + point * prevLoopDuration;
            return Math.min(Math.max((absolute - nextStart) / nextLoopDuration, 0), 1);
          });
          for (let i = 1; i < remapped.length; i += 1) {
            remapped[i] = Math.max(remapped[i], remapped[i - 1]);
          }
          for (let i = remapped.length - 2; i >= 0; i -= 1) {
            remapped[i] = Math.min(remapped[i], remapped[i + 1]);
          }
          remapped[0] = 0;
          remapped[remapped.length - 1] = 1;
          return remapped;
        })();
        if (
          approxEqual(nextStart, deck.loopStartSeconds ?? 0) &&
          approxEqual(nextEnd, deck.loopEndSeconds ?? duration) &&
          regionsEqual(nextRearrangerRegions, deck.rearrangerRegions)
        ) {
          return deck;
        }
        if (!loopBoundsHistorySnapshotRef.current.has(id)) {
          loopBoundsHistorySnapshotRef.current.set(id, snapshotDecks(prev));
        }

        if (deck.status === "playing" && deck.loopEnabled) {
          const currentPosition = getDeckPosition(deck.id);
          if (
            currentPosition !== null &&
            currentPosition >= nextStart &&
            currentPosition <= nextEnd
          ) {
            setDeckLoopParams(deck.id, true, nextStart, nextEnd);
            return {
              ...deck,
              loopStartSeconds: nextStart,
              loopEndSeconds: nextEnd,
              rearrangerRegions: nextRearrangerRegions,
            };
          }

          const clampedOffset = Math.min(
            Math.max(currentPosition ?? nextStart, nextStart),
            Math.max(nextStart, nextEnd - 0.01)
          );
          const filters = getFilterTargets(deck.djFilter);
          void playBuffer(
            deck.id,
            deck.buffer,
            () => {
              console.info("Deck ended", { deckId: deck.id, loopEnabled: true });
              playbackStartRef.current.delete(deck.id);
              updateDeck(
                deck.id,
                { status: "ready", startedAtMs: undefined, offsetSeconds: 0 },
                false
              );
            },
            deck.gain,
            clampedOffset,
            getDeckPlaybackRate(deck),
            true,
            nextStart,
            nextEnd,
            filters.lowpass,
            filters.highpass,
            deck.filterResonance,
            deck.eqLowGain,
            deck.eqMidGain,
            deck.eqHighGain,
            deck.delayTime,
            deck.delayFeedback,
            deck.delayMix,
            deck.delayTone,
            deck.delayPingPong,
            deck.balance,
            deck.pitchShift,
            deck.fractalMix,
            deck.fractalStructure,
            deck.fractalDepth,
            deck.fractalDrift,
            deck.fractalDecay,
            deck.fractalTone
          );
          const startedAtMs = performance.now();
          playbackStartRef.current.set(id, startedAtMs);
          return {
            ...deck,
            loopStartSeconds: nextStart,
            loopEndSeconds: nextEnd,
            rearrangerRegions: nextRearrangerRegions,
            startedAtMs,
            offsetSeconds: clampedOffset,
          };
        }

        if (deck.loopEnabled) {
          setDeckLoopParams(deck.id, true, nextStart, nextEnd);
        }
        return {
          ...deck,
          loopStartSeconds: nextStart,
          loopEndSeconds: nextEnd,
          rearrangerRegions: nextRearrangerRegions,
        };
      })
    );
  };

  const commitDeckLoopBoundsHistory = useCallback(
    (id: number) => {
      const tryCommit = (attempt: number) => {
        if (historyDisabledRef.current) return;
        const snapshot = loopBoundsHistorySnapshotRef.current.get(id);
        if (!snapshot) {
          if (attempt === 0) {
            window.setTimeout(() => tryCommit(1), 0);
          }
          return;
        }
        loopBoundsHistorySnapshotRef.current.delete(id);
        recordHistory(snapshot);
      };
      tryCommit(0);
    },
    [recordHistory]
  );

  const setDeckTempoOffset = (
    id: number,
    value: number,
    options?: { disableSnap?: boolean }
  ) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    const disableSnap = options?.disableSnap ?? false;
    let nextValue = safeValue;
    if (!disableSnap) {
      const snapped =
        Math.abs(safeValue) > 100
          ? safeValue
          : Math.round(safeValue / TEMPO_SNAP_STEP) * TEMPO_SNAP_STEP;
      nextValue =
        Math.abs(safeValue - snapped) <= TEMPO_SNAP_THRESHOLD ? snapped : safeValue;
    }
    let nextPitch = 0;
    let shouldSyncPitch = false;
    const currentDeck = decks.find((deck) => deck.id === id);
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        shouldSyncPitch = deck.tempoPitchSync;
        if (shouldSyncPitch) {
          nextPitch = getTempoSyncedPitch(nextValue);
          return { ...deck, tempoOffset: nextValue, pitchShift: nextPitch };
        }
        return { ...deck, tempoOffset: nextValue };
      })
    );
    setDeckPlaybackRate(id, clampPlaybackRate(1 + nextValue / 100));
    if (shouldSyncPitch) {
      setDeckPitchShift(id, nextPitch);
    }
    if (currentDeck?.status === "playing") {
      const position = getDeckPosition(id);
      if (position !== null) {
        const startedAtMs = performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        updateDeck(id, { offsetSeconds: position, startedAtMs }, false);
      }
    }
  };

  const setDeckTempoPitchSync = (id: number, enabled: boolean) => {
    let nextPitch = 0;
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        if (enabled) {
          nextPitch = getTempoSyncedPitch(deck.tempoOffset);
          return { ...deck, tempoPitchSync: true, pitchShift: nextPitch };
        }
        return { ...deck, tempoPitchSync: false };
      })
    );
    if (enabled) {
      const automation = automationRef.current.get(id);
      if (automation) {
        const track = automation.pitch;
        track.recording = false;
        track.active = false;
        track.paused = false;
        track.pausedPositionSec = 0;
        track.playbackStartMs = 0;
        track.lastPreviewLength = 0;
        updateAutomationView(id);
        updateAutomationTickEnabled();
      }
      setDeckPitchShift(id, nextPitch);
    }
  };

  const loadDeckBuffer = useCallback(
    (
      id: number,
      buffer: AudioBuffer,
      options?: {
        name?: string;
        autoplay?: boolean;
        recordHistory?: boolean;
        preserveNodes?: boolean;
        preserveFxState?: boolean;
        loopStartSeconds?: number;
        loopEndSeconds?: number;
        rearrangerSlices?: number;
        rearrangerRegions?: number[];
        rearrangerRegionIds?: number[];
        rearrangerRegionsManual?: boolean;
      }
    ) => {
      const deck = decks.find((item) => item.id === id);
      if (!deck) return;
      stop(id);
      playbackStartRef.current.delete(id);
      if (!options?.preserveNodes) {
        removeDeckNodes(id);
      }
      const duration = Number.isFinite(buffer.duration)
        ? buffer.duration
        : buffer.length / buffer.sampleRate;
      const name = options?.name ?? deck.fileName ?? "Stretched Loop";
      const autoplay = options?.autoplay ?? true;
      const recordHistory = options?.recordHistory ?? true;
      const preserveFxState = options?.preserveFxState ?? false;
      const nextGain = preserveFxState ? deck.gain : 0.9;
      const nextBalance = preserveFxState ? deck.balance : 0;
      const nextPitchShift = preserveFxState ? deck.pitchShift : 0;
      const nextTempoOffset = preserveFxState ? deck.tempoOffset : 0;
      const nextTempoPitchSync = preserveFxState ? deck.tempoPitchSync : false;
      const nextDjFilter = preserveFxState ? deck.djFilter : 0;
      const nextResonance = preserveFxState ? deck.filterResonance : 0;
      const nextEqLow = preserveFxState ? deck.eqLowGain : 0;
      const nextEqMid = preserveFxState ? deck.eqMidGain : 0;
      const nextEqHigh = preserveFxState ? deck.eqHighGain : 0;
      const nextZoom = preserveFxState ? deck.zoom : 1;
      const nextStretchRatio = deck.stretchRatio ?? DEFAULT_STRETCH_RATIO;
      const nextStretchWindowSize = deck.stretchWindowSize ?? DEFAULT_STRETCH_WINDOW_SIZE;
      const nextStretchStereoWidth =
        deck.stretchStereoWidth ?? DEFAULT_STRETCH_STEREO_WIDTH;
      const nextStretchPhaseRandomness =
        deck.stretchPhaseRandomness ?? DEFAULT_STRETCH_PHASE_RANDOMNESS;
      const nextStretchTiltDb = deck.stretchTiltDb ?? DEFAULT_STRETCH_TILT_DB;
      const nextStretchScatter = deck.stretchScatter ?? DEFAULT_STRETCH_SCATTER;
      const nextDelayTime = deck.delayTime ?? DEFAULT_DELAY_TIME;
      const nextDelayFeedback = deck.delayFeedback ?? DEFAULT_DELAY_FEEDBACK;
      const nextDelayMix = deck.delayMix ?? DEFAULT_DELAY_MIX;
      const nextDelayTone = deck.delayTone ?? DEFAULT_DELAY_TONE;
      const nextDelayPingPong = deck.delayPingPong ?? DEFAULT_DELAY_PINGPONG;
      const nextDelaySliceSync = deck.delaySliceSync ?? DEFAULT_DELAY_SLICE_SYNC;
      const nextFractalMix = deck.fractalMix ?? DEFAULT_FRACTAL_MIX;
      const nextFractalStructure =
        deck.fractalStructure ?? DEFAULT_FRACTAL_STRUCTURE;
      const nextFractalDepth = deck.fractalDepth ?? DEFAULT_FRACTAL_DEPTH;
      const nextFractalDrift = deck.fractalDrift ?? DEFAULT_FRACTAL_DRIFT;
      const nextFractalDecay = deck.fractalDecay ?? DEFAULT_FRACTAL_DECAY;
      const nextFractalTone = deck.fractalTone ?? DEFAULT_FRACTAL_TONE;
      const nextRearrangerSlices =
        options?.rearrangerSlices ?? deck.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES;
      const nextRearrangerOffset = deck.rearrangerOffset ?? DEFAULT_REARRANGER_OFFSET;
      const nextRearrangerChaos = deck.rearrangerChaos ?? DEFAULT_REARRANGER_CHAOS;
      const nextRearrangerReverse = deck.rearrangerReverse ?? DEFAULT_REARRANGER_REVERSE;
      const nextRearrangerSensitivity =
        deck.rearrangerSensitivity ?? DEFAULT_REARRANGER_SENSITIVITY;
      const nextRearrangerQuietThreshold =
        deck.rearrangerQuietThreshold ?? DEFAULT_REARRANGER_QUIET_THRESHOLD;
      const nextRearrangerAuto = deck.rearrangerAuto ?? DEFAULT_REARRANGER_AUTO;
      const nextRearrangerRegions = sanitizeRearrangerRegions(
        options?.rearrangerRegions ?? deck.rearrangerRegions
      );
      const nextRearrangerRegionIds =
        options?.rearrangerRegionIds ??
        deck.rearrangerRegionIds ??
        Array.from({ length: Math.max(0, deck.rearrangerSlices ?? 0) }, (_, index) => index);
      const nextRearrangerRegionsManual =
        options?.rearrangerRegionsManual ?? deck.rearrangerRegionsManual ?? false;
      const nextLoopStartSeconds = Math.max(
        0,
        Math.min(duration, options?.loopStartSeconds ?? 0)
      );
      const nextLoopEndSeconds = Math.max(
        nextLoopStartSeconds + 0.01,
        Math.min(duration, options?.loopEndSeconds ?? duration)
      );
      if (!preserveFxState) {
        resetAutomation(id, nextGain, 0, DEFAULT_RESONANCE, 0, 0, 0, nextBalance, nextPitchShift);
      }

      const status: DeckStatus = autoplay ? "playing" : "ready";
      const nextDeck: DeckState = {
        ...deck,
        fileName: name,
        buffer,
        duration,
        gain: nextGain,
        djFilter: nextDjFilter,
        filterResonance: nextResonance,
        eqLowGain: nextEqLow,
        eqMidGain: nextEqMid,
        eqHighGain: nextEqHigh,
        balance: nextBalance,
        pitchShift: nextPitchShift,
        offsetSeconds: 0,
        zoom: nextZoom,
        loopEnabled: true,
        loopStartSeconds: nextLoopStartSeconds,
        loopEndSeconds: nextLoopEndSeconds,
        tempoOffset: nextTempoOffset,
        tempoPitchSync: nextTempoPitchSync,
        stretchRatio: nextStretchRatio,
        stretchWindowSize: nextStretchWindowSize,
        stretchStereoWidth: nextStretchStereoWidth,
        stretchPhaseRandomness: nextStretchPhaseRandomness,
        stretchTiltDb: nextStretchTiltDb,
        stretchScatter: nextStretchScatter,
        delayTime: nextDelayTime,
        delayFeedback: nextDelayFeedback,
        delayMix: nextDelayMix,
        delayTone: nextDelayTone,
        delayPingPong: nextDelayPingPong,
        delaySliceSync: nextDelaySliceSync,
        fractalMix: nextFractalMix,
        fractalStructure: nextFractalStructure,
        fractalDepth: nextFractalDepth,
        fractalDrift: nextFractalDrift,
        fractalDecay: nextFractalDecay,
        fractalTone: nextFractalTone,
        rearrangerSlices: nextRearrangerSlices,
        rearrangerOffset: nextRearrangerOffset,
        rearrangerChaos: nextRearrangerChaos,
        rearrangerReverse: nextRearrangerReverse,
        rearrangerSensitivity: nextRearrangerSensitivity,
        rearrangerQuietThreshold: nextRearrangerQuietThreshold,
        rearrangerAuto: nextRearrangerAuto,
        rearrangerRegions: nextRearrangerRegions,
        rearrangerRegionIds: nextRearrangerRegionIds,
        rearrangerRegionsManual: nextRearrangerRegionsManual,
        status,
        startedAtMs: autoplay ? performance.now() : undefined,
      };

      const applyDeckUpdate = recordHistory ? setDecksWithHistory : setDecksNoHistory;
      applyDeckUpdate((prev) => prev.map((item) => (item.id === id ? nextDeck : item)));

      setDeckGain(id, nextGain);
      const filterTargets = getFilterTargets(nextDjFilter);
      setDeckFilter(id, filterTargets.lowpass);
      setDeckHighpass(id, filterTargets.highpass);
      setDeckResonance(id, nextResonance);
      setDeckEqLow(id, nextEqLow);
      setDeckEqMid(id, nextEqMid);
      setDeckEqHigh(id, nextEqHigh);
      setDeckBalance(id, nextBalance);
      setDeckPitchShift(id, nextPitchShift);
      setDeckDelayTime(id, nextDelayTime);
      setDeckDelayFeedback(id, nextDelayFeedback);
      setDeckDelayMix(id, nextDelayMix);
      setDeckDelayTone(id, nextDelayTone);
      setDeckDelayPingPong(id, nextDelayPingPong);
      setDeckFractalMix(id, nextFractalMix);
      setDeckFractalStructure(id, nextFractalStructure);
      setDeckFractalDepth(id, nextFractalDepth);
      setDeckFractalDrift(id, nextFractalDrift);
      setDeckFractalDecay(id, nextFractalDecay);
      setDeckFractalTone(id, nextFractalTone);
      const tempoRatio = clampPlaybackRate(1 + nextTempoOffset / 100);
      setDeckPlaybackRate(id, tempoRatio);
      setDeckLoopParams(id, true, nextLoopStartSeconds, nextLoopEndSeconds);

      if (autoplay) {
        const startedAtMs = nextDeck.startedAtMs ?? performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        void playBuffer(
          id,
          buffer,
          () => {
            console.info("Deck ended", { deckId: id, loopEnabled: true });
            playbackStartRef.current.delete(id);
            updateDeck(id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
          nextGain,
          0,
          tempoRatio,
          true,
          0,
          duration,
          filterTargets.lowpass,
          filterTargets.highpass,
          nextResonance,
          nextEqLow,
          nextEqMid,
          nextEqHigh,
          nextDelayTime,
          nextDelayFeedback,
          nextDelayMix,
          nextDelayTone,
          nextDelayPingPong,
          nextBalance,
          nextPitchShift,
          nextDeck.fractalMix,
          nextDeck.fractalStructure,
          nextDeck.fractalDepth,
          nextDeck.fractalDrift,
          nextDeck.fractalDecay,
          nextDeck.fractalTone
        );
      }
    },
    [
      decks,
      getFilterTargets,
      playBuffer,
      removeDeckNodes,
      resetAutomation,
      setDeckBalance,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelayPingPong,
      setDeckDelayTime,
      setDeckDelayTone,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckFractalDecay,
      setDeckFractalDepth,
      setDeckFractalDrift,
      setDeckFractalMix,
      setDeckFractalStructure,
      setDeckFractalTone,
      setDeckGain,
      setDeckHighpass,
      setDeckLoopParams,
      setDeckPitchShift,
      setDeckPlaybackRate,
      setDeckResonance,
      setDecksWithHistory,
      setDecksNoHistory,
      stop,
      updateDeck,
    ]
  );

  const setDeckStretchRatio = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_RATIO;
    const clamped = Math.min(Math.max(safeValue, 1), 16);
    updateDeck(id, { stretchRatio: clamped }, false);
  };

  const setDeckStretchWindowSize = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? Math.floor(value) : DEFAULT_STRETCH_WINDOW_SIZE;
    const nextValue = STRETCH_WINDOW_SIZES.includes(safeValue)
      ? safeValue
      : STRETCH_WINDOW_SIZES.reduce((closest, current) =>
          Math.abs(current - safeValue) < Math.abs(closest - safeValue) ? current : closest
        );
    updateDeck(id, { stretchWindowSize: nextValue }, false);
  };

  const setDeckStretchStereoWidth = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_STEREO_WIDTH;
    const clamped = Math.min(Math.max(safeValue, 0), 2);
    updateDeck(id, { stretchStereoWidth: clamped }, false);
  };

  const setDeckStretchPhaseRandomness = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_PHASE_RANDOMNESS;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { stretchPhaseRandomness: clamped }, false);
  };

  const setDeckStretchTiltDb = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_TILT_DB;
    const clamped = Math.min(Math.max(safeValue, -18), 18);
    updateDeck(id, { stretchTiltDb: clamped }, false);
  };

  const setDeckStretchScatter = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_SCATTER;
    const clamped = Math.min(Math.max(safeValue, 1), 16);
    updateDeck(id, { stretchScatter: clamped }, false);
  };

  const setDeckWidthOverride = (id: number, value?: DeckWidthOverride) => {
    updateDeck(id, { deckWidthOverride: value }, false);
  };

  const setDeckRearrangerSlices = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? Math.round(value) : DEFAULT_REARRANGER_SLICES;
    const clamped = Math.min(Math.max(safeValue, 0), MAX_REARRANGER_SLICES);
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const current = Math.min(
          Math.max(Math.round(deck.rearrangerSlices || DEFAULT_REARRANGER_SLICES), 0),
          MAX_REARRANGER_SLICES
        );
        if (clamped === current) return deck;
        const hasManualRegions = deck.rearrangerRegionsManual === true;
        const customRegions = hasManualRegions
          ? sanitizeRearrangerRegions(deck.rearrangerRegions)
          : undefined;
        const currentIds =
          deck.rearrangerRegionIds ??
          Array.from({ length: Math.max(0, current) }, (_, index) => index);
        if (clamped <= 1) {
          return {
            ...deck,
            rearrangerSlices: clamped,
            rearrangerRegions: undefined,
            rearrangerRegionIds: currentIds.slice(0, clamped),
            rearrangerRegionsManual: false,
          };
        }
        if (!customRegions) {
          const nextIds =
            clamped > current
              ? [
                  ...currentIds,
                  ...Array.from({ length: clamped - current }, (_, index) => current + index),
                ]
              : currentIds.slice(0, clamped);
          return {
            ...deck,
            rearrangerSlices: clamped,
            rearrangerRegions: undefined,
            rearrangerRegionIds: nextIds,
            rearrangerRegionsManual: false,
          };
        }
        let nextRegions = [...customRegions];
        const nextIds = [...currentIds];
        if (nextRegions.length === clamped + 1) {
          return {
            ...deck,
            rearrangerSlices: clamped,
            rearrangerRegions: nextRegions,
            rearrangerRegionIds: nextIds.slice(0, clamped),
            rearrangerRegionsManual: true,
          };
        }
        if (clamped > current) {
          while (nextRegions.length < clamped + 1) {
            nextRegions = appendRearrangerBoundary(nextRegions);
            const maxId = nextIds.reduce((max, id) => Math.max(max, id), -1);
            nextIds.push(maxId + 1);
          }
        } else {
          while (nextRegions.length > clamped + 1 && nextRegions.length > 3) {
            nextRegions.splice(nextRegions.length - 2, 1);
            nextIds.splice(nextIds.length - 1, 1);
          }
        }
        return {
          ...deck,
          rearrangerSlices: clamped,
          rearrangerRegions: nextRegions,
          rearrangerRegionIds: nextIds.slice(0, clamped),
          rearrangerRegionsManual: true,
        };
      })
    );
  };

  const setDeckRearrangerOffset = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? Math.round(value) : DEFAULT_REARRANGER_OFFSET;
    const clamped = Math.min(Math.max(safeValue, -32), 32);
    updateDeck(id, { rearrangerOffset: clamped }, false);
  };

  const setDeckRearrangerChaos = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_CHAOS;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerChaos: clamped }, false);
  };

  const setDeckRearrangerReverse = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_REVERSE;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerReverse: clamped }, false);
  };

  const setDeckRearrangerSensitivity = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_SENSITIVITY;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerSensitivity: clamped }, false);
  };

  const setDeckRearrangerQuietThreshold = (id: number, value: number) => {
    const safeValue = Number.isFinite(value)
      ? value
      : DEFAULT_REARRANGER_QUIET_THRESHOLD;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerQuietThreshold: clamped }, false);
  };

  const setDeckRearrangerAuto = (id: number, value: boolean) => {
    updateDeck(id, { rearrangerAuto: value }, false);
  };

  const setDeckRearrangerRegions = (id: number, regions?: number[]) => {
    const next = sanitizeRearrangerRegions(regions);
    const nextSlices = next ? Math.max(0, next.length - 1) : undefined;
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const slices = nextSlices ?? deck.rearrangerSlices;
        const currentIds =
          deck.rearrangerRegionIds ??
          Array.from({ length: Math.max(0, deck.rearrangerSlices) }, (_, index) => index);
        const nextIds =
          slices <= currentIds.length
            ? currentIds.slice(0, slices)
            : [
                ...currentIds,
                ...Array.from({ length: slices - currentIds.length }, (_, index) => currentIds.length + index),
              ];
        return {
          ...deck,
          rearrangerSlices: slices,
          rearrangerRegions: next,
          rearrangerRegionIds: nextIds,
          rearrangerRegionsManual: true,
        };
      })
    );
  };

  const setDeckFxPanelOpen = (id: number, panel: DeckFxPanel, open: boolean) => {
    setDecksNoHistory((prev) =>
      prev.map((deck) =>
        deck.id === id
          ? { ...deck, fxPanelOpen: { ...withDefaultFxPanelOpen(deck.fxPanelOpen), [panel]: open } }
          : deck
      )
    );
  };

  const setDeckFxPanelsOpen = (id: number, open: boolean) => {
    setDecksNoHistory((prev) =>
      prev.map((deck) =>
        deck.id === id
          ? {
              ...deck,
              fxPanelOpen: {
                gain: open,
                djFilter: open,
                resonance: open,
                eqLow: open,
                eqMid: open,
                eqHigh: open,
                balance: open,
                pitch: open,
                delay: open,
                fractal: open,
                rearranger: open,
                stretch: open,
              },
            }
          : deck
      )
    );
  };

  const resetDeckFx = useCallback(
    (id: number) => {
      const deck = decks.find((item) => item.id === id);
      if (!deck) return;
      const nextPitchShift = deck.tempoPitchSync
        ? getTempoSyncedPitch(deck.tempoOffset)
        : 0;
      applyDeckSettingsToEngine(id, {
        gain: deck.gain,
        djFilter: 0,
        filterResonance: DEFAULT_RESONANCE,
        eqLowGain: 0,
        eqMidGain: 0,
        eqHighGain: 0,
        balance: 0,
        pitchShift: nextPitchShift,
        tempoOffset: deck.tempoOffset,
        delayTime: DEFAULT_DELAY_TIME,
        delayFeedback: DEFAULT_DELAY_FEEDBACK,
        delayMix: DEFAULT_DELAY_MIX,
        delayTone: DEFAULT_DELAY_TONE,
        delayPingPong: DEFAULT_DELAY_PINGPONG,
        fractalMix: DEFAULT_FRACTAL_MIX,
        fractalStructure: DEFAULT_FRACTAL_STRUCTURE,
        fractalDepth: DEFAULT_FRACTAL_DEPTH,
        fractalDrift: DEFAULT_FRACTAL_DRIFT,
        fractalDecay: DEFAULT_FRACTAL_DECAY,
        fractalTone: DEFAULT_FRACTAL_TONE,
      });
      resetAutomation(
        id,
        0.9,
        0,
        DEFAULT_RESONANCE,
        0,
        0,
        0,
        0,
        nextPitchShift
      );
      updateDeck(
        id,
        {
          djFilter: 0,
          filterResonance: DEFAULT_RESONANCE,
          eqLowGain: 0,
          eqMidGain: 0,
          eqHighGain: 0,
          balance: 0,
          pitchShift: nextPitchShift,
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
          fractalMix: DEFAULT_FRACTAL_MIX,
          fractalStructure: DEFAULT_FRACTAL_STRUCTURE,
          fractalDepth: DEFAULT_FRACTAL_DEPTH,
          fractalDrift: DEFAULT_FRACTAL_DRIFT,
          fractalDecay: DEFAULT_FRACTAL_DECAY,
          fractalTone: DEFAULT_FRACTAL_TONE,
          rearrangerSlices: DEFAULT_REARRANGER_SLICES,
          rearrangerOffset: DEFAULT_REARRANGER_OFFSET,
          rearrangerChaos: DEFAULT_REARRANGER_CHAOS,
          rearrangerReverse: DEFAULT_REARRANGER_REVERSE,
          rearrangerSensitivity: DEFAULT_REARRANGER_SENSITIVITY,
          rearrangerQuietThreshold: DEFAULT_REARRANGER_QUIET_THRESHOLD,
          rearrangerAuto: DEFAULT_REARRANGER_AUTO,
          rearrangerRegions: undefined,
          rearrangerRegionIds: undefined,
          rearrangerRegionsManual: false,
        },
        false
      );
    },
    [applyDeckSettingsToEngine, decks, getTempoSyncedPitch, resetAutomation, updateDeck]
  );

  const applyDeckFxPanelStatePatch = useCallback(
    (patch: Record<number, Partial<DeckFxPanelState>>) => {
      setDecksNoHistory((prev) =>
        prev.map((deck) => {
          const nextPatch = patch[deck.id];
          if (!nextPatch) return deck;
          return {
            ...deck,
            fxPanelOpen: withDefaultFxPanelOpen({
              ...withDefaultFxPanelOpen(deck.fxPanelOpen),
              ...nextPatch,
            }),
          };
        })
      );
    },
    [setDecksNoHistory]
  );

  const getDeckPlaybackSnapshotSafe = useCallback(
    (id: number) => {
      const engineSnapshot = _getDeckPlaybackSnapshot(id);
      if (engineSnapshot) {
        return engineSnapshot;
      }
      const deck = decks.find((item) => item.id === id);
      if (!deck) return null;
      const duration = deck.duration ?? deck.buffer?.duration ?? 0;
      if (!duration) return null;
      const loopStart = deck.loopStartSeconds ?? 0;
      const loopEnd =
        deck.loopEndSeconds > loopStart + 0.01 ? deck.loopEndSeconds : duration;
      const tempoRatio = getDeckPlaybackRate(deck);
      const startedAtMs = deck.startedAtMs ?? playbackStartRef.current.get(id);
      if (deck.status !== "playing" || startedAtMs === undefined) {
        return {
          position: Math.min(deck.offsetSeconds ?? 0, duration),
          duration,
          loopEnabled: deck.loopEnabled,
          loopStart,
          loopEnd,
          playing: false,
          playbackRate: tempoRatio,
        };
      }
      const elapsed = (performance.now() - startedAtMs) / 1000;
      let position = (deck.offsetSeconds ?? 0) + elapsed * tempoRatio;
      if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
        const loopDuration = loopEnd - loopStart;
        const loopOffset = position - loopStart;
        const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
        position = loopStart + wrapped;
      } else {
        position = Math.min(position, duration);
      }
      return {
        position,
        duration,
        loopEnabled: deck.loopEnabled,
        loopStart,
        loopEnd,
        playing: deck.status === "playing",
        playbackRate: tempoRatio,
      };
    },
    [decks, getDeckPlaybackRate, _getDeckPlaybackSnapshot]
  );

  const getSessionDecks = useCallback((): DeckSession[] => {
    return decks.map((deck) => {
      const automation = automationRef.current.get(deck.id);
      const buildSnapshot = (track: AutomationTrack | undefined, fallbackValue: number) => ({
        samples: Array.from(track?.samples ?? []),
        sampleRate: track?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
        durationSec: track?.durationSec ?? 0,
        active: track?.active ?? false,
        currentValue: track?.currentValue ?? fallbackValue,
      });

      return {
        id: deck.id,
        fileName: deck.fileName,
        gain: deck.gain,
        djFilter: deck.djFilter,
        filterResonance: deck.filterResonance,
        eqLowGain: deck.eqLowGain,
        eqMidGain: deck.eqMidGain,
        eqHighGain: deck.eqHighGain,
        balance: deck.balance,
        pitchShift: deck.pitchShift,
        deckWidthOverride: deck.deckWidthOverride,
        offsetSeconds: deck.offsetSeconds ?? 0,
        zoom: deck.zoom,
        loopEnabled: deck.loopEnabled,
        loopStartSeconds: deck.loopStartSeconds,
        loopEndSeconds: deck.loopEndSeconds,
        tempoOffset: deck.tempoOffset,
        tempoPitchSync: deck.tempoPitchSync,
        stretchRatio: deck.stretchRatio,
        stretchWindowSize: deck.stretchWindowSize,
        stretchStereoWidth: deck.stretchStereoWidth,
        stretchPhaseRandomness: deck.stretchPhaseRandomness,
        stretchTiltDb: deck.stretchTiltDb,
        stretchScatter: deck.stretchScatter,
        delayTime: deck.delayTime,
        delayFeedback: deck.delayFeedback,
        delayMix: deck.delayMix,
        delayTone: deck.delayTone,
        delayPingPong: deck.delayPingPong,
        delaySliceSync: deck.delaySliceSync,
        fractalMix: deck.fractalMix,
        fractalStructure: deck.fractalStructure,
        fractalDepth: deck.fractalDepth,
        fractalDrift: deck.fractalDrift,
        fractalDecay: deck.fractalDecay,
        fractalTone: deck.fractalTone,
        rearrangerSlices: deck.rearrangerSlices,
        rearrangerOffset: deck.rearrangerOffset,
        rearrangerChaos: deck.rearrangerChaos,
        rearrangerReverse: deck.rearrangerReverse,
        rearrangerSensitivity: deck.rearrangerSensitivity,
        rearrangerQuietThreshold: deck.rearrangerQuietThreshold,
        rearrangerAuto: deck.rearrangerAuto,
        rearrangerRegions: sanitizeRearrangerRegions(deck.rearrangerRegions),
        rearrangerRegionIds: deck.rearrangerRegionIds,
        rearrangerRegionsManual: deck.rearrangerRegionsManual ?? false,
        fxPanelOpen: withDefaultFxPanelOpen(deck.fxPanelOpen),
        automation: {
          gain: buildSnapshot(automation?.gain, deck.gain),
          djFilter: buildSnapshot(automation?.djFilter, deck.djFilter),
          resonance: buildSnapshot(automation?.resonance, deck.filterResonance),
          eqLow: buildSnapshot(automation?.eqLow, deck.eqLowGain),
          eqMid: buildSnapshot(automation?.eqMid, deck.eqMidGain),
          eqHigh: buildSnapshot(automation?.eqHigh, deck.eqHighGain),
          balance: buildSnapshot(automation?.balance, deck.balance),
          pitch: buildSnapshot(automation?.pitch, deck.pitchShift),
        },
      };
    });
  }, [decks]);

  const loadSessionDecks = useCallback(
    (sessionDecks: DeckSession[], buffers: Map<number, AudioBuffer | null>) => {
      decks.forEach((deck) => {
        stop(deck.id);
        removeDeckNodes(deck.id);
      });

      playbackStartRef.current = new Map();
      playbackRateRef.current = new Map();
      fileInputRefs.current = new Map();
      automationRef.current = new Map();
      automationPlayheadRef.current = new Map();
      automationUiUpdateRef.current = new Map();

      const nextAutomationState = new Map<number, Record<AutomationParam, AutomationView>>();
      let maxDeckId = 1;

      const nextDecks = sessionDecks.map((sessionDeck) => {
        const buffer = buffers.get(sessionDeck.id) ?? undefined;
        const duration = buffer
          ? Number.isFinite(buffer.duration)
            ? buffer.duration
            : buffer.length / buffer.sampleRate
          : 0;
        const loopStart = sessionDeck.loopStartSeconds ?? 0;
        const loopEnd = duration
          ? Math.min(
              Math.max(loopStart + 0.01, sessionDeck.loopEndSeconds ?? duration),
              duration
            )
          : sessionDeck.loopEndSeconds ?? 0;
        const offsetSeconds = duration
          ? Math.min(Math.max(0, sessionDeck.offsetSeconds ?? 0), duration)
          : 0;

        const ensureTrack = (
          snapshot: DeckSession["automation"][AutomationParam] | undefined,
          fallbackValue: number
        ): AutomationTrack => {
          const isActive = snapshot?.active ?? false;
          return {
            samples: new Float32Array(snapshot?.samples ?? []),
            sampleRate: snapshot?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
            durationSec: snapshot?.durationSec ?? 0,
            recording: false,
            active: isActive,
            paused: isActive,
            pausedPositionSec: 0,
            currentValue: snapshot?.currentValue ?? fallbackValue,
            amplitudeScale: 1,
            lastIndex: -1,
            lastPreviewLength: 0,
            recordBuffer: [],
            recordStartMs: 0,
            lastSampleMs: 0,
            playbackStartMs: 0,
          };
        };

        const automation: AutomationDeck = {
          gain: ensureTrack(sessionDeck.automation.gain, sessionDeck.gain),
          djFilter: ensureTrack(sessionDeck.automation.djFilter, sessionDeck.djFilter),
          resonance: ensureTrack(
            sessionDeck.automation.resonance,
            sessionDeck.filterResonance
          ),
          eqLow: ensureTrack(sessionDeck.automation.eqLow, sessionDeck.eqLowGain),
          eqMid: ensureTrack(sessionDeck.automation.eqMid, sessionDeck.eqMidGain),
          eqHigh: ensureTrack(sessionDeck.automation.eqHigh, sessionDeck.eqHighGain),
          balance: ensureTrack(
            sessionDeck.automation.balance,
            sessionDeck.balance ?? 0
          ),
          pitch: ensureTrack(
            sessionDeck.automation.pitch,
            sessionDeck.pitchShift ?? 0
          ),
        };

        automationRef.current.set(sessionDeck.id, automation);
        automationPlayheadRef.current.set(sessionDeck.id, {
          gain: 0,
          djFilter: 0,
          resonance: 0,
          eqLow: 0,
          eqMid: 0,
          eqHigh: 0,
          balance: 0,
          pitch: 0,
        });
        nextAutomationState.set(sessionDeck.id, {
          gain: toAutomationView(automation.gain),
          djFilter: toAutomationView(automation.djFilter),
          resonance: toAutomationView(automation.resonance),
          eqLow: toAutomationView(automation.eqLow),
          eqMid: toAutomationView(automation.eqMid),
          eqHigh: toAutomationView(automation.eqHigh),
          balance: toAutomationView(automation.balance),
          pitch: toAutomationView(automation.pitch),
        });

        maxDeckId = Math.max(maxDeckId, sessionDeck.id);

        const status: DeckStatus = buffer ? "paused" : "idle";
        return {
          id: sessionDeck.id,
          status,
          fileName: sessionDeck.fileName,
          buffer,
          duration: duration || undefined,
          gain: sessionDeck.gain,
          djFilter: sessionDeck.djFilter,
          filterResonance: sessionDeck.filterResonance,
          eqLowGain: sessionDeck.eqLowGain,
          eqMidGain: sessionDeck.eqMidGain,
          eqHighGain: sessionDeck.eqHighGain,
          balance: sessionDeck.balance ?? 0,
          pitchShift: sessionDeck.pitchShift ?? 0,
          deckWidthOverride: sessionDeck.deckWidthOverride,
          offsetSeconds,
          zoom: sessionDeck.zoom,
          loopEnabled: sessionDeck.loopEnabled,
          loopStartSeconds: loopStart,
          loopEndSeconds: loopEnd,
          tempoOffset: sessionDeck.tempoOffset,
          tempoPitchSync: sessionDeck.tempoPitchSync ?? false,
          stretchRatio: sessionDeck.stretchRatio ?? DEFAULT_STRETCH_RATIO,
          stretchWindowSize: sessionDeck.stretchWindowSize ?? DEFAULT_STRETCH_WINDOW_SIZE,
          stretchStereoWidth:
            sessionDeck.stretchStereoWidth ?? DEFAULT_STRETCH_STEREO_WIDTH,
          stretchPhaseRandomness:
            sessionDeck.stretchPhaseRandomness ?? DEFAULT_STRETCH_PHASE_RANDOMNESS,
          stretchTiltDb: sessionDeck.stretchTiltDb ?? DEFAULT_STRETCH_TILT_DB,
          stretchScatter: sessionDeck.stretchScatter ?? DEFAULT_STRETCH_SCATTER,
          delayTime: sessionDeck.delayTime ?? DEFAULT_DELAY_TIME,
          delayFeedback: sessionDeck.delayFeedback ?? DEFAULT_DELAY_FEEDBACK,
          delayMix: sessionDeck.delayMix ?? DEFAULT_DELAY_MIX,
          delayTone: sessionDeck.delayTone ?? DEFAULT_DELAY_TONE,
          delayPingPong: sessionDeck.delayPingPong ?? DEFAULT_DELAY_PINGPONG,
          delaySliceSync: sessionDeck.delaySliceSync ?? DEFAULT_DELAY_SLICE_SYNC,
          fractalMix: sessionDeck.fractalMix ?? DEFAULT_FRACTAL_MIX,
          fractalStructure:
            sessionDeck.fractalStructure ?? DEFAULT_FRACTAL_STRUCTURE,
          fractalDepth: sessionDeck.fractalDepth ?? DEFAULT_FRACTAL_DEPTH,
          fractalDrift: sessionDeck.fractalDrift ?? DEFAULT_FRACTAL_DRIFT,
          fractalDecay: sessionDeck.fractalDecay ?? DEFAULT_FRACTAL_DECAY,
          fractalTone: sessionDeck.fractalTone ?? DEFAULT_FRACTAL_TONE,
          rearrangerSlices:
            sessionDeck.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES,
          rearrangerOffset:
            sessionDeck.rearrangerOffset ?? DEFAULT_REARRANGER_OFFSET,
          rearrangerChaos:
            sessionDeck.rearrangerChaos ?? DEFAULT_REARRANGER_CHAOS,
          rearrangerReverse:
            sessionDeck.rearrangerReverse ?? DEFAULT_REARRANGER_REVERSE,
          rearrangerSensitivity:
            sessionDeck.rearrangerSensitivity ?? DEFAULT_REARRANGER_SENSITIVITY,
          rearrangerQuietThreshold:
            sessionDeck.rearrangerQuietThreshold ??
            DEFAULT_REARRANGER_QUIET_THRESHOLD,
          rearrangerAuto:
            sessionDeck.rearrangerAuto ?? DEFAULT_REARRANGER_AUTO,
          rearrangerRegions: sanitizeRearrangerRegions(sessionDeck.rearrangerRegions),
          rearrangerRegionIds:
            sessionDeck.rearrangerRegionIds ??
            Array.from(
              { length: Math.max(0, sessionDeck.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES) },
              (_, index) => index
            ),
          rearrangerRegionsManual: sessionDeck.rearrangerRegionsManual ?? false,
          fxPanelOpen: withDefaultFxPanelOpen(sessionDeck.fxPanelOpen),
          startedAtMs: undefined,
        };
      });

      nextDeckId.current = Math.max(2, maxDeckId + 1);
      historyRef.current = { past: [], future: [] };
      syncHistoryState();
      setDecksNoHistory(() => nextDecks);
      setAutomationState(nextAutomationState);
      updateAutomationTickEnabled();
    },
    [decks, removeDeckNodes, setDecksNoHistory, stop, syncHistoryState, updateAutomationTickEnabled]
  );

  const resetDecks = useCallback(() => {
    decks.forEach((deck) => {
      stop(deck.id);
      removeDeckNodes(deck.id);
    });
    playbackStartRef.current = new Map();
    playbackRateRef.current = new Map();
    fileInputRefs.current = new Map();
    automationRef.current = new Map();
    automationPlayheadRef.current = new Map();
    automationUiUpdateRef.current = new Map();
    historyRef.current = { past: [], future: [] };
    syncHistoryState();
    nextDeckId.current = 2;
    setDecksNoHistory(() => createInitialDecks());
    setAutomationState(new Map());
    updateAutomationTickEnabled();
  }, [
    createInitialDecks,
    decks,
    removeDeckNodes,
    setDecksNoHistory,
    stop,
    syncHistoryState,
    updateAutomationTickEnabled,
  ]);

  return {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    stopDeck,
    setDeckGain: setDeckGainValue,
    setDeckFilter: setDeckFilterValue,
    setDeckResonance: setDeckResonanceValue,
    setDeckEqLow: setDeckEqLowValue,
    setDeckEqMid: setDeckEqMidValue,
    setDeckEqHigh: setDeckEqHighValue,
    setDeckBalance: setDeckBalanceValue,
    setDeckDelayTime: setDeckDelayTimeValue,
    setDeckDelayFeedback: setDeckDelayFeedbackValue,
    setDeckDelayMix: setDeckDelayMixValue,
    setDeckDelayTone: setDeckDelayToneValue,
    setDeckDelayPingPong: setDeckDelayPingPongValue,
    setDeckDelaySliceSync: setDeckDelaySliceSyncValue,
    setDeckDelayTimeTransient,
    setDeckFractalMix: setDeckFractalMixValue,
    setDeckFractalStructure: setDeckFractalStructureValue,
    setDeckFractalDepth: setDeckFractalDepthValue,
    setDeckFractalDrift: setDeckFractalDriftValue,
    setDeckFractalDecay: setDeckFractalDecayValue,
    setDeckFractalTone: setDeckFractalToneValue,
    setDeckPitchShift: setDeckPitchShiftValue,
    seekDeck,
    setDeckZoom: setDeckZoomValue,
    setDeckLoop: setDeckLoopValue,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
    setDeckWidthOverride,
    setDeckStretchRatio,
    setDeckStretchWindowSize,
    setDeckStretchStereoWidth,
    setDeckStretchPhaseRandomness,
    setDeckStretchTiltDb,
    setDeckStretchScatter,
    setDeckRearrangerSlices,
    setDeckRearrangerOffset,
    setDeckRearrangerChaos,
    setDeckRearrangerReverse,
    setDeckRearrangerSensitivity,
    setDeckRearrangerQuietThreshold,
    setDeckRearrangerAuto,
    setDeckRearrangerRegions,
    setDeckFxPanelOpen,
    setDeckFxPanelsOpen,
    resetDeckFx,
    applyDeckFxPanelStatePatch,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
    applyAutomationPreset,
    adjustAutomationLength,
    adjustAutomationAmplitude,
    invertAutomation,
    setAutomationDuration,
    getDeckPosition,
    getDeckPlaybackSnapshot: getDeckPlaybackSnapshotSafe,
    setFileInputRef,
    loadDeckBuffer,
    getSessionDecks,
    loadSessionDecks,
    resetDecks,
    undo,
    redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
  };
};

export default useDecks;
