import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckStack from "./components/DeckStack";
import ClipRecorder from "./components/ClipRecorder";
import WelcomePanel from "./components/WelcomePanel";
import AppHeader from "./components/AppHeader";
import MidiPanel from "./components/MidiPanel";
import { MidiLearnProvider } from "./components/MidiLearnContext";
import { TwisterModeProvider } from "./components/TwisterModeContext";
import KeyboardShortcutsDialog from "./components/KeyboardShortcutsDialog";
import StorageDiagnosticsOverlay from "./components/StorageDiagnosticsOverlay";
import AudioUnlockOverlay from "./components/AudioUnlockOverlay";
import useDecks from "./hooks/useDecks";
import useAudioEngine from "./hooks/useAudioEngine";
import useSessionManager from "./hooks/useSessionManager";
import useGlobalKeyboardShortcuts from "./hooks/useGlobalKeyboardShortcuts";
import useFocusedDeckActions from "./hooks/useFocusedDeckActions";
import useClipLibrary from "./hooks/useClipLibrary";
import useDeckLoopTools from "./hooks/useDeckLoopTools";
import useDeckStackProps from "./hooks/useDeckStackProps";
import useMidiController from "./hooks/useMidiController";
import useRearrangerRuntime from "./hooks/useRearrangerRuntime";
import useRecordingManager from "./hooks/useRecordingManager";
import PerfOverlay from "./components/PerfOverlay";
import { clearSessionStorage } from "./utils/sessionStore";
import { renderMixdownBlob } from "./utils/exportMixdown";
import { formatStorageBytes } from "./utils/storageDiagnostics";
import {
  loadStretchCalibrationState,
  saveStretchCalibrationState,
} from "./utils/stretchEstimate";
import { buildTimestampedAudioFilename, formatEstimateDuration } from "./utils/appHelpers";
import { MIDI_ACTIONS, type MidiActionId, type MidiMappedValue } from "./types/midi";
import { STRETCH_WINDOW_SIZES } from "./hooks/useDecksShared";
import type { DeckFxPanel } from "./types/deck";

type PerformanceMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
};

const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const MIDI_ACTION_MAP = new Map(MIDI_ACTIONS.map((action) => [action.id, action]));
const TWISTER_SLOT_ACTIONS: MidiActionId[] = [
  "twister.slot1",
  "twister.slot2",
  "twister.slot3",
  "twister.slot4",
  "twister.slot5",
  "twister.slot6",
  "twister.slot7",
  "twister.slot8",
  "twister.slot9",
  "twister.slot10",
  "twister.slot11",
  "twister.slot12",
  "twister.slot13",
  "twister.slot14",
  "twister.slot15",
];
const TWISTER_MODULES: Array<{ id: DeckFxPanel; label: string; actions: MidiActionId[] }> = [
  { id: "gain", label: "Gain", actions: ["deck.gain"] },
  { id: "djFilter", label: "Filter", actions: ["deck.filter", "deck.resonance"] },
  { id: "balance", label: "Balance", actions: ["deck.balance"] },
  { id: "pitch", label: "Pitch", actions: ["deck.pitch"] },
  {
    id: "parametricEq",
    label: "Parametric EQ",
    actions: [
      "deck.parametricBand1.frequency",
      "deck.parametricBand1.gain",
      "deck.parametricBand2.frequency",
      "deck.parametricBand2.gain",
      "deck.parametricBand3.frequency",
      "deck.parametricBand3.gain",
      "deck.parametricBand4.frequency",
      "deck.parametricBand4.gain",
      "deck.parametricBand5.frequency",
      "deck.parametricBand5.gain",
      "deck.parametricBand6.frequency",
      "deck.parametricBand6.gain",
    ],
  },
  {
    id: "vocoder",
    label: "Vocoder",
    actions: [
      "deck.vocoderMix",
      "deck.vocoderMonitor",
      "deck.vocoderModDrive",
      "deck.vocoderBands",
      "deck.vocoderVocalCharacter",
      "deck.vocoderFormantShift",
      "deck.vocoderPreEmphasis",
      "deck.vocoderTightness",
      "deck.vocoderAttack",
      "deck.vocoderRelease",
      "deck.vocoderPhaseRotate",
      "deck.vocoderGate",
    ],
  },
  {
    id: "delay",
    label: "Delay",
    actions: [
      "deck.delayMix",
      "deck.delayTime",
      "deck.delayFeedback",
      "deck.delayTone",
      "deck.delayDriveFb",
      "deck.delayDamping",
      "deck.delaySafety",
      "deck.delayPitchMix",
      "deck.delayPitchStep",
      "deck.delaySpectralMix",
      "deck.delaySpectralSpread",
      "deck.delaySpectralMotion",
    ],
  },
  {
    id: "spectralSpace",
    label: "Spectral Space",
    actions: [
      "deck.spectralSpaceMix",
      "deck.spectralSpaceSpread",
      "deck.spectralSpaceMotion",
      "deck.spectralSpaceTilt",
      "deck.spectralSpaceLowMono",
      "deck.spectralSpaceTransientProtect",
    ],
  },
  {
    id: "rearranger",
    label: "Rearranger",
    actions: [
      "deck.rearrangerSlices",
      "deck.rearrangerSwaps",
      "deck.rearrangerChaos",
      "deck.rearrangerReverse",
      "deck.rearrangerSensitivity",
      "deck.rearrangerQuietThreshold",
      "deck.rearrangerSliceFade",
      "deck.rearrangerSliceDelay",
      "deck.rearrangerPingPong",
    ],
  },
  {
    id: "stretch",
    label: "Stretch",
    actions: [
      "deck.stretchAmount",
      "deck.stretchPhase",
      "deck.stretchWidth",
      "deck.stretchTilt",
      "deck.stretchScatter",
      "deck.stretchWindow",
    ],
  },
];
const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3 ? clean.split("").map((part) => `${part}${part}`).join("") : clean;
  const int = Number.parseInt(normalized, 16);
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
};
const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
const buildMultiStopGradient = (stops: string[], steps: number) => {
  if (steps <= 0) return [];
  if (stops.length === 0) return Array.from({ length: steps }, () => "#ffffff");
  if (stops.length === 1) return Array.from({ length: steps }, () => stops[0]);
  return Array.from({ length: steps }, (_, index) => {
    const t = steps <= 1 ? 0 : index / (steps - 1);
    const segmentCount = stops.length - 1;
    const scaled = t * segmentCount;
    const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
    const localT = scaled - segmentIndex;
    const start = hexToRgb(stops[segmentIndex]);
    const end = hexToRgb(stops[segmentIndex + 1]);
    return rgbToHex(
      start.r + (end.r - start.r) * localT,
      start.g + (end.g - start.g) * localT,
      start.b + (end.b - start.b) * localT
    );
  });
};
const TWISTER_SLOT_COLORS = buildMultiStopGradient(
  ["#ff4eb8", "#3e6dff", "#22d6ff", "#31d97a", "#ffd451", "#ff9a3b", "#ff4f3b"],
  15
);
// Midi Fighter Twister page-4 color scale (0..127) is non-linear in perceptual RGB terms.
// Use explicit wheel values for hardware LEDs and keep app ring colors independent.
// Hardware RGB palette (Twister wheel values), tuned by knob index:
// 1=pink, 4=blue, 6=cyan, 8=green, 9=more yellow, 12=orange, 15=red.
const TWISTER_SLOT_MIDI_VALUES = [
  90, 101, 112, 0,
  12, 32, 40, 49,
  56, 62, 69, 72,
  76, 80, 84
] as const;
const TWISTER_RGB_BRIGHTNESS_OFF = 17;
const TWISTER_RGB_BRIGHTNESS_ON = 47;
const TWISTER_ENCODER_16_CC = 15;
const TWISTER_INDICATOR_BRIGHTNESS_BASE_CC = 65;
const TWISTER_SYSTEM_CHANNEL = 3;
const MIDI_CENTER_SNAP_ACTIONS = new Set<MidiActionId>([
  "deck.filter",
  "deck.balance",
  "deck.pitch",
  "deck.delayPitchStep",
  "deck.spectralSpaceTilt",
]);
const MIDI_INTEGER_ACTIONS = new Set<MidiActionId>([
  "deck.rearrangerSlices",
  "deck.rearrangerSwaps",
  "deck.vocoderBands",
  "deck.stretchWindow",
]);
const PARAMETRIC_BAND_ACTION_RE = /^deck\.parametricBand([1-8])\.(frequency|gain|jitter|spread)$/;
const PARAMETRIC_FREQ_MIN = 20;
const PARAMETRIC_FREQ_MAX = 20000;
const PARAMETRIC_GAIN_MIN = -18;
const PARAMETRIC_GAIN_MAX = 18;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const unitToFrequency = (value: number) => {
  const minLog = Math.log10(PARAMETRIC_FREQ_MIN);
  const maxLog = Math.log10(PARAMETRIC_FREQ_MAX);
  return Math.pow(10, minLog + clamp(value, 0, 1) * (maxLog - minLog));
};
const frequencyToUnit = (value: number) => {
  const minLog = Math.log10(PARAMETRIC_FREQ_MIN);
  const maxLog = Math.log10(PARAMETRIC_FREQ_MAX);
  const clampedFreq = clamp(value, PARAMETRIC_FREQ_MIN, PARAMETRIC_FREQ_MAX);
  return (Math.log10(clampedFreq) - minLog) / (maxLog - minLog);
};

