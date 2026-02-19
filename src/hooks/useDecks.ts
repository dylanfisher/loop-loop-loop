import { useCallback, useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type {
  DeckSimpleAutomation,
  EqMode,
  ParametricEqBand,
  SimpleAutomationParam,
  DeckFxPanelState,
  DeckState,
  DeckStatus,
} from "../types/deck";
import type { AutomationParam, AutomationSnapshot, ClipSettings, DeckSession } from "../types/session";
import {
  MAX_REARRANGER_SLICES,
  normalizeRearrangerRegionIds,
} from "../utils/rearranger";
import {
  normalizeParametricEqBands,
} from "../audio/effects/parametricEq";
import {
  hydrateDeckFromSession,
  serializeDeckSession,
} from "./deckSessionSerialization";
import { createDeckParameterSetters } from "./deckParameterSetters";
import { createDeckAutomationControls } from "./deckAutomationControls";
import { createDeckLoopTempoControls } from "./deckLoopTempoControls";
import { createDeckUiSetters } from "./deckUiSetters";
import {
  approxEqual,
  AUTOMATION_SAMPLE_RATE,
  AUTOMATION_UI_INTERVAL_MS,
  buildInitialDecks,
  clamp,
  clampPlaybackRate,
  cloneDefaultParametricEqBands,
  createTrack,
  DEFAULT_DELAY_DAMPING,
  DEFAULT_DELAY_FEEDBACK,
  DEFAULT_DELAY_MIX,
  DEFAULT_DELAY_PINGPONG,
  DEFAULT_DELAY_SAFETY,
  DEFAULT_DELAY_SATURATION,
  DEFAULT_DELAY_SLICE_SYNC,
  DEFAULT_DELAY_TIME,
  DEFAULT_DELAY_TONE,
  DEFAULT_EQ_MODE,
  DEFAULT_PARAMETRIC_EQ_MOTION_STATE,
  DEFAULT_REARRANGER_AUTO,
  DEFAULT_REARRANGER_CHAOS,
  DEFAULT_REARRANGER_PINGPONG,
  DEFAULT_REARRANGER_QUIET_THRESHOLD,
  DEFAULT_REARRANGER_REVERSE,
  DEFAULT_REARRANGER_SENSITIVITY,
  DEFAULT_REARRANGER_SLICE_DELAY_SEC,
  DEFAULT_REARRANGER_SLICE_FADE_MS,
  DEFAULT_REARRANGER_SLICES,
  DEFAULT_REARRANGER_SWAP_COUNT,
  DEFAULT_RESONANCE,
  DEFAULT_STRETCH_PHASE_RANDOMNESS,
  DEFAULT_STRETCH_RATIO,
  DEFAULT_STRETCH_SCATTER,
  DEFAULT_STRETCH_STEREO_WIDTH,
  DEFAULT_STRETCH_TILT_DB,
  DEFAULT_STRETCH_WINDOW_SIZE,
  DEFAULT_VOCODER_ATTACK_MS,
  DEFAULT_VOCODER_BAND_COUNT,
  DEFAULT_VOCODER_BAND_SPREAD,
  DEFAULT_VOCODER_CARRIER_DECK_ID,
  DEFAULT_VOCODER_GATE_THRESHOLD,
  DEFAULT_VOCODER_MIX,
  DEFAULT_VOCODER_MOD_DRIVE,
  DEFAULT_VOCODER_MODULATOR_MONITOR,
  DEFAULT_VOCODER_NOISE_MIX,
  DEFAULT_VOCODER_RELEASE_MS,
  FX_ACTIVE_EPSILON,
  MIN_AUTOMATION_DURATION,
  normalizeParametricEqMotionState,
  normalizeSimpleAutomation,
  SIMPLE_AUTOMATION_PARAM_LIMITS,
  sanitizeRearrangerRegions,
  toAutomationView,
  type AutomationDeck,
  type AutomationTrack,
  type AutomationView,
  withDefaultFxPanelOpen,
} from "./useDecksShared";

type SimpleAutomationRuntimeTrack = {
  playbackStartMs: number;
  paused: boolean;
  pausedPositionSec: number;
};

const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const playbackRateRef = useRef<Map<number, number>>(new Map());
  const playbackStartRef = useRef<Map<number, number>>(new Map());
  const automationRef = useRef<Map<number, AutomationDeck>>(new Map());
  const automationPlayheadRef = useRef<Map<number, Record<AutomationParam, number>>>(new Map());
  const automationUiUpdateRef = useRef<Map<number, number>>(new Map());
  const loadRequestRef = useRef<Map<number, number>>(new Map());
  const simpleAutomationRuntimeRef = useRef<
    Map<number, Partial<Record<SimpleAutomationParam, SimpleAutomationRuntimeTrack>>>
  >(new Map());
  const automationTickEnabledRef = useRef(false);
  const [automationState, setAutomationState] = useState<Map<number, Record<AutomationParam, AutomationView>>>(
    new Map()
  );
  const [automationTickEnabled, setAutomationTickEnabled] = useState(false);
  const [decks, setDecks] = useState<DeckState[]>(buildInitialDecks);
  const decksRef = useRef<DeckState[]>([]);
  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);
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
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckBalance,
    setDeckRearrangerPan,
    setDeckRearrangerPingPongAmount,
    setDeckRearrangerPingPongConfig,
    clearDeckRearrangerPanAutomation,
    scheduleDeckRearrangerPan,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderBandSpread,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckRecordExportSend,
    setDeckPitchShift,
    removeDeck: removeDeckNodes,
    getDeckPosition,
    getDeckPlaybackSnapshot: _getDeckPlaybackSnapshot,
    setDeckLoopParams,
    setDeckPlaybackRate,
    setDeckPlaybackOffset,
    getCurrentTime,
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

  const evaluateSimpleAutomationValue = useCallback(
    (
      entry: {
        baseline: number;
        target: number;
        cycleSec: number;
        samples?: number[];
        sampleRate?: number;
        durationSec?: number;
      },
      elapsedSec: number
    ) => {
      const samples = entry.samples;
      const durationSec = entry.durationSec;
      if (samples && samples.length > 1 && durationSec && durationSec > 0) {
        const sampleRate = Math.max(5, entry.sampleRate ?? samples.length / durationSec);
        const positionSec = elapsedSec % durationSec;
        const index = Math.min(
          samples.length - 1,
          Math.max(0, Math.floor(positionSec * sampleRate))
        );
        return samples[index] ?? entry.target;
      }
      const cycle = Math.max(0.25, entry.cycleSec);
      const phase = (elapsedSec / cycle) % 1;
      const shape = (Math.sin(phase * Math.PI * 2) + 1) * 0.5;
      return entry.baseline + (entry.target - entry.baseline) * shape;
    },
    []
  );

  const ensureSimpleAutomationRuntimeTrack = useCallback(
    (deckId: number, param: SimpleAutomationParam) => {
      let deckRuntime = simpleAutomationRuntimeRef.current.get(deckId);
      if (!deckRuntime) {
        deckRuntime = {};
        simpleAutomationRuntimeRef.current.set(deckId, deckRuntime);
      }
      let track = deckRuntime[param];
      if (!track) {
        track = {
          playbackStartMs: performance.now(),
          paused: false,
          pausedPositionSec: 0,
        };
        deckRuntime[param] = track;
      }
      return track;
    },
    []
  );

  const applySimpleAutomationValue = useCallback(
    (deckId: number, param: SimpleAutomationParam, value: number) => {
      const limits = SIMPLE_AUTOMATION_PARAM_LIMITS[param];
      const clamped = clamp(value, limits.min, limits.max);
      const updateDeckValue = <K extends keyof DeckState>(
        key: K,
        nextValue: DeckState[K],
        epsilon = FX_ACTIVE_EPSILON
      ) => {
        setDecks((prev) =>
          prev.map((deck) => {
            if (deck.id !== deckId) return deck;
            const current = deck[key];
            if (typeof current === "number" && typeof nextValue === "number") {
              if (approxEqual(current, nextValue, epsilon)) return deck;
            } else if (current === nextValue) {
              return deck;
            }
            return { ...deck, [key]: nextValue };
          })
        );
      };
      if (param === "delayTime") {
        setDeckDelayTime(deckId, clamped);
        updateDeckValue("delayTime", clamped);
        return;
      }
      if (param === "delayFeedback") {
        setDeckDelayFeedback(deckId, clamped);
        updateDeckValue("delayFeedback", clamped);
        return;
      }
      if (param === "delayMix") {
        setDeckDelayMix(deckId, clamped);
        updateDeckValue("delayMix", clamped);
        return;
      }
      if (param === "delayTone") {
        setDeckDelayTone(deckId, clamped);
        updateDeckValue("delayTone", clamped, 0.5);
        return;
      }
      if (param === "delaySaturation") {
        setDeckDelaySaturation(deckId, clamped);
        updateDeckValue("delaySaturation", clamped);
        return;
      }
      if (param === "delayDamping") {
        setDeckDelayDamping(deckId, clamped);
        updateDeckValue("delayDamping", clamped);
        return;
      }
      if (param === "delaySafety") {
        setDeckDelaySafety(deckId, clamped);
        updateDeckValue("delaySafety", clamped);
        return;
      }
      if (param === "vocoderMix") {
        setDeckVocoderMix(deckId, clamped);
        updateDeckValue("vocoderMix", clamped);
        return;
      }
      if (param === "vocoderModulatorMonitor") {
        setDeckVocoderModulatorMonitor(deckId, clamped);
        updateDeckValue("vocoderModulatorMonitor", clamped);
        return;
      }
      if (param === "vocoderModDrive") {
        setDeckVocoderModDrive(deckId, clamped);
        updateDeckValue("vocoderModDrive", clamped);
        return;
      }
      if (param === "vocoderBandCount") {
        const rounded = Math.round(clamped);
        setDeckVocoderBandCount(deckId, rounded);
        updateDeckValue("vocoderBandCount", rounded, 0);
        return;
      }
      if (param === "vocoderBandSpread") {
        setDeckVocoderBandSpread(deckId, clamped);
        updateDeckValue("vocoderBandSpread", clamped);
        return;
      }
      if (param === "vocoderAttackMs") {
        setDeckVocoderAttackMs(deckId, clamped);
        updateDeckValue("vocoderAttackMs", clamped, 0.5);
        return;
      }
      if (param === "vocoderReleaseMs") {
        setDeckVocoderReleaseMs(deckId, clamped);
        updateDeckValue("vocoderReleaseMs", clamped, 0.5);
        return;
      }
      if (param === "vocoderNoiseMix") {
        setDeckVocoderNoiseMix(deckId, clamped);
        updateDeckValue("vocoderNoiseMix", clamped);
        return;
      }
      if (param === "vocoderGateThreshold") {
        setDeckVocoderGateThreshold(deckId, clamped);
        updateDeckValue("vocoderGateThreshold", clamped);
        return;
      }
      if (param === "rearrangerSwapCount") {
        const rounded = Math.round(clamped);
        updateDeckValue("rearrangerSwapCount", rounded, 0);
        return;
      }
      if (param === "rearrangerChaos") {
        updateDeckValue("rearrangerChaos", clamped);
        return;
      }
      if (param === "rearrangerReverse") {
        updateDeckValue("rearrangerReverse", clamped);
        return;
      }
      if (param === "rearrangerSliceFadeMs") {
        const rounded = Math.round(clamped);
        updateDeckValue("rearrangerSliceFadeMs", rounded, 0);
        return;
      }
      if (param === "rearrangerSliceDelaySec") {
        updateDeckValue("rearrangerSliceDelaySec", clamped, 0.005);
        return;
      }
      if (param === "rearrangerPingPong") {
        setDeckRearrangerPingPongAmount(deckId, clamped);
        updateDeckValue("rearrangerPingPong", clamped);
      }
    },
    [
      setDeckDelayDamping,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelaySafety,
      setDeckDelaySaturation,
      setDeckDelayTime,
      setDeckDelayTone,
      setDeckVocoderAttackMs,
      setDeckVocoderBandCount,
      setDeckVocoderBandSpread,
      setDeckVocoderGateThreshold,
      setDeckVocoderMix,
      setDeckVocoderModDrive,
      setDeckVocoderModulatorMonitor,
      setDeckVocoderNoiseMix,
      setDeckVocoderReleaseMs,
      setDeckRearrangerPingPongAmount,
      setDecks,
    ]
  );

  const pauseSimpleAutomationDeck = useCallback(
    (deckId: number) => {
      const deck = decksRef.current.find((item) => item.id === deckId);
      if (!deck) return;
      const deckRuntime = simpleAutomationRuntimeRef.current.get(deckId);
      if (!deckRuntime) return;
      const now = performance.now();
      (Object.keys(deck.simpleAutomation ?? {}) as SimpleAutomationParam[]).forEach((param) => {
        const entry = deck.simpleAutomation?.[param];
        if (!entry?.active) return;
        const track = deckRuntime[param];
        if (!track || track.paused) return;
        track.pausedPositionSec = Math.max(0, (now - track.playbackStartMs) / 1000);
        track.paused = true;
      });
    },
    []
  );

  const resumeSimpleAutomationDeck = useCallback(
    (deckId: number) => {
      const deck = decksRef.current.find((item) => item.id === deckId);
      if (!deck) return;
      const now = performance.now();
      (Object.keys(deck.simpleAutomation ?? {}) as SimpleAutomationParam[]).forEach((param) => {
        const entry = deck.simpleAutomation?.[param];
        if (!entry?.active) return;
        const track = ensureSimpleAutomationRuntimeTrack(deckId, param);
        if (track.paused) {
          track.playbackStartMs = now - track.pausedPositionSec * 1000;
          track.paused = false;
          return;
        }
        if (track.playbackStartMs <= 0) {
          track.playbackStartMs = now;
        }
      });
    },
    [ensureSimpleAutomationRuntimeTrack]
  );

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
    if (!enabled) {
      enabled = decks.some((deck) =>
        deck.status === "playing" &&
        Object.values(deck.simpleAutomation ?? {}).some((entry) => entry?.active)
      );
    }
    if (automationTickEnabledRef.current !== enabled) {
      automationTickEnabledRef.current = enabled;
      setAutomationTickEnabled(enabled);
    }
  }, [decks]);

  useEffect(() => {
    updateAutomationTickEnabled();
  }, [decks, updateAutomationTickEnabled]);

  useEffect(() => {
    const ids = new Set(decks.map((deck) => deck.id));
    simpleAutomationRuntimeRef.current.forEach((_, deckId) => {
      if (!ids.has(deckId)) {
        simpleAutomationRuntimeRef.current.delete(deckId);
      }
    });
  }, [decks]);

  const applyDeckSettingsToEngine = useCallback(
    (
      deckId: number,
      settings: {
        gain: number;
        djFilter: number;
        filterResonance: number;
        eqMode: EqMode;
        eqLowGain: number;
        eqMidGain: number;
        eqHighGain: number;
        parametricEqBands: ParametricEqBand[];
        balance: number;
        pitchShift: number;
        vocoderMix: number;
        vocoderCarrierDeckId: number | null;
        vocoderModulatorMonitor: number;
        vocoderModDrive: number;
        vocoderBandCount: number;
        vocoderBandSpread: number;
        vocoderAttackMs: number;
        vocoderReleaseMs: number;
        vocoderNoiseMix: number;
        vocoderGateThreshold: number;
        includeInRecordExport: boolean;
        tempoOffset: number;
        delayTime: number;
        delayFeedback: number;
        delayMix: number;
        delayTone: number;
        delayPingPong: boolean;
        delaySliceSync?: boolean;
        delaySaturation?: number;
        delayDamping?: number;
        delaySafety?: number;
      }
    ) => {
      const targets = getFilterTargets(settings.djFilter);
      setDeckGain(deckId, settings.gain);
      setDeckFilter(deckId, targets.lowpass);
      setDeckHighpass(deckId, targets.highpass);
      setDeckResonance(deckId, settings.filterResonance);
      setDeckEqMode(deckId, settings.eqMode);
      setDeckEqLow(deckId, settings.eqLowGain);
      setDeckEqMid(deckId, settings.eqMidGain);
      setDeckEqHigh(deckId, settings.eqHighGain);
      setDeckParametricEqBands(deckId, settings.parametricEqBands);
      setDeckBalance(deckId, settings.balance);
      setDeckPitchShift(deckId, settings.pitchShift);
      setDeckVocoderMix(deckId, settings.vocoderMix);
      setDeckVocoderCarrierDeckId(deckId, settings.vocoderCarrierDeckId);
      setDeckVocoderModulatorMonitor(deckId, settings.vocoderModulatorMonitor);
      setDeckVocoderModDrive(deckId, settings.vocoderModDrive);
      setDeckVocoderBandCount(deckId, settings.vocoderBandCount);
      setDeckVocoderBandSpread(deckId, settings.vocoderBandSpread);
      setDeckVocoderAttackMs(deckId, settings.vocoderAttackMs);
      setDeckVocoderReleaseMs(deckId, settings.vocoderReleaseMs);
      setDeckVocoderNoiseMix(deckId, settings.vocoderNoiseMix);
      setDeckVocoderGateThreshold(deckId, settings.vocoderGateThreshold);
      setDeckRecordExportSend(deckId, settings.includeInRecordExport);
      setDeckDelayTime(deckId, settings.delayTime);
      setDeckDelayFeedback(deckId, settings.delayFeedback);
      setDeckDelayMix(deckId, settings.delayMix);
      setDeckDelayTone(deckId, settings.delayTone);
      setDeckDelayPingPong(deckId, settings.delayPingPong);
      setDeckDelaySaturation(
        deckId,
        settings.delaySaturation ?? DEFAULT_DELAY_SATURATION
      );
      setDeckDelayDamping(deckId, settings.delayDamping ?? DEFAULT_DELAY_DAMPING);
      setDeckDelaySafety(deckId, settings.delaySafety ?? DEFAULT_DELAY_SAFETY);
      setDeckPlaybackRate(deckId, clampPlaybackRate(1 + settings.tempoOffset / 100));
    },
    [
      getFilterTargets,
      setDeckBalance,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelayPingPong,
      setDeckDelaySaturation,
      setDeckDelayDamping,
      setDeckDelaySafety,
      setDeckDelayTime,
      setDeckDelayTone,
      setDeckEqMode,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckParametricEqBands,
      setDeckFilter,
      setDeckGain,
      setDeckHighpass,
      setDeckPitchShift,
      setDeckVocoderMix,
      setDeckVocoderCarrierDeckId,
      setDeckVocoderModulatorMonitor,
      setDeckVocoderModDrive,
      setDeckVocoderBandCount,
      setDeckVocoderBandSpread,
      setDeckVocoderAttackMs,
      setDeckVocoderReleaseMs,
      setDeckVocoderNoiseMix,
      setDeckVocoderGateThreshold,
      setDeckRecordExportSend,
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
        setDeckEqMode(deck.id, deck.eqMode);
        setDeckParametricEqBands(deck.id, deck.parametricEqBands);
        setDeckBalance(deck.id, deck.balance);
        setDeckDelayTime(deck.id, deck.delayTime);
        setDeckDelayFeedback(deck.id, deck.delayFeedback);
        setDeckDelayMix(deck.id, deck.delayMix);
        setDeckDelayTone(deck.id, deck.delayTone);
        setDeckDelayPingPong(deck.id, deck.delayPingPong);
        setDeckDelaySaturation(deck.id, deck.delaySaturation ?? DEFAULT_DELAY_SATURATION);
        setDeckDelayDamping(deck.id, deck.delayDamping ?? DEFAULT_DELAY_DAMPING);
        setDeckDelaySafety(deck.id, deck.delaySafety ?? DEFAULT_DELAY_SAFETY);
        setDeckVocoderMix(deck.id, deck.vocoderMix);
        setDeckVocoderCarrierDeckId(deck.id, deck.vocoderCarrierDeckId);
        setDeckVocoderModulatorMonitor(deck.id, deck.vocoderModulatorMonitor);
        setDeckVocoderModDrive(deck.id, deck.vocoderModDrive);
        setDeckVocoderBandCount(deck.id, deck.vocoderBandCount);
        setDeckVocoderBandSpread(deck.id, deck.vocoderBandSpread);
        setDeckVocoderAttackMs(deck.id, deck.vocoderAttackMs);
        setDeckVocoderReleaseMs(deck.id, deck.vocoderReleaseMs);
        setDeckVocoderNoiseMix(deck.id, deck.vocoderNoiseMix);
        setDeckVocoderGateThreshold(deck.id, deck.vocoderGateThreshold);
        setDeckRecordExportSend(deck.id, deck.includeInRecordExport);
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
            deck.eqMode,
            deck.eqLowGain,
            deck.eqMidGain,
            deck.eqHighGain,
            deck.parametricEqBands,
            deck.delayTime,
          deck.delayFeedback,
          deck.delayMix,
          deck.delayTone,
          deck.delayPingPong,
          deck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
          deck.delayDamping ?? DEFAULT_DELAY_DAMPING,
          deck.delaySafety ?? DEFAULT_DELAY_SAFETY,
          deck.vocoderMix,
          deck.vocoderCarrierDeckId,
          deck.vocoderModulatorMonitor,
          deck.vocoderModDrive,
          deck.vocoderBandCount,
          deck.vocoderBandSpread,
          deck.vocoderAttackMs,
          deck.vocoderReleaseMs,
          deck.vocoderNoiseMix,
          deck.vocoderGateThreshold,
          deck.balance,
          deck.pitchShift
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
      setDeckEqMode,
      setDeckEqLow,
      setDeckEqMid,
      setDeckParametricEqBands,
      setDeckFilter,
      setDeckGain,
      setDeckDelayTime,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelayTone,
      setDeckDelayPingPong,
      setDeckDelaySaturation,
      setDeckDelayDamping,
      setDeckDelaySafety,
      setDeckVocoderMix,
      setDeckVocoderCarrierDeckId,
      setDeckVocoderModulatorMonitor,
      setDeckVocoderModDrive,
      setDeckVocoderBandCount,
      setDeckVocoderBandSpread,
      setDeckVocoderAttackMs,
      setDeckVocoderReleaseMs,
      setDeckVocoderNoiseMix,
      setDeckVocoderGateThreshold,
      setDeckRecordExportSend,
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

      decksRef.current.forEach((deck) => {
        if (deck.status !== "playing") return;
        (Object.keys(deck.simpleAutomation ?? {}) as SimpleAutomationParam[]).forEach((param) => {
          const entry = deck.simpleAutomation?.[param];
          if (!entry?.active) return;
          const runtime = ensureSimpleAutomationRuntimeTrack(deck.id, param);
          if (runtime.paused) return;
          const elapsedSec = Math.max(0, (now - runtime.playbackStartMs) / 1000);
          const value = evaluateSimpleAutomationValue(entry, elapsedSec);
          applySimpleAutomationValue(deck.id, param, value);
        });
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
    evaluateSimpleAutomationValue,
    applySimpleAutomationValue,
    ensureSimpleAutomationRuntimeTrack,
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

  const addDeck = (options?: { afterId?: number }) => {
    const id = nextDeckId.current;
    nextDeckId.current += 1;
    resetAutomation(id, 0.9, 0, DEFAULT_RESONANCE, 0, 0, 0, 0, 0);
    setDecksWithHistory((prev) => {
      const nextDeck: DeckState = {
        id,
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
        simpleAutomation: {},
        includeInRecordExport: true,
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
      };
      if (options?.afterId !== undefined) {
        const index = prev.findIndex((deck) => deck.id === options.afterId);
        if (index >= 0) {
          return [...prev.slice(0, index + 1), nextDeck, ...prev.slice(index + 1)];
        }
      }
      return [...prev, nextDeck];
    });
    return id;
  };

  const removeDeck = (id: number) => {
    setDecksWithHistory((prev) => {
      stop(id);
      removeDeckNodes(id);
      playbackStartRef.current.delete(id);
      simpleAutomationRuntimeRef.current.delete(id);
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
            eqMode: DEFAULT_EQ_MODE,
            parametricEqBands: cloneDefaultParametricEqBands(),
            parametricEqMotion: { ...DEFAULT_PARAMETRIC_EQ_MOTION_STATE },
            simpleAutomation: {},
            includeInRecordExport: true,
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
      }
      return prev.filter((deck) => deck.id !== id);
    });
  };

  const reorderDecks = useCallback(
    (sourceDeckId: number, targetDeckId: number, position: "before" | "after" = "before") => {
      if (sourceDeckId === targetDeckId) return;
      setDecksWithHistory((prev) => {
        const sourceIndex = prev.findIndex((deck) => deck.id === sourceDeckId);
        const targetIndex = prev.findIndex((deck) => deck.id === targetDeckId);
        if (sourceIndex < 0 || targetIndex < 0) return prev;

        const next = [...prev];
        const [moved] = next.splice(sourceIndex, 1);
        if (!moved) return prev;

        const nextTargetIndex = next.findIndex((deck) => deck.id === targetDeckId);
        if (nextTargetIndex < 0) return prev;
        const insertIndex =
          position === "after"
            ? Math.min(next.length, nextTargetIndex + 1)
            : Math.max(0, nextTargetIndex);
        next.splice(insertIndex, 0, moved);
        return next;
      });
    },
    [setDecksWithHistory]
  );

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
    const hadExistingBuffer = Boolean(currentDeck?.buffer);
    if (hadExistingBuffer) {
      stop(id);
      playbackStartRef.current.delete(id);
      removeDeckNodes(id);
    }
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
    const nextEqMode = clipSettings?.eqMode ?? DEFAULT_EQ_MODE;
    const nextParametricEqBands = normalizeParametricEqBands(
      clipSettings?.parametricEqBands
    );
    const nextSimpleAutomation = normalizeSimpleAutomation(clipSettings?.simpleAutomation);
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
    const nextDelaySaturation = clipSettings?.delaySaturation ?? DEFAULT_DELAY_SATURATION;
    const nextDelayDamping = clipSettings?.delayDamping ?? DEFAULT_DELAY_DAMPING;
    const nextDelaySafety = clipSettings?.delaySafety ?? DEFAULT_DELAY_SAFETY;
    const nextVocoderMix = clipSettings?.vocoderMix ?? DEFAULT_VOCODER_MIX;
    const nextVocoderCarrierDeckId =
      clipSettings?.vocoderCarrierDeckId ?? DEFAULT_VOCODER_CARRIER_DECK_ID;
    const nextVocoderModulatorMonitor =
      clipSettings?.vocoderModulatorMonitor ?? DEFAULT_VOCODER_MODULATOR_MONITOR;
    const nextVocoderModDrive =
      clipSettings?.vocoderModDrive ?? DEFAULT_VOCODER_MOD_DRIVE;
    const nextVocoderBandCount =
      clipSettings?.vocoderBandCount ?? DEFAULT_VOCODER_BAND_COUNT;
    const nextVocoderBandSpread =
      clipSettings?.vocoderBandSpread ?? DEFAULT_VOCODER_BAND_SPREAD;
    const nextVocoderAttackMs =
      clipSettings?.vocoderAttackMs ?? DEFAULT_VOCODER_ATTACK_MS;
    const nextVocoderReleaseMs =
      clipSettings?.vocoderReleaseMs ?? DEFAULT_VOCODER_RELEASE_MS;
    const nextVocoderNoiseMix =
      clipSettings?.vocoderNoiseMix ?? DEFAULT_VOCODER_NOISE_MIX;
    const nextVocoderGateThreshold =
      clipSettings?.vocoderGateThreshold ?? DEFAULT_VOCODER_GATE_THRESHOLD;
    const nextRearrangerSlices = Math.max(
      0,
      Math.min(MAX_REARRANGER_SLICES, Math.round(clipSettings?.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES))
    );
    const nextRearrangerSwapCount = Math.max(
      0,
      Math.min(
        MAX_REARRANGER_SLICES,
        Math.round(clipSettings?.rearrangerSwapCount ?? DEFAULT_REARRANGER_SWAP_COUNT)
      )
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
    const nextRearrangerSliceFadeMs = Math.max(
      0,
      Math.min(12, clipSettings?.rearrangerSliceFadeMs ?? DEFAULT_REARRANGER_SLICE_FADE_MS)
    );
    const nextRearrangerSliceDelaySec = Math.max(
      0,
      Math.min(5, clipSettings?.rearrangerSliceDelaySec ?? DEFAULT_REARRANGER_SLICE_DELAY_SEC)
    );
    const nextRearrangerPingPong = Math.max(
      0,
      Math.min(1, clipSettings?.rearrangerPingPong ?? DEFAULT_REARRANGER_PINGPONG)
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
        parametricEq:
          currentPanels.parametricEq ||
          nextEqMode === "parametric" ||
          nextParametricEqBands.some(
            (band) => band.enabled && (Math.abs(band.gain) > FX_ACTIVE_EPSILON || Math.abs(band.q - 1) > 1e-3)
          ),
        balance:
          currentPanels.balance || !approxEqual(nextBalance, 0) || hasActiveAutomation("balance"),
        pitch: currentPanels.pitch || !approxEqual(nextPitchShift, 0) || hasActiveAutomation("pitch"),
        vocoder:
          currentPanels.vocoder ||
          nextVocoderMix > FX_ACTIVE_EPSILON ||
          nextVocoderCarrierDeckId !== DEFAULT_VOCODER_CARRIER_DECK_ID ||
          nextVocoderModulatorMonitor > FX_ACTIVE_EPSILON ||
          !approxEqual(nextVocoderModDrive, DEFAULT_VOCODER_MOD_DRIVE) ||
          Math.round(nextVocoderBandCount) !== DEFAULT_VOCODER_BAND_COUNT ||
          !approxEqual(nextVocoderBandSpread, DEFAULT_VOCODER_BAND_SPREAD) ||
          !approxEqual(nextVocoderAttackMs, DEFAULT_VOCODER_ATTACK_MS) ||
          !approxEqual(nextVocoderReleaseMs, DEFAULT_VOCODER_RELEASE_MS) ||
          nextVocoderNoiseMix > FX_ACTIVE_EPSILON ||
          nextVocoderGateThreshold > FX_ACTIVE_EPSILON,
        delay:
          currentPanels.delay ||
          nextDelayMix > FX_ACTIVE_EPSILON ||
          nextDelaySaturation > FX_ACTIVE_EPSILON ||
          nextDelayDamping > FX_ACTIVE_EPSILON ||
          !approxEqual(nextDelaySafety, DEFAULT_DELAY_SAFETY) ||
          nextDelaySliceSync,
        rearranger:
          currentPanels.rearranger ||
          nextRearrangerAuto ||
          nextRearrangerSlices !== DEFAULT_REARRANGER_SLICES ||
          nextRearrangerSwapCount !== DEFAULT_REARRANGER_SWAP_COUNT ||
          nextRearrangerChaos > FX_ACTIVE_EPSILON ||
          nextRearrangerReverse > FX_ACTIVE_EPSILON ||
          !approxEqual(nextRearrangerSensitivity, DEFAULT_REARRANGER_SENSITIVITY) ||
          !approxEqual(
            nextRearrangerQuietThreshold,
            DEFAULT_REARRANGER_QUIET_THRESHOLD
          ) ||
          !approxEqual(nextRearrangerSliceFadeMs, DEFAULT_REARRANGER_SLICE_FADE_MS) ||
          !approxEqual(nextRearrangerSliceDelaySec, DEFAULT_REARRANGER_SLICE_DELAY_SEC) ||
          !approxEqual(nextRearrangerPingPong, DEFAULT_REARRANGER_PINGPONG) ||
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
      eqMode: nextEqMode,
      parametricEqBands: nextParametricEqBands,
      balance: nextBalance,
      pitchShift: nextPitchShift,
      vocoderMix: nextVocoderMix,
      vocoderCarrierDeckId: nextVocoderCarrierDeckId,
      vocoderModulatorMonitor: nextVocoderModulatorMonitor,
      vocoderModDrive: nextVocoderModDrive,
      vocoderBandCount: nextVocoderBandCount,
      vocoderBandSpread: nextVocoderBandSpread,
      vocoderAttackMs: nextVocoderAttackMs,
      vocoderReleaseMs: nextVocoderReleaseMs,
      vocoderNoiseMix: nextVocoderNoiseMix,
      vocoderGateThreshold: nextVocoderGateThreshold,
      includeInRecordExport: currentDeck?.includeInRecordExport ?? true,
      tempoOffset: nextTempoOffset,
      delayTime: nextDelayTime,
      delayFeedback: nextDelayFeedback,
      delayMix: nextDelayMix,
      delayTone: nextDelayTone,
      delayPingPong: nextDelayPingPong,
      delaySliceSync: nextDelaySliceSync,
      delaySaturation: nextDelaySaturation,
      delayDamping: nextDelayDamping,
      delaySafety: nextDelaySafety,
    });
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
      eqMode: nextEqMode,
      parametricEqBands: nextParametricEqBands,
      simpleAutomation: nextSimpleAutomation,
      balance: nextBalance,
      pitchShift: nextPitchShift,
      vocoderMix: nextVocoderMix,
      vocoderCarrierDeckId: nextVocoderCarrierDeckId,
      vocoderModulatorMonitor: nextVocoderModulatorMonitor,
      vocoderModDrive: nextVocoderModDrive,
      vocoderBandCount: nextVocoderBandCount,
      vocoderBandSpread: nextVocoderBandSpread,
      vocoderAttackMs: nextVocoderAttackMs,
      vocoderReleaseMs: nextVocoderReleaseMs,
      vocoderNoiseMix: nextVocoderNoiseMix,
      vocoderGateThreshold: nextVocoderGateThreshold,
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
      delaySaturation: nextDelaySaturation,
      delayDamping: nextDelayDamping,
      delaySafety: nextDelaySafety,
      rearrangerSlices: nextRearrangerSlices,
      rearrangerSwapCount: nextRearrangerSwapCount,
      rearrangerChaos: nextRearrangerChaos,
      rearrangerReverse: nextRearrangerReverse,
      rearrangerSensitivity: nextRearrangerSensitivity,
      rearrangerQuietThreshold: nextRearrangerQuietThreshold,
      rearrangerSliceFadeMs: nextRearrangerSliceFadeMs,
      rearrangerSliceDelaySec: nextRearrangerSliceDelaySec,
      rearrangerPingPong: nextRearrangerPingPong,
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
    setDeckDelaySaturation(id, nextDelaySaturation);
    setDeckDelayDamping(id, nextDelayDamping);
    setDeckDelaySafety(id, nextDelaySafety);
    setDeckVocoderMix(id, nextVocoderMix);
    setDeckVocoderCarrierDeckId(id, nextVocoderCarrierDeckId);
    setDeckVocoderModulatorMonitor(id, nextVocoderModulatorMonitor);
    setDeckVocoderModDrive(id, nextVocoderModDrive);
    setDeckVocoderBandCount(id, nextVocoderBandCount);
    setDeckVocoderBandSpread(id, nextVocoderBandSpread);
    setDeckVocoderAttackMs(id, nextVocoderAttackMs);
    setDeckVocoderReleaseMs(id, nextVocoderReleaseMs);
    setDeckVocoderNoiseMix(id, nextVocoderNoiseMix);
    setDeckVocoderGateThreshold(id, nextVocoderGateThreshold);
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
        eqMode: nextEqMode,
        parametricEqBands: nextParametricEqBands,
        simpleAutomation: nextSimpleAutomation,
        balance: nextBalance,
        pitchShift: nextPitchShift,
        vocoderMix: nextVocoderMix,
        vocoderCarrierDeckId: nextVocoderCarrierDeckId,
        vocoderModulatorMonitor: nextVocoderModulatorMonitor,
        vocoderModDrive: nextVocoderModDrive,
      vocoderBandCount: nextVocoderBandCount,
      vocoderBandSpread: nextVocoderBandSpread,
      vocoderAttackMs: nextVocoderAttackMs,
      vocoderReleaseMs: nextVocoderReleaseMs,
      vocoderNoiseMix: nextVocoderNoiseMix,
      vocoderGateThreshold: nextVocoderGateThreshold,
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
        delaySaturation: nextDelaySaturation,
        delayDamping: nextDelayDamping,
        delaySafety: nextDelaySafety,
        rearrangerSlices: nextRearrangerSlices,
      rearrangerSwapCount: nextRearrangerSwapCount,
      rearrangerChaos: nextRearrangerChaos,
      rearrangerReverse: nextRearrangerReverse,
      rearrangerSensitivity: nextRearrangerSensitivity,
      rearrangerQuietThreshold: nextRearrangerQuietThreshold,
      rearrangerSliceFadeMs: nextRearrangerSliceFadeMs,
      rearrangerSliceDelaySec: nextRearrangerSliceDelaySec,
      rearrangerPingPong: nextRearrangerPingPong,
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
          nextEqMode,
          nextEqLow,
          nextEqMid,
          nextEqHigh,
          nextParametricEqBands,
          nextDelayTime,
          nextDelayFeedback,
          nextDelayMix,
          nextDelayTone,
          nextDelayPingPong,
          nextDelaySaturation,
          nextDelayDamping,
          nextDelaySafety,
          nextVocoderMix,
          nextVocoderCarrierDeckId,
          nextVocoderModulatorMonitor,
          nextVocoderModDrive,
          nextVocoderBandCount,
          nextVocoderBandSpread,
          nextVocoderAttackMs,
          nextVocoderReleaseMs,
          nextVocoderNoiseMix,
          nextVocoderGateThreshold,
          nextBalance,
          nextPitchShift
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
    resumeSimpleAutomationDeck(deck.id);
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
      deck.eqMode,
      deck.eqLowGain,
      deck.eqMidGain,
      deck.eqHighGain,
      deck.parametricEqBands,
      deck.delayTime,
      deck.delayFeedback,
      deck.delayMix,
      deck.delayTone,
      deck.delayPingPong,
      deck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
      deck.delayDamping ?? DEFAULT_DELAY_DAMPING,
      deck.delaySafety ?? DEFAULT_DELAY_SAFETY,
      deck.vocoderMix,
      deck.vocoderCarrierDeckId,
      deck.vocoderModulatorMonitor,
      deck.vocoderModDrive,
      deck.vocoderBandCount,
      deck.vocoderBandSpread,
      deck.vocoderAttackMs,
      deck.vocoderReleaseMs,
      deck.vocoderNoiseMix,
      deck.vocoderGateThreshold,
      deck.balance,
      deck.pitchShift
    );
    if (deck.status === "paused") {
      resumeAutomationDeck(deck.id);
      resumeSimpleAutomationDeck(deck.id);
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

  const resetAutomationDeck = (deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    const playheads = automationPlayheadRef.current.get(deckId);
    (Object.keys(automation) as AutomationParam[]).forEach((param) => {
      const track = automation[param];
      track.playbackStartMs = 0;
      track.paused = true;
      track.pausedPositionSec = 0;
      if (playheads) {
        playheads[param] = 0;
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

  const resetSimpleAutomationDeck = (deckId: number) => {
    const deck = decksRef.current.find((item) => item.id === deckId);
    if (!deck) return;
    const deckRuntime = simpleAutomationRuntimeRef.current.get(deckId);
    if (!deckRuntime) return;
    (Object.keys(deck.simpleAutomation ?? {}) as SimpleAutomationParam[]).forEach((param) => {
      const entry = deck.simpleAutomation?.[param];
      if (!entry?.active) return;
      const track = deckRuntime[param];
      if (!track) return;
      track.playbackStartMs = 0;
      track.paused = true;
      track.pausedPositionSec = 0;
    });
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
    pauseSimpleAutomationDeck(deck.id);
    updateDeck(deck.id, {
      status: "paused",
      startedAtMs: undefined,
      offsetSeconds,
    }, false);
  };

  const stopDeck = (deck: DeckState) => {
    stop(deck.id);
    playbackStartRef.current.delete(deck.id);
    resetAutomationDeck(deck.id);
    resetSimpleAutomationDeck(deck.id);
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
        deck.eqMode,
        deck.eqLowGain,
        deck.eqMidGain,
        deck.eqHighGain,
        deck.parametricEqBands,
        deck.delayTime,
        deck.delayFeedback,
        deck.delayMix,
        deck.delayTone,
        deck.delayPingPong,
        deck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
        deck.delayDamping ?? DEFAULT_DELAY_DAMPING,
        deck.delaySafety ?? DEFAULT_DELAY_SAFETY,
        deck.vocoderMix,
        deck.vocoderCarrierDeckId,
        deck.vocoderModulatorMonitor,
        deck.vocoderModDrive,
        deck.vocoderBandCount,
        deck.vocoderBandSpread,
        deck.vocoderAttackMs,
        deck.vocoderReleaseMs,
        deck.vocoderNoiseMix,
        deck.vocoderGateThreshold,
        deck.balance,
        deck.pitchShift
      );
      return;
    }

    updateDeck(id, { offsetSeconds }, false);
    setDeckPlaybackOffset(id, offsetSeconds);
  };

  const {
    setDeckGainValue,
    setDeckFilterValue,
    setDeckResonanceValue,
    setDeckEqLowValue,
    setDeckEqMidValue,
    setDeckEqHighValue,
    setDeckEqModeValue,
    setDeckParametricEqBandsValue,
    setDeckPitchShiftValue,
    setDeckDelayTimeValue,
    setDeckDelayFeedbackValue,
    setDeckDelayMixValue,
    setDeckDelayToneValue,
    setDeckDelayPingPongValue,
    setDeckDelaySaturationValue,
    setDeckDelayDampingValue,
    setDeckDelaySafetyValue,
    setDeckVocoderMixValue,
    setDeckVocoderCarrierDeckIdValue,
    setDeckVocoderModulatorMonitorValue,
    setDeckVocoderModDriveValue,
    setDeckVocoderBandCountValue,
    setDeckVocoderBandSpreadValue,
    setDeckVocoderAttackMsValue,
    setDeckVocoderReleaseMsValue,
    setDeckVocoderNoiseMixValue,
    setDeckVocoderGateThresholdValue,
    setDeckDelaySliceSyncValue,
    setDeckDelayTimeTransient,
    setDeckPlaybackRateTransient,
    setDeckPlaybackOffsetTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
    clearDeckRearrangerPanAutomationTransient,
    scheduleDeckRearrangerPanTransient,
  } = createDeckParameterSetters({
    decks,
    automationRef,
    getFilterTargets,
    updateDeck,
    updateAutomationView,
    updateAutomationTickEnabled,
    setDeckGain,
    setDeckFilter,
    setDeckHighpass,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckPitchShift,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderBandSpread,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckPlaybackRate,
    setDeckPlaybackOffset,
    setDeckRearrangerPan,
    setDeckRearrangerPingPongAmount,
    setDeckRearrangerPingPongConfig,
    clearDeckRearrangerPanAutomation,
    scheduleDeckRearrangerPan,
  });

  const {
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
  } = createDeckAutomationControls({
    decks,
    automationRef,
    automationPlayheadRef,
    ensureAutomationDeck,
    updateAutomationView,
    updateAutomationTickEnabled,
    setDeckGainValue,
    setDeckFilterValue,
    setDeckResonanceValue,
    setDeckEqLowValue,
    setDeckEqMidValue,
    setDeckEqHighValue,
    setDeckBalanceValue,
    setDeckPitchShiftValue,
  });

  const setDeckZoomValue = (id: number, value: number) => {
    updateDeck(id, { zoom: value }, false);
  };

  const {
    setDeckLoopValue,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
  } = createDeckLoopTempoControls({
    decks,
    setDecksNoHistory,
    setDeckLoopParams,
    setDeckPlaybackRate,
    setDeckPitchShift,
    getDeckPosition,
    getDeckPlaybackRate,
    getFilterTargets,
    getTempoSyncedPitch,
    playBuffer,
    updateDeck,
    playbackStartRef,
    loopBoundsHistorySnapshotRef,
    historyDisabledRef,
    recordHistory,
    snapshotDecks,
    automationRef,
    updateAutomationView,
    updateAutomationTickEnabled,
  });

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
        offsetSeconds?: number;
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
      const nextVocoderMix = preserveFxState ? deck.vocoderMix : DEFAULT_VOCODER_MIX;
      const nextVocoderCarrierDeckId = preserveFxState
        ? deck.vocoderCarrierDeckId
        : DEFAULT_VOCODER_CARRIER_DECK_ID;
      const nextVocoderModulatorMonitor = preserveFxState
        ? deck.vocoderModulatorMonitor
        : DEFAULT_VOCODER_MODULATOR_MONITOR;
      const nextVocoderModDrive = preserveFxState
        ? deck.vocoderModDrive
        : DEFAULT_VOCODER_MOD_DRIVE;
      const nextVocoderBandCount = preserveFxState
        ? deck.vocoderBandCount
        : DEFAULT_VOCODER_BAND_COUNT;
      const nextVocoderBandSpread = preserveFxState
        ? deck.vocoderBandSpread
        : DEFAULT_VOCODER_BAND_SPREAD;
      const nextVocoderAttackMs = preserveFxState
        ? deck.vocoderAttackMs
        : DEFAULT_VOCODER_ATTACK_MS;
      const nextVocoderReleaseMs = preserveFxState
        ? deck.vocoderReleaseMs
        : DEFAULT_VOCODER_RELEASE_MS;
      const nextVocoderNoiseMix = preserveFxState
        ? deck.vocoderNoiseMix
        : DEFAULT_VOCODER_NOISE_MIX;
      const nextVocoderGateThreshold = preserveFxState
        ? deck.vocoderGateThreshold
        : DEFAULT_VOCODER_GATE_THRESHOLD;
      const nextTempoOffset = preserveFxState ? deck.tempoOffset : 0;
      const nextTempoPitchSync = preserveFxState ? deck.tempoPitchSync : false;
      const nextDjFilter = preserveFxState ? deck.djFilter : 0;
      const nextResonance = preserveFxState ? deck.filterResonance : 0;
      const nextEqLow = preserveFxState ? deck.eqLowGain : 0;
      const nextEqMid = preserveFxState ? deck.eqMidGain : 0;
      const nextEqHigh = preserveFxState ? deck.eqHighGain : 0;
      const nextEqMode = preserveFxState ? deck.eqMode : DEFAULT_EQ_MODE;
      const nextParametricEqBands = preserveFxState
        ? normalizeParametricEqBands(deck.parametricEqBands)
        : cloneDefaultParametricEqBands();
      const nextParametricEqMotion = preserveFxState
        ? normalizeParametricEqMotionState(deck.parametricEqMotion)
        : { ...DEFAULT_PARAMETRIC_EQ_MOTION_STATE };
      const nextSimpleAutomation = preserveFxState
        ? normalizeSimpleAutomation(deck.simpleAutomation)
        : {};
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
      const nextDelaySaturation = deck.delaySaturation ?? DEFAULT_DELAY_SATURATION;
      const nextDelayDamping = deck.delayDamping ?? DEFAULT_DELAY_DAMPING;
      const nextDelaySafety = deck.delaySafety ?? DEFAULT_DELAY_SAFETY;
      const nextRearrangerSlices =
        options?.rearrangerSlices ?? deck.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES;
      const nextRearrangerSwapCount =
        deck.rearrangerSwapCount ?? DEFAULT_REARRANGER_SWAP_COUNT;
      const nextRearrangerChaos = deck.rearrangerChaos ?? DEFAULT_REARRANGER_CHAOS;
      const nextRearrangerReverse = deck.rearrangerReverse ?? DEFAULT_REARRANGER_REVERSE;
      const nextRearrangerSensitivity =
        deck.rearrangerSensitivity ?? DEFAULT_REARRANGER_SENSITIVITY;
      const nextRearrangerQuietThreshold =
        deck.rearrangerQuietThreshold ?? DEFAULT_REARRANGER_QUIET_THRESHOLD;
      const nextRearrangerSliceFadeMs =
        deck.rearrangerSliceFadeMs ?? DEFAULT_REARRANGER_SLICE_FADE_MS;
      const nextRearrangerSliceDelaySec =
        deck.rearrangerSliceDelaySec ?? DEFAULT_REARRANGER_SLICE_DELAY_SEC;
      const nextRearrangerPingPong =
        deck.rearrangerPingPong ?? DEFAULT_REARRANGER_PINGPONG;
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
      const nextOffsetSeconds = Math.min(
        Math.max(0, options?.offsetSeconds ?? 0),
        duration
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
        eqMode: nextEqMode,
        parametricEqBands: nextParametricEqBands,
        parametricEqMotion: nextParametricEqMotion,
        simpleAutomation: nextSimpleAutomation,
        balance: nextBalance,
        pitchShift: nextPitchShift,
        vocoderMix: nextVocoderMix,
        vocoderCarrierDeckId: nextVocoderCarrierDeckId,
        vocoderModulatorMonitor: nextVocoderModulatorMonitor,
        vocoderModDrive: nextVocoderModDrive,
      vocoderBandCount: nextVocoderBandCount,
      vocoderBandSpread: nextVocoderBandSpread,
      vocoderAttackMs: nextVocoderAttackMs,
      vocoderReleaseMs: nextVocoderReleaseMs,
      vocoderNoiseMix: nextVocoderNoiseMix,
      vocoderGateThreshold: nextVocoderGateThreshold,
        offsetSeconds: nextOffsetSeconds,
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
        delaySaturation: nextDelaySaturation,
        delayDamping: nextDelayDamping,
        delaySafety: nextDelaySafety,
        rearrangerSlices: nextRearrangerSlices,
        rearrangerSwapCount: nextRearrangerSwapCount,
        rearrangerChaos: nextRearrangerChaos,
        rearrangerReverse: nextRearrangerReverse,
        rearrangerSensitivity: nextRearrangerSensitivity,
        rearrangerQuietThreshold: nextRearrangerQuietThreshold,
        rearrangerSliceFadeMs: nextRearrangerSliceFadeMs,
        rearrangerSliceDelaySec: nextRearrangerSliceDelaySec,
        rearrangerPingPong: nextRearrangerPingPong,
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
      setDeckEqMode(id, nextEqMode);
      setDeckParametricEqBands(id, nextParametricEqBands);
      setDeckBalance(id, nextBalance);
      setDeckPitchShift(id, nextPitchShift);
      setDeckVocoderMix(id, nextVocoderMix);
      setDeckVocoderCarrierDeckId(id, nextVocoderCarrierDeckId);
      setDeckVocoderModulatorMonitor(id, nextVocoderModulatorMonitor);
      setDeckVocoderModDrive(id, nextVocoderModDrive);
      setDeckVocoderBandCount(id, nextVocoderBandCount);
      setDeckVocoderBandSpread(id, nextVocoderBandSpread);
      setDeckVocoderAttackMs(id, nextVocoderAttackMs);
      setDeckVocoderReleaseMs(id, nextVocoderReleaseMs);
      setDeckVocoderNoiseMix(id, nextVocoderNoiseMix);
      setDeckVocoderGateThreshold(id, nextVocoderGateThreshold);
      setDeckRecordExportSend(id, nextDeck.includeInRecordExport);
      setDeckDelayTime(id, nextDelayTime);
      setDeckDelayFeedback(id, nextDelayFeedback);
      setDeckDelayMix(id, nextDelayMix);
      setDeckDelayTone(id, nextDelayTone);
      setDeckDelayPingPong(id, nextDelayPingPong);
      setDeckDelaySaturation(id, nextDelaySaturation);
      setDeckDelayDamping(id, nextDelayDamping);
      setDeckDelaySafety(id, nextDelaySafety);
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
          nextOffsetSeconds,
          tempoRatio,
          true,
          0,
          duration,
          filterTargets.lowpass,
          filterTargets.highpass,
            nextResonance,
            nextEqMode,
            nextEqLow,
            nextEqMid,
            nextEqHigh,
            nextParametricEqBands,
            nextDelayTime,
          nextDelayFeedback,
          nextDelayMix,
          nextDelayTone,
          nextDelayPingPong,
          nextDelaySaturation,
          nextDelayDamping,
          nextDelaySafety,
          nextVocoderMix,
          nextVocoderCarrierDeckId,
          nextVocoderModulatorMonitor,
          nextVocoderModDrive,
          nextVocoderBandCount,
          nextVocoderBandSpread,
          nextVocoderAttackMs,
          nextVocoderReleaseMs,
          nextVocoderNoiseMix,
          nextVocoderGateThreshold,
          nextBalance,
          nextPitchShift
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
      setDeckDelaySaturation,
      setDeckDelayDamping,
      setDeckDelaySafety,
      setDeckDelayTime,
      setDeckDelayTone,
      setDeckEqHigh,
      setDeckEqMode,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckGain,
      setDeckHighpass,
      setDeckLoopParams,
      setDeckParametricEqBands,
      setDeckPitchShift,
      setDeckVocoderMix,
      setDeckVocoderCarrierDeckId,
      setDeckVocoderModulatorMonitor,
      setDeckVocoderModDrive,
      setDeckVocoderBandCount,
      setDeckVocoderBandSpread,
      setDeckVocoderAttackMs,
      setDeckVocoderReleaseMs,
      setDeckVocoderNoiseMix,
      setDeckVocoderGateThreshold,
      setDeckRecordExportSend,
      setDeckPlaybackRate,
      setDeckResonance,
      setDecksWithHistory,
      setDecksNoHistory,
      stop,
      updateDeck,
    ]
  );

  const {
    setDeckIncludeInRecordExport,
    setDeckStretchRatio,
    setDeckStretchWindowSize,
    setDeckStretchStereoWidth,
    setDeckStretchPhaseRandomness,
    setDeckStretchTiltDb,
    setDeckStretchScatter,
    setDeckWidthOverride,
    setDeckRearrangerSlices,
    setDeckRearrangerSwapCount,
    setDeckRearrangerChaos,
    setDeckRearrangerReverse,
    setDeckRearrangerSensitivity,
    setDeckRearrangerQuietThreshold,
    setDeckRearrangerSliceFadeMs,
    setDeckRearrangerSliceDelaySec,
    setDeckRearrangerPingPong,
    setDeckRearrangerAuto,
    setDeckRearrangerRegions,
    setDeckFxPanelOpen,
    setDeckFxPanelsOpen,
  } = createDeckUiSetters({
    updateDeck,
    setDecksNoHistory,
    setDeckRecordExportSend,
  });

  const setDeckParametricEqMotion = useCallback(
    (
      id: number,
      value: {
        preset: "sweep" | null;
        cycleSec: number;
        automationActive: boolean;
        targetBandId: string | null;
      }
    ) => {
      updateDeck(id, { parametricEqMotion: normalizeParametricEqMotionState(value) }, false);
    },
    [updateDeck]
  );

  const setDeckSimpleAutomation = useCallback(
    (
      id: number,
      param: SimpleAutomationParam,
      target: number,
      baseline: number,
      recording?: {
        samples: number[];
        sampleRate: number;
        durationSec: number;
      }
    ) => {
      const limits = SIMPLE_AUTOMATION_PARAM_LIMITS[param];
      const deck = decks.find((item) => item.id === id);
      if (!deck) return;
      const resolvedBaseline = clamp(baseline, limits.min, limits.max);
      const resolvedTarget = clamp(target, limits.min, limits.max);
      const normalizedSamples = Array.isArray(recording?.samples)
        ? recording!.samples
            .filter((item) => Number.isFinite(item))
            .map((item) => clamp(Number(item), limits.min, limits.max))
        : undefined;
      const resolvedDurationSec = Number.isFinite(recording?.durationSec)
        ? clamp(Number(recording?.durationSec), 0.05, 600)
        : undefined;
      const resolvedSampleRate = Number.isFinite(recording?.sampleRate)
        ? clamp(Number(recording?.sampleRate), 5, 240)
        : undefined;
      updateDeck(
        id,
        {
          simpleAutomation: {
            ...(normalizeSimpleAutomation(
              deck.simpleAutomation
            ) as DeckSimpleAutomation),
            [param]: {
              active: true,
              baseline: resolvedBaseline,
              target: resolvedTarget,
              cycleSec: 4,
              samples:
                normalizedSamples && normalizedSamples.length > 1
                  ? normalizedSamples
                  : undefined,
              sampleRate:
                normalizedSamples && normalizedSamples.length > 1
                  ? resolvedSampleRate
                  : undefined,
              durationSec:
                normalizedSamples && normalizedSamples.length > 1
                  ? resolvedDurationSec
                  : undefined,
            },
          },
        },
        false
      );
      const track = ensureSimpleAutomationRuntimeTrack(id, param);
      if (deck.status === "playing") {
        track.playbackStartMs = performance.now();
        track.paused = false;
        track.pausedPositionSec = 0;
      } else {
        track.playbackStartMs = 0;
        track.paused = true;
        track.pausedPositionSec = 0;
      }
      applySimpleAutomationValue(id, param, resolvedTarget);
      updateAutomationTickEnabled();
    },
    [
      applySimpleAutomationValue,
      decks,
      ensureSimpleAutomationRuntimeTrack,
      updateAutomationTickEnabled,
      updateDeck,
    ]
  );

  const clearDeckSimpleAutomation = useCallback(
    (id: number, param: SimpleAutomationParam) => {
      const deck = decks.find((item) => item.id === id);
      if (!deck) return;
      const next = { ...(normalizeSimpleAutomation(deck.simpleAutomation) as DeckSimpleAutomation) };
      delete next[param];
      updateDeck(id, { simpleAutomation: next }, false);
      const deckRuntime = simpleAutomationRuntimeRef.current.get(id);
      if (deckRuntime) {
        delete deckRuntime[param];
        if (Object.keys(deckRuntime).length === 0) {
          simpleAutomationRuntimeRef.current.delete(id);
        }
      }
      updateAutomationTickEnabled();
    },
    [decks, updateAutomationTickEnabled, updateDeck]
  );

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
        eqMode: DEFAULT_EQ_MODE,
        eqLowGain: 0,
        eqMidGain: 0,
        eqHighGain: 0,
        parametricEqBands: cloneDefaultParametricEqBands(),
        balance: 0,
        pitchShift: nextPitchShift,
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
      includeInRecordExport: deck.includeInRecordExport,
        tempoOffset: deck.tempoOffset,
        delayTime: DEFAULT_DELAY_TIME,
        delayFeedback: DEFAULT_DELAY_FEEDBACK,
        delayMix: DEFAULT_DELAY_MIX,
        delayTone: DEFAULT_DELAY_TONE,
        delayPingPong: DEFAULT_DELAY_PINGPONG,
        delaySaturation: DEFAULT_DELAY_SATURATION,
        delayDamping: DEFAULT_DELAY_DAMPING,
        delaySafety: DEFAULT_DELAY_SAFETY,
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
          eqMode: DEFAULT_EQ_MODE,
          eqLowGain: 0,
          eqMidGain: 0,
          eqHighGain: 0,
          parametricEqBands: cloneDefaultParametricEqBands(),
          parametricEqMotion: { ...DEFAULT_PARAMETRIC_EQ_MOTION_STATE },
          simpleAutomation: {},
          balance: 0,
          pitchShift: nextPitchShift,
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
    return decks.map((deck) =>
      serializeDeckSession(deck, automationRef.current.get(deck.id))
    );
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
        const hydrated = hydrateDeckFromSession(
          sessionDeck,
          buffers.get(sessionDeck.id) ?? undefined
        );

        automationRef.current.set(sessionDeck.id, hydrated.automation);
        setDeckRecordExportSend(sessionDeck.id, hydrated.deck.includeInRecordExport);
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
        nextAutomationState.set(sessionDeck.id, hydrated.automationView);

        maxDeckId = Math.max(maxDeckId, sessionDeck.id);
        return hydrated.deck;
      });

      nextDeckId.current = Math.max(2, maxDeckId + 1);
      historyRef.current = { past: [], future: [] };
      syncHistoryState();
      setDecksNoHistory(() => nextDecks);
      setAutomationState(nextAutomationState);
      updateAutomationTickEnabled();
    },
    [
      decks,
      removeDeckNodes,
      setDeckRecordExportSend,
      setDecksNoHistory,
      stop,
      syncHistoryState,
      updateAutomationTickEnabled,
    ]
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
    setDecksNoHistory(() => buildInitialDecks());
    setAutomationState(new Map());
    updateAutomationTickEnabled();
  }, [
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
    reorderDecks,
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
    setDeckEqMode: setDeckEqModeValue,
    setDeckParametricEqBands: setDeckParametricEqBandsValue,
    setDeckParametricEqMotion,
    setDeckSimpleAutomation,
    clearDeckSimpleAutomation,
    setDeckBalance: setDeckBalanceValue,
    setDeckDelayTime: setDeckDelayTimeValue,
    setDeckDelayFeedback: setDeckDelayFeedbackValue,
    setDeckDelayMix: setDeckDelayMixValue,
    setDeckDelayTone: setDeckDelayToneValue,
    setDeckDelayPingPong: setDeckDelayPingPongValue,
    setDeckDelaySaturation: setDeckDelaySaturationValue,
    setDeckDelayDamping: setDeckDelayDampingValue,
    setDeckDelaySafety: setDeckDelaySafetyValue,
    setDeckVocoderMix: setDeckVocoderMixValue,
    setDeckVocoderCarrierDeckId: setDeckVocoderCarrierDeckIdValue,
    setDeckVocoderModulatorMonitor: setDeckVocoderModulatorMonitorValue,
    setDeckVocoderModDrive: setDeckVocoderModDriveValue,
    setDeckVocoderBandCount: setDeckVocoderBandCountValue,
    setDeckVocoderBandSpread: setDeckVocoderBandSpreadValue,
    setDeckVocoderAttackMs: setDeckVocoderAttackMsValue,
    setDeckVocoderReleaseMs: setDeckVocoderReleaseMsValue,
    setDeckVocoderNoiseMix: setDeckVocoderNoiseMixValue,
    setDeckVocoderGateThreshold: setDeckVocoderGateThresholdValue,
    setDeckDelaySliceSync: setDeckDelaySliceSyncValue,
    setDeckDelayTimeTransient,
    setDeckPlaybackRateTransient,
    setDeckPlaybackOffsetTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
    clearDeckRearrangerPanAutomationTransient,
    scheduleDeckRearrangerPanTransient,
    setDeckPitchShift: setDeckPitchShiftValue,
    seekDeck,
    setDeckZoom: setDeckZoomValue,
    setDeckLoop: setDeckLoopValue,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
    setDeckIncludeInRecordExport,
    setDeckWidthOverride,
    setDeckStretchRatio,
    setDeckStretchWindowSize,
    setDeckStretchStereoWidth,
    setDeckStretchPhaseRandomness,
    setDeckStretchTiltDb,
    setDeckStretchScatter,
    setDeckRearrangerSlices,
    setDeckRearrangerSwapCount,
    setDeckRearrangerChaos,
    setDeckRearrangerReverse,
    setDeckRearrangerSensitivity,
    setDeckRearrangerQuietThreshold,
    setDeckRearrangerSliceFadeMs,
    setDeckRearrangerSliceDelaySec,
    setDeckRearrangerPingPong,
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
    getAudioCurrentTime: getCurrentTime,
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