const App = () => {
  const [exportMinutes, setExportMinutes] = useState(1);
  const [exportSeconds, setExportSeconds] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportEstimateLabel, setExportEstimateLabel] = useState<string | null>(null);
  const [masterGain, setMasterGainValue] = useState(0.9);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [debugPerf, setDebugPerf] = useState(() => {
    if (!import.meta.env.DEV) return false;
    return localStorage.getItem("debugPerf") === "true";
  });
  const [stretchEstimateByDeckId, setStretchEstimateByDeckId] = useState<Record<number, string>>(
    {}
  );
  const [stretchCalibration, setStretchCalibration] = useState(() =>
    loadStretchCalibrationState()
  );
  const [perfStats, setPerfStats] = useState<{
    fps: number;
    frameMs: number;
    heapUsedMB: number | null;
    heapLimitMB: number | null;
  }>({
    fps: 0,
    frameMs: 0,
    heapUsedMB: null,
    heapLimitMB: null,
  });
  const [activeDeckId, setActiveDeckId] = useState<number | null>(null);
  const [scrollToDeckId, setScrollToDeckId] = useState<number | null>(null);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [deckLayoutMode, setDeckLayoutMode] = useState<"single" | "two">("two");
  const [clipLoadHoverDeckId, setClipLoadHoverDeckId] = useState<number | null>(null);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [showWelcomePanelOverride, setShowWelcomePanelOverride] = useState(false);
  const [showStorageDiagnostics, setShowStorageDiagnostics] = useState(false);
  const [storageUsedLabel, setStorageUsedLabel] = useState("Storage: --");
  const [midiLearnModeEnabled, setMidiLearnModeEnabled] = useState(false);
  const [twisterModeEnabled, setTwisterModeEnabled] = useState(false);
  const [twisterModuleIndex, setTwisterModuleIndex] = useState(0);
  const [twisterScrollToken, setTwisterScrollToken] = useState(0);
  const statusTimeoutRef = useRef<number | null>(null);
  const parametricScaleByDeckIdRef = useRef<Record<number, number>>({});

  useEffect(() => {
    saveStretchCalibrationState(stretchCalibration);
  }, [stretchCalibration]);
  const {
    getRecordStream,
    decodeFile,
    resumeContext,
    suspendContext,
    setMasterGain,
    getAudioContextState,
  } = useAudioEngine();
  useEffect(() => {
    setMasterGain(masterGain);
  }, [masterGain, setMasterGain]);
  const {
    decks,
    addDeck,
    removeDeck,
    reorderDecks,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    stopDeck,
    setFileInputRef,
    setDeckGain,
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckParametricEqMotion,
    setDeckSimpleAutomation,
    clearDeckSimpleAutomation,
    setDeckBalance,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckDelayRhythmMorph,
    setDeckDelayRhythmRateHz,
    setDeckDelayDuckDepth,
    setDeckDelayDuckThreshold,
    setDeckDelayDuckResponseMs,
    setDeckDelaySpectralMix,
    setDeckDelaySpectralSpread,
    setDeckDelaySpectralMotion,
    setDeckSpectralSpaceMix,
    setDeckSpectralSpaceSpread,
    setDeckSpectralSpaceMotion,
    setDeckSpectralSpaceTilt,
    setDeckSpectralSpaceLowMono,
    setDeckSpectralSpaceTransientProtect,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderVocalCharacter,
    setDeckVocoderFormantShift,
    setDeckVocoderConsonantBoost,
    setDeckVocoderPreEmphasis,
    setDeckVocoderTightness,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckVocoderPostDelay,
    setDeckDelaySliceSync,
    setDeckDelayTimeTransient,
    setDeckPlaybackRateTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
    setDeckPitchShift,
    seekDeck,
    setDeckZoom,
    setDeckLoop,
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
    getDeckPlaybackSnapshot,
    getAudioCurrentTime,
    getSessionDecks,
    getDeckUndoRedoHistorySnapshots,
    loadSessionDecks,
    resetDecks,
    undo,
    redo,
    canUndo,
    canRedo,
    loadDeckBuffer,
  } = useDecks();
  const focusedDeckId = activeDeckId ?? decks[0]?.id ?? null;
  const focusedDeck = focusedDeckId === null ? null : decks.find((deck) => deck.id === focusedDeckId) ?? null;
  const activeTwisterModule = TWISTER_MODULES[twisterModuleIndex] ?? TWISTER_MODULES[0];
  const openTwisterModulePanels = useCallback(
    (deckId: number, panel: DeckFxPanel) => {
      setDeckFxPanelOpen(deckId, panel, true);
      if (panel === "djFilter") {
        setDeckFxPanelOpen(deckId, "resonance", true);
      }
    },
    [setDeckFxPanelOpen]
  );
  const resolveMidiActionId = useCallback(
    (actionId: MidiActionId): MidiActionId => {
      const slotIndex = TWISTER_SLOT_ACTIONS.indexOf(actionId);
      if (slotIndex < 0) return actionId;
      return activeTwisterModule.actions[slotIndex] ?? actionId;
    },
    [activeTwisterModule.actions]
  );
  const setActionValue = useCallback(
    (actionId: MidiActionId, value: number) => {
      if (actionId === "twister.deckPrev" || actionId === "twister.deckNext") {
        if (decks.length === 0 || value <= 0.5) return;
        const currentDeckId = activeDeckId ?? decks[0]?.id ?? null;
        const currentIndex = Math.max(
          0,
          decks.findIndex((deck) => deck.id === currentDeckId)
        );
        const direction = actionId === "twister.deckPrev" ? -1 : 1;
        const nextIndex = (currentIndex + direction + decks.length) % decks.length;
        setActiveDeckId(decks[nextIndex]?.id ?? null);
        setTwisterScrollToken((prev) => prev + 1);
        return;
      }
      if (actionId === "twister.deckSelect") {
        if (decks.length === 0) return;
        const maxIndex = decks.length - 1;
        const nextIndex = clamp(Math.round(clamp(value, 0, 1) * maxIndex), 0, maxIndex);
        setActiveDeckId(decks[nextIndex]?.id ?? null);
        setTwisterScrollToken((prev) => prev + 1);
        return;
      }
      if (actionId === "twister.moduleSelect") {
        const maxIndex = TWISTER_MODULES.length - 1;
        const nextIndex = clamp(Math.round(clamp(value, 0, 1) * maxIndex), 0, maxIndex);
        const nextModule = TWISTER_MODULES[nextIndex] ?? TWISTER_MODULES[0];
        setTwisterModuleIndex(nextIndex);
        if (focusedDeckId !== null) {
          openTwisterModulePanels(focusedDeckId, nextModule.id);
        }
        setTwisterScrollToken((prev) => prev + 1);
        return;
      }
      const slotIndex = TWISTER_SLOT_ACTIONS.indexOf(actionId);
      if (slotIndex >= 0) {
        const mappedAction = activeTwisterModule.actions[slotIndex];
        if (!mappedAction) return;
        actionId = mappedAction;
      }
      const deckId = focusedDeckId;
      if (actionId === "master.gain") {
        setMasterGainValue(value);
        return;
      }
      if (deckId === null) return;
      if (actionId === "deck.parametricScale") {
        if (!focusedDeck) return;
        const previousScale = Math.max(1e-3, parametricScaleByDeckIdRef.current[deckId] ?? 100);
        const nextScale = clamp(value, 0, 200);
        const ratio = nextScale / previousScale;
        parametricScaleByDeckIdRef.current[deckId] = nextScale;
        setDeckParametricEqBands(
          deckId,
          focusedDeck.parametricEqBands.map((band) => ({
            ...band,
            gain: clamp(band.gain * ratio, PARAMETRIC_GAIN_MIN, PARAMETRIC_GAIN_MAX),
          }))
        );
        return;
      }
      const parametricMatch = actionId.match(PARAMETRIC_BAND_ACTION_RE);
      if (parametricMatch) {
        if (!focusedDeck) return;
        const bandIndex = Number(parametricMatch[1]) - 1;
        const param = parametricMatch[2];
        const band = focusedDeck.parametricEqBands[bandIndex];
        if (!band) return;
        const nextBands = focusedDeck.parametricEqBands.map((item, index) => {
          if (index !== bandIndex) return item;
          const baseWander = item.wander ?? {
            jitter: 0,
            spread: 0,
            seed: Math.random() * Math.PI * 2,
            baseFrequency: item.frequency,
            baseGain: item.gain,
          };
          if (param === "frequency") {
            const nextFrequency = unitToFrequency(value);
            return {
              ...item,
              frequency: nextFrequency,
              wander: {
                ...baseWander,
                baseFrequency: nextFrequency,
              },
            };
          }
          if (param === "gain") {
            const nextGain = clamp(value, PARAMETRIC_GAIN_MIN, PARAMETRIC_GAIN_MAX);
            return {
              ...item,
              gain: nextGain,
              wander: {
                ...baseWander,
                baseGain: nextGain,
              },
            };
          }
          if (param === "jitter") {
            return {
              ...item,
              wander: {
                ...baseWander,
                jitter: clamp(value, 0, 1),
              },
            };
          }
          return {
            ...item,
            wander: {
              ...baseWander,
              spread: clamp(value, 0, 1),
            },
          };
        });
        setDeckParametricEqBands(deckId, nextBands);
        return;
      }
      if (actionId === "deck.gain") {
        setDeckGain(deckId, value);
        return;
      }
      if (actionId === "deck.filter") {
        setDeckFilter(deckId, value);
        return;
      }
      if (actionId === "deck.resonance") {
        setDeckResonance(deckId, value);
        return;
      }
      if (actionId === "deck.balance") {
        setDeckBalance(deckId, value);
        return;
      }
      if (actionId === "deck.pitch") {
        setDeckPitchShift(deckId, value);
        return;
      }
      if (actionId === "deck.eqLow") {
        setDeckEqLow(deckId, value);
        return;
      }
      if (actionId === "deck.eqMid") {
        setDeckEqMid(deckId, value);
        return;
      }
      if (actionId === "deck.eqHigh") {
        setDeckEqHigh(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderMix") {
        setDeckVocoderMix(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderMonitor") {
        setDeckVocoderModulatorMonitor(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderModDrive") {
        setDeckVocoderModDrive(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderBands") {
        setDeckVocoderBandCount(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderVocalCharacter") {
        setDeckVocoderVocalCharacter(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderFormantShift") {
        setDeckVocoderFormantShift(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderPreEmphasis") {
        setDeckVocoderPreEmphasis(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderTightness") {
        setDeckVocoderTightness(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderAttack") {
        setDeckVocoderAttackMs(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderRelease") {
        setDeckVocoderReleaseMs(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderPhaseRotate") {
        setDeckVocoderNoiseMix(deckId, value);
        return;
      }
      if (actionId === "deck.vocoderGate") {
        setDeckVocoderGateThreshold(deckId, value);
        return;
      }
      if (actionId === "deck.delayMix") {
        setDeckDelayMix(deckId, value);
        return;
      }
      if (actionId === "deck.delayTime") {
        setDeckDelayTime(deckId, value);
        return;
      }
      if (actionId === "deck.delayFeedback") {
        setDeckDelayFeedback(deckId, value);
        return;
      }
      if (actionId === "deck.delayTone") {
        setDeckDelayTone(deckId, value);
        return;
      }
      if (actionId === "deck.delayDriveFb") {
        setDeckDelaySaturation(deckId, value);
        return;
      }
      if (actionId === "deck.delayDamping") {
        setDeckDelayDamping(deckId, value);
        return;
      }
      if (actionId === "deck.delaySafety") {
        setDeckDelaySafety(deckId, value);
        return;
      }
      if (actionId === "deck.delayPitchMix") {
        setDeckDelayRhythmMorph(deckId, value);
        return;
      }
      if (actionId === "deck.delayPitchStep") {
        setDeckDelayRhythmRateHz(deckId, value);
        return;
      }
      if (actionId === "deck.delaySpectralMix") {
        setDeckDelaySpectralMix(deckId, value);
        return;
      }
      if (actionId === "deck.delaySpectralSpread") {
        setDeckDelaySpectralSpread(deckId, value);
        return;
      }
      if (actionId === "deck.delaySpectralMotion") {
        setDeckDelaySpectralMotion(deckId, value);
        return;
      }
      if (actionId === "deck.spectralSpaceMix") {
        setDeckSpectralSpaceMix(deckId, value);
        return;
      }
      if (actionId === "deck.spectralSpaceSpread") {
        setDeckSpectralSpaceSpread(deckId, value);
        return;
      }
      if (actionId === "deck.spectralSpaceMotion") {
        setDeckSpectralSpaceMotion(deckId, value);
        return;
      }
      if (actionId === "deck.spectralSpaceTilt") {
        setDeckSpectralSpaceTilt(deckId, value);
        return;
      }
      if (actionId === "deck.spectralSpaceLowMono") {
        setDeckSpectralSpaceLowMono(deckId, value);
        return;
      }
      if (actionId === "deck.spectralSpaceTransientProtect") {
        setDeckSpectralSpaceTransientProtect(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerSlices") {
        setDeckRearrangerSlices(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerSwaps") {
        setDeckRearrangerSwapCount(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerChaos") {
        setDeckRearrangerChaos(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerReverse") {
        setDeckRearrangerReverse(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerSensitivity") {
        setDeckRearrangerSensitivity(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerQuietThreshold") {
        setDeckRearrangerQuietThreshold(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerSliceFade") {
        setDeckRearrangerSliceFadeMs(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerSliceDelay") {
        setDeckRearrangerSliceDelaySec(deckId, value);
        return;
      }
      if (actionId === "deck.rearrangerPingPong") {
        setDeckRearrangerPingPong(deckId, value);
        return;
      }
      if (actionId === "deck.stretchAmount") {
        setDeckStretchRatio(deckId, value);
        return;
      }
      if (actionId === "deck.stretchPhase") {
        setDeckStretchPhaseRandomness(deckId, value);
        return;
      }
      if (actionId === "deck.stretchWidth") {
        setDeckStretchStereoWidth(deckId, value);
        return;
      }
      if (actionId === "deck.stretchTilt") {
        setDeckStretchTiltDb(deckId, value);
        return;
      }
      if (actionId === "deck.stretchScatter") {
        setDeckStretchScatter(deckId, value);
        return;
      }
      if (actionId === "deck.stretchWindow") {
        const maxIndex = STRETCH_WINDOW_SIZES.length - 1;
        const index = clamp(Math.round(value) - 1, 0, maxIndex);
        setDeckStretchWindowSize(deckId, STRETCH_WINDOW_SIZES[index]);
      }
    },
    [
      activeDeckId,
      activeTwisterModule.actions,
      decks,
      focusedDeck,
      focusedDeckId,
      setActiveDeckId,
      setDeckBalance,
      setDeckDelayDamping,
      setDeckDelayRhythmMorph,
      setDeckDelayRhythmRateHz,
      setDeckDelaySaturation,
      setDeckDelaySafety,
      setDeckDelaySpectralMix,
      setDeckDelaySpectralMotion,
      setDeckDelaySpectralSpread,
      setDeckDelayFeedback,
      setDeckDelayMix,
      setDeckDelayTime,
      setDeckDelayTone,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckGain,
      setDeckPitchShift,
      setDeckParametricEqBands,
      setDeckRearrangerChaos,
      setDeckRearrangerPingPong,
      setDeckRearrangerQuietThreshold,
      setDeckRearrangerReverse,
      setDeckRearrangerSensitivity,
      setDeckRearrangerSliceDelaySec,
      setDeckRearrangerSliceFadeMs,
      setDeckRearrangerSlices,
      setDeckRearrangerSwapCount,
      setDeckResonance,
      setDeckSpectralSpaceMix,
      setDeckSpectralSpaceLowMono,
      setDeckSpectralSpaceMotion,
      setDeckSpectralSpaceSpread,
      setDeckSpectralSpaceTilt,
      setDeckSpectralSpaceTransientProtect,
      setDeckStretchPhaseRandomness,
      setDeckStretchRatio,
      setDeckStretchScatter,
      setDeckStretchStereoWidth,
      setDeckStretchTiltDb,
      setDeckStretchWindowSize,
      openTwisterModulePanels,
      setDeckVocoderAttackMs,
      setDeckVocoderBandCount,
      setDeckVocoderFormantShift,
      setDeckVocoderGateThreshold,
      setDeckVocoderMix,
      setDeckVocoderModDrive,
      setDeckVocoderModulatorMonitor,
      setDeckVocoderNoiseMix,
      setDeckVocoderPreEmphasis,
      setDeckVocoderReleaseMs,
      setDeckVocoderTightness,
      setDeckVocoderVocalCharacter,
      setTwisterModuleIndex,
    ]
  );
  const getActionValue = useCallback(
    (actionId: MidiActionId) => {
      if (actionId === "twister.deckSelect") {
        if (decks.length <= 1) return 0;
        const activeIndex = Math.max(0, decks.findIndex((deck) => deck.id === (activeDeckId ?? decks[0]?.id)));
        return activeIndex / (decks.length - 1);
      }
      if (actionId === "twister.deckPrev" || actionId === "twister.deckNext") {
        return 0;
      }
      if (actionId === "twister.moduleSelect") {
        if (TWISTER_MODULES.length <= 1) return 0;
        return twisterModuleIndex / (TWISTER_MODULES.length - 1);
      }
      const slotIndex = TWISTER_SLOT_ACTIONS.indexOf(actionId);
      if (slotIndex >= 0) {
        const mappedAction = activeTwisterModule.actions[slotIndex];
        if (!mappedAction) return 0;
        actionId = mappedAction;
      }
      if (actionId === "master.gain") return masterGain;
      const deck = focusedDeck;
      if (!deck) return null;
      if (actionId === "deck.parametricScale") {
        return parametricScaleByDeckIdRef.current[deck.id] ?? 100;
      }
      const parametricMatch = actionId.match(PARAMETRIC_BAND_ACTION_RE);
      if (parametricMatch) {
        const bandIndex = Number(parametricMatch[1]) - 1;
        const param = parametricMatch[2];
        const band = deck.parametricEqBands[bandIndex];
        if (!band) return null;
        if (param === "frequency") return frequencyToUnit(band.frequency);
        if (param === "gain") return band.gain;
        if (param === "jitter") return band.wander?.jitter ?? 0;
        return band.wander?.spread ?? 0;
      }
      if (actionId === "deck.gain") return deck.gain;
      if (actionId === "deck.filter") return deck.djFilter;
      if (actionId === "deck.resonance") return deck.filterResonance;
      if (actionId === "deck.balance") return deck.balance;
      if (actionId === "deck.pitch") return deck.pitchShift;
      if (actionId === "deck.eqLow") return deck.eqLowGain;
      if (actionId === "deck.eqMid") return deck.eqMidGain;
      if (actionId === "deck.eqHigh") return deck.eqHighGain;
      if (actionId === "deck.vocoderMix") return deck.vocoderMix;
      if (actionId === "deck.vocoderMonitor") return deck.vocoderModulatorMonitor;
      if (actionId === "deck.vocoderModDrive") return deck.vocoderModDrive;
      if (actionId === "deck.vocoderBands") return deck.vocoderBandCount;
      if (actionId === "deck.vocoderVocalCharacter") return deck.vocoderVocalCharacter;
      if (actionId === "deck.vocoderFormantShift") return deck.vocoderFormantShift;
      if (actionId === "deck.vocoderPreEmphasis") return deck.vocoderPreEmphasis;
      if (actionId === "deck.vocoderTightness") return deck.vocoderTightness;
      if (actionId === "deck.vocoderAttack") return deck.vocoderAttackMs;
      if (actionId === "deck.vocoderRelease") return deck.vocoderReleaseMs;
      if (actionId === "deck.vocoderPhaseRotate") return deck.vocoderNoiseMix;
      if (actionId === "deck.vocoderGate") return deck.vocoderGateThreshold;
      if (actionId === "deck.delayMix") return deck.delayMix;
      if (actionId === "deck.delayTime") return deck.delayTime;
      if (actionId === "deck.delayFeedback") return deck.delayFeedback;
      if (actionId === "deck.delayTone") return deck.delayTone;
      if (actionId === "deck.delayDriveFb") return deck.delaySaturation ?? 0;
      if (actionId === "deck.delayDamping") return deck.delayDamping ?? 0;
      if (actionId === "deck.delaySafety") return deck.delaySafety ?? 0;
      if (actionId === "deck.delayPitchMix") return deck.delayRhythmMorph ?? 0;
      if (actionId === "deck.delayPitchStep") return deck.delayRhythmRateHz ?? 0;
      if (actionId === "deck.delaySpectralMix") return deck.delaySpectralMix ?? 0;
      if (actionId === "deck.delaySpectralSpread") return deck.delaySpectralSpread ?? 0;
      if (actionId === "deck.delaySpectralMotion") return deck.delaySpectralMotion ?? 0;
      if (actionId === "deck.spectralSpaceMix") return deck.spectralSpaceMix ?? 0;
      if (actionId === "deck.spectralSpaceSpread") return deck.spectralSpaceSpread ?? 0;
      if (actionId === "deck.spectralSpaceMotion") return deck.spectralSpaceMotion ?? 0;
      if (actionId === "deck.spectralSpaceTilt") return deck.spectralSpaceTilt ?? 0;
      if (actionId === "deck.spectralSpaceLowMono") return deck.spectralSpaceLowMono ?? 0;
      if (actionId === "deck.spectralSpaceTransientProtect") {
        return deck.spectralSpaceTransientProtect ?? 0;
      }
      if (actionId === "deck.rearrangerSlices") return deck.rearrangerSlices;
      if (actionId === "deck.rearrangerSwaps") return deck.rearrangerSwapCount;
      if (actionId === "deck.rearrangerChaos") return deck.rearrangerChaos;
      if (actionId === "deck.rearrangerReverse") return deck.rearrangerReverse;
      if (actionId === "deck.rearrangerSensitivity") return deck.rearrangerSensitivity;
      if (actionId === "deck.rearrangerQuietThreshold") return deck.rearrangerQuietThreshold;
      if (actionId === "deck.rearrangerSliceFade") return deck.rearrangerSliceFadeMs;
      if (actionId === "deck.rearrangerSliceDelay") return deck.rearrangerSliceDelaySec;
      if (actionId === "deck.rearrangerPingPong") return deck.rearrangerPingPong;
      if (actionId === "deck.stretchAmount") return deck.stretchRatio;
      if (actionId === "deck.stretchPhase") return deck.stretchPhaseRandomness;
      if (actionId === "deck.stretchWidth") return deck.stretchStereoWidth;
      if (actionId === "deck.stretchTilt") return deck.stretchTiltDb;
      if (actionId === "deck.stretchScatter") return deck.stretchScatter;
      if (actionId === "deck.stretchWindow") {
        const index = STRETCH_WINDOW_SIZES.indexOf(Math.round(deck.stretchWindowSize));
        if (index >= 0) return index + 1;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        STRETCH_WINDOW_SIZES.forEach((candidate, candidateIndex) => {
          const distance = Math.abs(candidate - deck.stretchWindowSize);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = candidateIndex;
          }
        });
        return nearestIndex + 1;
      }
      return null;
    },
    [activeDeckId, activeTwisterModule.actions, decks, focusedDeck, masterGain, twisterModuleIndex]
  );
  const handleMidiMappedValue = useCallback(
    ({ binding, absolute01, relativeDelta, rawValue }: MidiMappedValue) => {
      if (binding.actionId === "twister.moduleSelect") {
        if (TWISTER_MODULES.length <= 1) return;
        if (binding.mode === "absolute") {
          const normalized = absolute01 ?? 0;
          setActionValue("twister.moduleSelect", normalized);
          return;
        }
        let direction = 0;
        direction = relativeDelta === 0 ? 0 : relativeDelta > 0 ? 1 : -1;
        if (direction === 0) {
          // Fallback for controllers that advertise relative but emit center-offset ticks.
          if (rawValue === 65 || rawValue === 1) direction = 1;
          else if (rawValue === 63 || rawValue === 127) direction = -1;
          else if (rawValue > 64) direction = 1;
          else if (rawValue > 0 && rawValue < 64) direction = -1;
        }
        if (direction === 0) return;
        const nextIndex = clamp(twisterModuleIndex + direction, 0, TWISTER_MODULES.length - 1);
        if (nextIndex === twisterModuleIndex) return;
        setActionValue(
          "twister.moduleSelect",
          TWISTER_MODULES.length <= 1 ? 0 : nextIndex / (TWISTER_MODULES.length - 1)
        );
        return;
      }
      if (binding.actionId === "twister.deckSelect" && binding.mode === "relative") {
        if (decks.length === 0 || relativeDelta === 0) return;
        const currentDeckId = activeDeckId ?? decks[0]?.id ?? null;
        const currentIndex = Math.max(
          0,
          decks.findIndex((deck) => deck.id === currentDeckId)
        );
        const direction = relativeDelta > 0 ? 1 : -1;
        const nextIndex = clamp(currentIndex + direction, 0, decks.length - 1);
        setActiveDeckId(decks[nextIndex]?.id ?? null);
        setTwisterScrollToken((prev) => prev + 1);
        return;
      }
      const resolvedActionId = resolveMidiActionId(binding.actionId);
      const action = MIDI_ACTION_MAP.get(resolvedActionId);
      if (!action) return;
      const range = action.max - action.min;
      if (binding.mode === "absolute") {
        const normalized = absolute01 ?? 0;
        let mapped = action.min + normalized * range;
        if (MIDI_INTEGER_ACTIONS.has(resolvedActionId)) {
          mapped = Math.round(mapped);
        }
        if (MIDI_CENTER_SNAP_ACTIONS.has(resolvedActionId) && action.min < 0 && action.max > 0) {
          const centerNormalized = (-action.min) / (range || 1);
          const halfMidiStep = 0.5 / 127;
          if (Math.abs(normalized - centerNormalized) <= halfMidiStep) {
            mapped = 0;
          }
        }
        setActionValue(resolvedActionId, mapped);
        return;
      }
      if (relativeDelta === 0) return;
      const current = getActionValue(resolvedActionId);
      if (current === null) return;
      const next = current + relativeDelta * action.relativeStep;
      const clamped = Math.min(Math.max(next, action.min), action.max);
      setActionValue(resolvedActionId, clamped);
    },
    [activeDeckId, decks, getActionValue, resolveMidiActionId, setActionValue, twisterModuleIndex]
  );
  const {
    supported: midiSupported,
    accessGranted: midiAccessGranted,
    accessError: midiAccessError,
    requestAccess: requestMidiAccess,
    inputs: midiInputs,
    outputs: midiOutputs,
    selectedInputId: selectedMidiInputId,
    setSelectedInputId: setSelectedMidiInputId,
    selectedOutputId: selectedMidiOutputId,
    setSelectedOutputId: setSelectedMidiOutputId,
    mappings: midiMappings,
    learnTarget: midiLearnTarget,
    beginLearn: beginMidiLearn,
    cancelLearn: cancelMidiLearn,
    removeMapping: removeMidiMapping,
    clearMappings: clearMidiMappings,
    loadTwisterProfile,
    loadTwisterModeProfile,
    sendMappedFeedback,
    sendControlChange,
  } = useMidiController({
    onMappedValue: handleMidiMappedValue,
  });
  const handleArmMidiAction = useCallback(
    (actionId: MidiActionId) => {
      beginMidiLearn(actionId, "absolute");
    },
    [beginMidiLearn]
  );
  const twisterActionToSlotIndex = useMemo(() => {
    const map: Partial<Record<MidiActionId, number>> = {};
    activeTwisterModule.actions.slice(0, TWISTER_SLOT_ACTIONS.length).forEach((actionId, index) => {
      map[actionId] = index;
    });
    return map;
  }, [activeTwisterModule.actions]);
  const toggleTwisterMode = useCallback(() => {
      if (!twisterModeEnabled) {
      const ok = loadTwisterModeProfile();
      if (!ok) {
        window.alert("Select a MIDI input first, then enable Twister mode.");
        return;
      }
      setTwisterModeEnabled(true);
      if (focusedDeckId !== null) {
        openTwisterModulePanels(focusedDeckId, activeTwisterModule.id);
      }
      setTwisterScrollToken((prev) => prev + 1);
      return;
    }
    setTwisterModeEnabled(false);
  }, [
    activeTwisterModule.id,
    focusedDeckId,
    loadTwisterModeProfile,
    openTwisterModulePanels,
    twisterModeEnabled,
  ]);
  useEffect(() => {
    MIDI_ACTIONS.forEach((action) => {
      if (
        action.id === "twister.moduleSelect" ||
        action.id === "twister.deckSelect" ||
        action.id === "twister.deckPrev" ||
        action.id === "twister.deckNext"
      ) {
        return;
      }
      const resolvedActionId = resolveMidiActionId(action.id);
      const resolvedAction = MIDI_ACTION_MAP.get(resolvedActionId);
      if (!resolvedAction) return;
      const value = getActionValue(resolvedActionId);
      if (value === null) return;
      const normalized = clamp(
        (value - resolvedAction.min) / (resolvedAction.max - resolvedAction.min || 1),
        0,
        1
      );
      sendMappedFeedback(action.id, normalized);
    });
  }, [getActionValue, resolveMidiActionId, sendMappedFeedback, masterGain, focusedDeck]);
  useEffect(() => {
    if (!twisterModeEnabled) return;
    const activeModuleSlotCount = Math.min(TWISTER_SLOT_ACTIONS.length, activeTwisterModule.actions.length);
    TWISTER_SLOT_MIDI_VALUES.forEach((value, index) => {
      const slotActive = index < activeModuleSlotCount;
      sendControlChange(index, value, 1);
      sendControlChange(
        index,
        slotActive ? TWISTER_RGB_BRIGHTNESS_ON : TWISTER_RGB_BRIGHTNESS_OFF,
        2
      );
    });
    sendControlChange(15, 86, 1);
    sendControlChange(15, TWISTER_RGB_BRIGHTNESS_ON, 2);
    sendControlChange(
      TWISTER_INDICATOR_BRIGHTNESS_BASE_CC + TWISTER_ENCODER_16_CC,
      0,
      TWISTER_SYSTEM_CHANNEL
    );
  }, [activeTwisterModule.actions, sendControlChange, twisterModeEnabled]);
  useEffect(() => {
    if (!twisterModeEnabled) return;
    // Keep encoder 16 indicator brightness off.
    sendControlChange(
      TWISTER_INDICATOR_BRIGHTNESS_BASE_CC + TWISTER_ENCODER_16_CC,
      0,
      TWISTER_SYSTEM_CHANNEL
    );
  }, [sendControlChange, twisterModeEnabled, twisterModuleIndex]);
  const {
    clips,
    setClips,
    clipsRef,
    clipIdRef,
    clipNameRef,
    addClip,
    updateClip,
    removeClip,
    handleLoadClipToDeck,
    handleSaveLoopClip,
    handleDuplicateLoop,
    handleCropLoop,
  } = useClipLibrary({
    decks,
    automationState,
    addDeck,
    handleFileSelected,
    loadDeckBuffer,
    applyDeckFxPanelStatePatch,
    setActiveDeckId,
    setScrollToDeckId,
  });
  const {
    sessionBusy,
    sessionStatus,
    setSessionStatus,
    sessionName,
    setSessionName,
    lastSavedAt,
    welcomePanelDismissed,
    setWelcomePanelDismissed,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    importInputRef,
    zipDragOver,
    markSkipNextAutosave,
    triggerAutosaveNow,
    handleExportSession,
    handleSaveSession,
    handleLoadSession,
    handleNewSession,
    handleImportClick,
    handleImportChange,
    handleOpenDemoLoop,
    handleAppDragEnter,
    handleAppDragOver,
    handleAppDragLeave,
    handleAppDrop,
  } = useSessionManager({
    decks,
    clips,
    clipsRef,
    clipIdRef,
    clipNameRef,
    decodeFile,
    getSessionDecks,
    getDeckUndoRedoHistorySnapshots,
    loadSessionDecks,
    resetDecks,
    masterGain,
    setMasterGainValue,
    applyDeckFxPanelStatePatch,
    setClips,
  });
  const { recording, savingRecording, handleRecordToggle } = useRecordingManager({
    decodeFile,
    getRecordStream,
    sessionName,
  });
  const {
    rearrangeBusyByDeckRef,
    handleStretchLoop,
    handleCaptureRearrangerSnapshot,
    handleRestoreRearrangerSnapshot,
    hasRearrangerSnapshot,
    getRearrangerSnapshotCapturedAtMs,
    handleRearrangeLoop,
    handleDeleteRearrangerSlice,
    handleAutoSliceRearranger,
    handleTrimQuietRearranger,
  } = useDeckLoopTools({
    decks,
    automationState,
    loadDeckBuffer,
    getDeckPlaybackSnapshot,
    markSkipNextAutosave,
    triggerAutosaveNow,
    setDeckRearrangerRegions,
    stretchCalibration,
    setStretchEstimateByDeckId,
    setStretchCalibration,
  });
  useEffect(() => {
    if (!sessionStatus) return undefined;
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setSessionStatus(null);
      statusTimeoutRef.current = null;
    }, 3000);
    return () => {
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, [sessionStatus, setSessionStatus]);
  useEffect(() => {
    if (decks.length === 0) {
      setActiveDeckId(null);
      return;
    }
    if (activeDeckId !== null && decks.some((deck) => deck.id === activeDeckId)) {
      return;
    }
    setActiveDeckId(decks[0].id);
  }, [activeDeckId, decks]);
  const isCurrentProjectBrandNew =
    clips.length === 0 &&
    decks.every((deck) => !deck.buffer && !deck.fileName);
  const showWelcomePanel =
    (isCurrentProjectBrandNew && !welcomePanelDismissed) || showWelcomePanelOverride;

  const hasActivePlayback = decks.some((deck) => deck.status === "playing");
  const hasExportDecks = decks.some(
    (deck) => deck.buffer && deck.includeInRecordExport !== false
  );
  const canGlobalStopReset =
    decks.some((deck) => deck.buffer) &&
    decks.filter((deck) => deck.buffer).every((deck) => deck.status === "paused");
  const handleGlobalStopReset = useCallback(() => {
    decks.forEach((deck) => {
      if (deck.buffer) {
        stopDeck(deck);
      }
    });
  }, [decks, stopDeck]);

  const shouldAnimatePerf = hasActivePlayback || recording;
  const [audioContextState, setAudioContextState] = useState<
    AudioContextState | "uninitialized"
  >(() => getAudioContextState());
  const [audioUnlockError, setAudioUnlockError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(audioContextState === "running");

  const refreshAudioState = useCallback(() => {
    const nextState = getAudioContextState();
    setAudioContextState(nextState);
    if (nextState === "running") {
      setAudioUnlocked(true);
      setAudioUnlockError(null);
    }
  }, [getAudioContextState]);

  const handleEnableAudio = useCallback(async () => {
    try {
      await resumeContext();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Audio resume failed", error);
      }
      setAudioUnlockError("Audio blocked by browser. Tap again or press any key.");
    }
    refreshAudioState();
  }, [refreshAudioState, resumeContext]);

  useEffect(() => {
    let disposed = false;
    const handleGesture = () => {
      if (disposed) return;
      if (getAudioContextState() === "running") return;
      void handleEnableAudio();
    };
    const options = { passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", handleGesture, options);
    window.addEventListener("keydown", handleGesture, options);
    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", handleGesture, options);
      window.removeEventListener("keydown", handleGesture, options);
    };
  }, [getAudioContextState, handleEnableAudio]);

  useEffect(() => {
    if (!shouldAnimatePerf) {
      return undefined;
    }
    let raf = 0;
    let intervalId = 0;
    let frames = 0;
    let lastReport = performance.now();
    const onFrame = () => {
      frames += 1;
      raf = requestAnimationFrame(onFrame);
    };
    raf = requestAnimationFrame(onFrame);
    intervalId = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastReport;
      if (elapsed <= 0) return;
      const fps = Math.round((frames * 1000) / elapsed);
      const frameMs = frames > 0 ? Math.round(elapsed / frames) : 0;
      frames = 0;
      lastReport = now;
      const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
      if (memory) {
        setPerfStats({
          fps,
          frameMs,
          heapUsedMB: Math.round(memory.usedJSHeapSize / 1048576),
          heapLimitMB: Math.round(memory.jsHeapSizeLimit / 1048576),
        });
      } else {
        setPerfStats({ fps, frameMs, heapUsedMB: null, heapLimitMB: null });
      }
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(intervalId);
    };
  }, [shouldAnimatePerf]);

  useEffect(() => {
    if (!audioUnlocked) return;
    if (hasActivePlayback || recording) {
      void resumeContext();
      return;
    }
    void suspendContext();
  }, [audioUnlocked, hasActivePlayback, recording, resumeContext, suspendContext]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
    window.dispatchEvent(new Event("themechange"));
  }, [theme]);

  useEffect(() => {
    const estimateStorage = navigator.storage?.estimate?.bind(navigator.storage);
    if (!estimateStorage) {
      setStorageUsedLabel("Storage: n/a");
      return;
    }
    let cancelled = false;
    const updateStorageUsedLabel = async () => {
      try {
        const { usage, quota } = await estimateStorage();
        if (cancelled) return;
        const usageLabel = formatStorageBytes(typeof usage === "number" ? usage : null);
        const quotaLabel = formatStorageBytes(typeof quota === "number" ? quota : null);
        setStorageUsedLabel(
          quotaLabel === "--"
            ? `Storage: ${usageLabel}`
            : `Storage: ${usageLabel} / ${quotaLabel}`
        );
      } catch {
        if (!cancelled) setStorageUsedLabel("Storage: unavailable");
      }
    };
    void updateStorageUsedLabel();
    const intervalId = window.setInterval(() => {
      void updateStorageUsedLabel();
    }, 30000);
    const handleRefreshTrigger = () => {
      if (!document.hidden) {
        void updateStorageUsedLabel();
      }
    };
    window.addEventListener("focus", handleRefreshTrigger);
    document.addEventListener("visibilitychange", handleRefreshTrigger);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleRefreshTrigger);
      document.removeEventListener("visibilitychange", handleRefreshTrigger);
    };
  }, []);

  useEffect(() => {
    const setAltHeld = (held: boolean) => {
      document.body.classList.toggle("mod-alt-held", held);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        setAltHeld(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.altKey || event.key === "Alt") {
        setAltHeld(false);
      }
    };
    const handleWindowBlur = () => {
      setAltHeld(false);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setAltHeld(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      setAltHeld(false);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const exportMixdown = useCallback(async () => {
    if (exporting) return;
    const exportDurationSec = Math.max(
      1,
      Math.round(exportMinutes) * 60 + Math.round(exportSeconds)
    );
    const activeDeckCount = decks.filter(
      (deck) => deck.buffer && deck.includeInRecordExport !== false
    ).length;
    if (activeDeckCount === 0) {
      setSessionStatus("Load at least one deck before exporting.");
      return;
    }
    const estimateSeconds = 3 * (exportDurationSec / 60) * activeDeckCount;
    setExportEstimateLabel(
      `Approx export: ${formatEstimateDuration(estimateSeconds)}`
    );
    setExporting(true);
    try {
      const blob = await renderMixdownBlob({
        decks,
        automationState,
        durationSec: exportDurationSec,
        sessionName,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildTimestampedAudioFilename("loop-loop-loop-export", sessionName, "wav");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
      setExportEstimateLabel(null);
    }
  }, [
    automationState,
    decks,
    exportMinutes,
    exportSeconds,
    exporting,
    setSessionStatus,
    sessionName,
  ]);

  const handleExportMinutesChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(Math.round(value), 0), 60);
    setExportMinutes(clamped);
  }, []);

  const handleExportSecondsChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(Math.round(value), 0), 59);
    setExportSeconds(clamped);
  }, []);

  const [clearingStorage, setClearingStorage] = useState(false);
  const handleClearAllStorage = useCallback(async () => {
    if (clearingStorage || sessionBusy) return;
    const confirmed = window.confirm(
      "Clear all saved sessions and local app settings from this browser, then reload?"
    );
    if (!confirmed) return;
    setClearingStorage(true);
    try {
      await clearSessionStorage();
      window.localStorage.clear();
      window.location.reload();
    } catch (error) {
      console.error("Failed to clear all storage", error);
      setSessionStatus("Failed to clear storage.");
      setClearingStorage(false);
    }
  }, [clearingStorage, sessionBusy, setSessionStatus]);

  useRearrangerRuntime({
    decks,
    getDeckPlaybackSnapshot,
    getAudioCurrentTime,
    handleRearrangeLoop,
    rearrangeBusyByDeckRef,
    setDeckPlaybackRateTransient,
    setDeckDelayTimeTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
  });

  const handleDeckActivate = useCallback((deckId: number) => {
    setActiveDeckId(deckId);
  }, []);
  const handleAddDeck = useCallback(() => {
    addDeck({ afterId: activeDeckId ?? undefined });
  }, [activeDeckId, addDeck]);
  const handleDeckRemoveWithConfirm = useCallback((deckId: number) => {
    const deck = decks.find((item) => item.id === deckId);
    if (!deck) return;
    const label = deck.fileName ? ` "${deck.fileName}"` : "";
    const confirmed = window.confirm(
      `Remove deck${label}? This cannot be undone for loaded audio.`
    );
    if (!confirmed) return;
    removeDeck(deckId);
  }, [decks, removeDeck]);
  const {
    handleGlobalPlaybackToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckFxVisibilityToggle,
    handleAllDecksFxVisibilityToggle,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckRemove,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    handleFocusedDeckZoom,
    handleFocusedDeckWidthToggle,
  } = useFocusedDeckActions({
    decks,
    activeDeckId,
    pauseDeck,
    playDeck,
    setDeckFxPanelOpen,
    setDeckLoop,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    removeDeck: handleDeckRemoveWithConfirm,
    handleCropLoop,
    handleDuplicateLoop,
    setDeckZoom,
    setDeckWidthOverride,
    zoomSteps: ZOOM_STEPS,
  });
  const deckStackProps = useDeckStackProps({
    decks,
    deckLayoutMode,
    zipDragOver,
    activeDeckId,
    scrollToDeckId,
    setScrollToDeckId,
    handleDeckActivate,
    removeDeck: handleDeckRemoveWithConfirm,
    reorderDecks,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    stopDeck,
    setDeckGain,
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckParametricEqMotion,
    setDeckSimpleAutomation,
    clearDeckSimpleAutomation,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckDelayRhythmMorph,
    setDeckDelayRhythmRateHz,
    setDeckDelayDuckDepth,
    setDeckDelayDuckThreshold,
    setDeckDelayDuckResponseMs,
    setDeckDelaySpectralMix,
    setDeckDelaySpectralSpread,
    setDeckDelaySpectralMotion,
    setDeckDelaySliceSync,
    setDeckSpectralSpaceMix,
    setDeckSpectralSpaceSpread,
    setDeckSpectralSpaceMotion,
    setDeckSpectralSpaceTilt,
    setDeckSpectralSpaceLowMono,
    setDeckSpectralSpaceTransientProtect,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderVocalCharacter,
    setDeckVocoderFormantShift,
    setDeckVocoderConsonantBoost,
    setDeckVocoderPreEmphasis,
    setDeckVocoderTightness,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckVocoderPostDelay,
    setDeckBalance,
    setDeckPitchShift,
    seekDeck,
    setDeckZoom,
    setDeckLoop,
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
    handleDeleteRearrangerSlice,
    handleAutoSliceRearranger,
    handleCaptureRearrangerSnapshot,
    handleRestoreRearrangerSnapshot,
    hasRearrangerSnapshot,
    getRearrangerSnapshotCapturedAtMs,
    handleTrimQuietRearranger,
    handleRearrangeLoop,
    setDeckFxPanelOpen,
    setDeckFxPanelsOpen,
    resetDeckFx,
    handleStretchLoop,
    stretchEstimateByDeckId,
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
    getDeckPlaybackSnapshot,
    setFileInputRef,
    handleSaveLoopClip,
    handleCropLoop,
    handleDuplicateLoop,
    twisterScrollDeckId: twisterModeEnabled ? focusedDeckId : null,
    twisterScrollToPanel: twisterModeEnabled ? activeTwisterModule.id : null,
    twisterScrollToken,
  });

  useGlobalKeyboardShortcuts({
    addDeck: handleAddDeck,
    undo,
    redo,
    handleSaveSession,
    handleLoadSession,
    handleGlobalPlaybackToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckFxVisibilityToggle,
    handleAllDecksFxVisibilityToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckRemove,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckZoom,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    handleFocusedDeckWidthToggle,
    onToggleSessionPanel: () => setShowSessionPanel((prev) => !prev),
    setShowKeyboardShortcuts,
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleDebugToggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setDebugPerf((prev) => {
        const next = !prev;
        localStorage.setItem("debugPerf", String(next));
        return next;
      });
    };
    window.addEventListener("keydown", handleDebugToggle);
    return () => window.removeEventListener("keydown", handleDebugToggle);
  }, []);

  useEffect(() => {
    const handleMidiLearnShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key.toLowerCase() !== "m") return;
      event.preventDefault();
      setMidiLearnModeEnabled((prev) => {
        const next = !prev;
        if (!next) {
          cancelMidiLearn();
        }
        return next;
      });
    };
    window.addEventListener("keydown", handleMidiLearnShortcut);
    return () => window.removeEventListener("keydown", handleMidiLearnShortcut);
  }, [cancelMidiLearn]);

  return (
    <div
      className={`app ${zipDragOver ? "app--zip-drop-target" : ""} ${twisterModeEnabled ? "app--twister-mode" : ""} ${twisterModeEnabled ? `app--twister-module-${activeTwisterModule.id}` : ""}`.trim()}
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={(event) => void handleAppDrop(event)}
    >
      {zipDragOver ? (
        <div className="app__zip-drop-hint" aria-hidden="true">
          Drop session zip to import
        </div>
      ) : null}
      {import.meta.env.DEV && debugPerf ? <PerfOverlay /> : null}
      <TwisterModeProvider
        value={{
          enabled: twisterModeEnabled,
          actionToSlotIndex: twisterActionToSlotIndex,
          slotColors: TWISTER_SLOT_COLORS,
        }}
      >
      <MidiLearnProvider
        value={{
          learnModeEnabled: midiLearnModeEnabled,
          armedActionId: midiLearnTarget?.actionId ?? null,
          onArmAction: handleArmMidiAction,
        }}
      >
      <AppHeader
        debugPerf={debugPerf}
        perfStats={perfStats}
        sessionName={sessionName}
        lastSavedAt={lastSavedAt}
        storageUsedLabel={storageUsedLabel}
        onOpenStorageDiagnostics={() => setShowStorageDiagnostics(true)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAddDeck={handleAddDeck}
        onNewSession={handleNewSession}
        onGlobalPlaybackToggle={handleGlobalPlaybackToggle}
        onGlobalStopReset={handleGlobalStopReset}
        hasActivePlayback={hasActivePlayback}
        canGlobalStopReset={canGlobalStopReset}
        recording={recording}
        savingRecording={savingRecording}
        onRecordToggle={handleRecordToggle}
        showSessionPanel={showSessionPanel}
        onToggleSessionPanel={() => setShowSessionPanel((prev) => !prev)}
        deckLayoutMode={deckLayoutMode}
        onToggleDeckLayout={() =>
          setDeckLayoutMode((prev) => (prev === "single" ? "two" : "single"))
        }
        masterGain={masterGain}
        onMasterGainChange={setMasterGainValue}
        onOpenKeyboardShortcuts={() => {
          setShowKeyboardShortcuts(true);
          setShowWelcomePanelOverride(true);
        }}
        showKeyboardShortcuts={showKeyboardShortcuts}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
        importInputRef={importInputRef}
        onImportChange={handleImportChange}
        sessionBusy={sessionBusy}
        onSaveSession={handleSaveSession}
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectedSessionIdChange={setSelectedSessionId}
        onLoadSession={handleLoadSession}
        onExportSession={handleExportSession}
        onImportClick={handleImportClick}
        exportMinutes={exportMinutes}
        exportSeconds={exportSeconds}
        onExportMinutesChange={handleExportMinutesChange}
        onExportSecondsChange={handleExportSecondsChange}
        onExportMix={exportMixdown}
        exporting={exporting}
        hasExportDecks={hasExportDecks}
        exportEstimateLabel={exportEstimateLabel}
        onSessionNameChange={setSessionName}
        onClearAllStorage={handleClearAllStorage}
        clearingStorage={clearingStorage}
      />
      <MidiPanel
        supported={midiSupported}
        accessGranted={midiAccessGranted}
        accessError={midiAccessError}
        onRequestAccess={() => void requestMidiAccess()}
        inputs={midiInputs}
        outputs={midiOutputs}
        selectedInputId={selectedMidiInputId}
        onSelectedInputIdChange={setSelectedMidiInputId}
        selectedOutputId={selectedMidiOutputId}
        onSelectedOutputIdChange={setSelectedMidiOutputId}
        focusedDeckLabel={focusedDeck ? `Deck ${focusedDeck.id}` : "No Deck Selected"}
        mappings={midiMappings}
        learnTarget={midiLearnTarget}
        onBeginLearn={beginMidiLearn}
        onCancelLearn={cancelMidiLearn}
        onRemoveMapping={removeMidiMapping}
        onClearMappings={clearMidiMappings}
        onLoadTwisterProfile={loadTwisterProfile}
        twisterModeEnabled={twisterModeEnabled}
        onToggleTwisterMode={toggleTwisterMode}
        learnModeEnabled={midiLearnModeEnabled}
        onToggleLearnMode={() => {
          setMidiLearnModeEnabled((prev) => {
            const next = !prev;
            if (!next) {
              cancelMidiLearn();
            }
            return next;
          });
        }}
      />

      <main className="app__main">
        {showWelcomePanel ? (
          <WelcomePanel
            onClose={() => {
              setWelcomePanelDismissed(true);
              setShowWelcomePanelOverride(false);
            }}
            onOpenDemoLoop={handleOpenDemoLoop}
          />
        ) : null}
        <ClipRecorder
          decks={decks}
          zipDragActive={zipDragOver}
          onLoadDeckHoverChange={setClipLoadHoverDeckId}
          clips={clips}
          onLoadClip={async (deckId, clip) => {
            await handleLoadClipToDeck(deckId, clip);
            try {
              await triggerAutosaveNow();
            } catch (error) {
              console.error("Autosave after clip load failed", error);
            }
          }}
          onAddClip={addClip}
          onUpdateClip={updateClip}
          onRemoveClip={removeClip}
        />
        <DeckStack {...deckStackProps} hoveredDeckId={clipLoadHoverDeckId} />
      </main>
      <KeyboardShortcutsDialog
        open={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />
      <StorageDiagnosticsOverlay
        open={showStorageDiagnostics}
        onClose={() => setShowStorageDiagnostics(false)}
      />
      <AudioUnlockOverlay
        open={audioContextState !== "running" && !import.meta.env.DEV}
        audioUnlockError={audioUnlockError}
        onEnableAudio={() => void handleEnableAudio()}
      />
      </MidiLearnProvider>
      </TwisterModeProvider>
    </div>
  );
};

export default App;
