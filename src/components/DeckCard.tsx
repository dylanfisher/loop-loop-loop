import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type {
  DeckFxPanel,
  DeckState,
  EqMode,
  ParametricEqBand,
  ParametricEqMotionState,
  SimpleAutomationParam,
} from "../types/deck";
import type { AutomationParam } from "../types/session";
import Waveform from "./Waveform";
import AsyncActionButton from "./AsyncActionButton";
import DeckCardFxRack from "./DeckCardFxRack";
import { useDeckCardFxRackProps } from "../hooks/useDeckCardFxRackProps";
import { setPerfCounter } from "../utils/perf";
import {
  FX_HINTS,
  FX_PANEL_KEYS,
  TEMPO_SEMITONE_RATIO,
  buildQuietDeletePreviewRanges,
  createAutomationFallback,
  formatDjFilter,
  formatEq,
  formatTempo,
  hasAutomationData,
  isDifferent,
} from "./deckCardUtils";

export type DeckCardProps = {
  deck: DeckState;
  label: string;
  isActive: boolean;
  isClipLoadHovered?: boolean;
  zipDragActive?: boolean;
  onActivate: (id: number) => void;
  onRemove: (id: number) => void;
  onLoadClick: (id: number) => void;
  onFileSelected: (id: number, file: File | null, options?: { gain?: number }) => void;
  onPlay: (deck: DeckState) => void;
  onPause: (deck: DeckState) => void;
  onStop: (deck: DeckState) => void;
  onGainChange: (id: number, value: number) => void;
  onFilterChange: (id: number, value: number) => void;
  onResonanceChange: (id: number, value: number) => void;
  onEqLowChange: (id: number, value: number) => void;
  onEqMidChange: (id: number, value: number) => void;
  onEqHighChange: (id: number, value: number) => void;
  onEqModeChange: (id: number, value: EqMode) => void;
  onParametricEqBandsChange: (id: number, bands: ParametricEqBand[]) => void;
  onParametricEqMotionChange: (id: number, value: ParametricEqMotionState) => void;
  onSimpleAutomationSet: (
    id: number,
    param: SimpleAutomationParam,
    target: number,
    baseline: number,
    recording?: { samples: number[]; sampleRate: number; durationSec: number }
  ) => void;
  onSimpleAutomationClear: (id: number, param: SimpleAutomationParam) => void;
  onDelayTimeChange: (id: number, value: number) => void;
  onDelayFeedbackChange: (id: number, value: number) => void;
  onDelayMixChange: (id: number, value: number) => void;
  onDelayToneChange: (id: number, value: number) => void;
  onDelayPingPongChange: (id: number, value: boolean) => void;
  onDelaySaturationChange: (id: number, value: number) => void;
  onDelayDampingChange: (id: number, value: number) => void;
  onDelaySafetyChange: (id: number, value: number) => void;
  onDelayRhythmMorphChange: (id: number, value: number) => void;
  onDelayRhythmRateHzChange: (id: number, value: number) => void;
  onDelayRhythmSwingChange: (id: number, value: number) => void;
  onDelayDuckDepthChange: (id: number, value: number) => void;
  onDelayDuckThresholdChange: (id: number, value: number) => void;
  onDelayDuckResponseMsChange: (id: number, value: number) => void;
  onDelaySpectralMixChange: (id: number, value: number) => void;
  onDelaySpectralSpreadChange: (id: number, value: number) => void;
  onDelaySliceSyncChange: (id: number, value: boolean) => void;
  onVocoderMixChange: (id: number, value: number) => void;
  onVocoderCarrierDeckIdChange: (id: number, value: number | null) => void;
  onVocoderModulatorMonitorChange: (id: number, value: number) => void;
  onVocoderModDriveChange: (id: number, value: number) => void;
  onVocoderBandCountChange: (id: number, value: number) => void;
  onVocoderAttackMsChange: (id: number, value: number) => void;
  onVocoderReleaseMsChange: (id: number, value: number) => void;
  onVocoderPhaseRotateChange: (id: number, value: number) => void;
  onVocoderGateThresholdChange: (id: number, value: number) => void;
  onVocoderPostDelayChange: (id: number, value: boolean) => void;
  carrierDeckOptions: Array<{ id: number; label: string }>;
  vocoderModulatingTargetDeckIds: number[];
  vocoderModulatingTargets: string[];
  onDisableDeckVocoder: (id: number) => void;
  onDisableDeckVocoders: (ids: number[]) => void;
  onBalanceChange: (id: number, value: number) => void;
  onPitchShiftChange: (id: number, value: number) => void;
  automation?: Record<
    AutomationParam,
    {
      samples: Float32Array;
      previewSamples: Float32Array;
      durationSec: number;
      recording: boolean;
      active: boolean;
      currentValue: number;
      amplitudeScale: number;
    }
  >;
  onAutomationStart: (id: number, param: AutomationParam) => void;
  onAutomationStop: (id: number, param: AutomationParam) => void;
  onAutomationValueChange: (
    id: number,
    param: AutomationParam,
    value: number
  ) => void;
  getAutomationPlayhead: (id: number, param: AutomationParam) => number;
  onAutomationToggle: (
    id: number,
    param: AutomationParam,
    active: boolean
  ) => void;
  onAutomationReset: (id: number, param: AutomationParam) => void;
  onAutomationPreset: (
    id: number,
    param: AutomationParam,
    preset: "sine" | "triangle" | "ramp",
    min: number,
    max: number
  ) => void;
  onAutomationLengthScale: (
    id: number,
    param: AutomationParam,
    factor: number
  ) => void;
  onAutomationAmplitudeScale: (
    id: number,
    param: AutomationParam,
    factor: number,
    min: number,
    max: number
  ) => void;
  onAutomationInvert: (
    id: number,
    param: AutomationParam,
    min: number,
    max: number
  ) => void;
  onAutomationDurationChange: (
    id: number,
    param: AutomationParam,
    durationSec: number
  ) => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onLoopBoundsChangeComplete: (id: number) => void;
  onTempoOffsetChange: (
    id: number,
    value: number,
    options?: { disableSnap?: boolean }
  ) => void;
  onTempoPitchSyncChange: (id: number, value: boolean) => void;
  onDeckIncludeInRecordExportChange: (
    id: number,
    value: boolean,
    options?: { altKey?: boolean; shiftKey?: boolean }
  ) => void;
  onDeckWidthOverrideChange: (id: number, value?: "full" | "half") => void;
  onStretchRatioChange: (id: number, value: number) => void;
  onStretchWindowSizeChange: (id: number, value: number) => void;
  onStretchStereoWidthChange: (id: number, value: number) => void;
  onStretchPhaseRandomnessChange: (id: number, value: number) => void;
  onStretchTiltDbChange: (id: number, value: number) => void;
  onStretchScatterChange: (id: number, value: number) => void;
  onRearrangerSlicesChange: (id: number, value: number) => void;
  onRearrangerSwapCountChange: (id: number, value: number) => void;
  onRearrangerChaosChange: (id: number, value: number) => void;
  onRearrangerReverseChange: (id: number, value: number) => void;
  onRearrangerSensitivityChange: (id: number, value: number) => void;
  onRearrangerQuietThresholdChange: (id: number, value: number) => void;
  onRearrangerSliceFadeChange: (id: number, value: number) => void;
  onRearrangerSliceDelayChange: (id: number, value: number) => void;
  onRearrangerPingPongChange: (id: number, value: number) => void;
  onRearrangerAutoChange: (id: number, value: boolean) => void;
  onRearrangerRegionsChange: (id: number, regions?: number[]) => void;
  onRearrangerSliceDelete: (id: number, sliceIndex: number) => void;
  onRearrangerAutoSlice: (id: number) => void;
  onRearrangerTrimQuiet: (id: number) => void;
  onRearrangeLoop: (id: number) => void;
  onFxPanelToggle: (id: number, panel: DeckFxPanel, open: boolean) => void;
  onFxPanelsToggleAll: (id: number, open: boolean) => void;
  onFxResetAll: (id: number) => void;
  onStretchLoop: (id: number) => void;
  stretchEstimate?: string | null;
  onSaveLoopClip: (id: number, includeSettings: boolean) => void;
  onCropLoop: (id: number) => void;
  onDuplicateLoop: (id: number, includeSettings: boolean) => void;
  getDeckPosition: (id: number) => number | null;
  getDeckPlaybackSnapshot: (id: number) => {
    position: number;
    duration: number;
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
    playing: boolean;
    playbackRate: number;
  } | null;
  setFileInputRef: (id: number, node: HTMLInputElement | null) => void;
  onTitleDragStart?: (event: ReactDragEvent<HTMLElement>) => void;
};

const DeckCard = (props: DeckCardProps) => {
  const {
    deck,
    label,
    isActive,
    isClipLoadHovered = false,
    zipDragActive = false,
    onActivate,
    onRemove,
    onLoadClick,
    onFileSelected,
    onPlay,
    onPause,
    onStop,
    onEqModeChange,
    onParametricEqBandsChange,
    carrierDeckOptions,
    vocoderModulatingTargetDeckIds,
    vocoderModulatingTargets,
    onDisableDeckVocoder,
    onDisableDeckVocoders,
    automation,
    onSeek,
    onZoomChange,
    onLoopChange,
    onLoopBoundsChange,
    onLoopBoundsChangeComplete,
    onTempoOffsetChange,
    onTempoPitchSyncChange,
    onDeckIncludeInRecordExportChange,
    onDeckWidthOverrideChange,
    onRearrangerSlicesChange,
    onRearrangerAutoChange,
    onRearrangerRegionsChange,
    onRearrangerSliceDelete,
    onRearrangerAutoSlice,
    onFxPanelToggle,
    onFxPanelsToggleAll,
    onSaveLoopClip,
    onCropLoop,
    onDuplicateLoop,
    getDeckPosition,
    getDeckPlaybackSnapshot,
    setFileInputRef,
    onTitleDragStart,
  } = props;
  const deckCardFxRackProps = useDeckCardFxRackProps(props);
  const AUTO_SLICE_THROTTLE_MS = 90;
  const AUTO_SLICE_LONG_CLIP_DEBOUNCE_MS = 220;
  const AUTO_SLICE_DEBOUNCE_THRESHOLD_SEC = 30;
  const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
  const renderCountRef = useRef(0);
  useEffect(() => {
    renderCountRef.current += 1;
    setPerfCounter("deckCardRenders", renderCountRef.current);
  });

  const stretchWindowSizes = [2048, 4096, 8192, 16384];
  const stretchWindowIndex = Math.max(
    0,
    stretchWindowSizes.indexOf(deck.stretchWindowSize ?? 16384)
  );
  const zoomSteps = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  const zoomIndex = zoomSteps.reduce((bestIndex, step, index) => {
    const bestDiff = Math.abs(zoomSteps[bestIndex] - deck.zoom);
    const nextDiff = Math.abs(step - deck.zoom);
    return nextDiff < bestDiff ? index : bestIndex;
  }, 0);
  const zoomValue = zoomSteps[zoomIndex];
  const djFilter = Math.min(Math.max(deck.djFilter, -1), 1);
  const resonanceMin = 0;
  const resonanceMax = 24;
  const resonanceValue = Math.min(
    Math.max(deck.filterResonance, resonanceMin),
    resonanceMax
  );
  const gainAutomation = automation?.gain ?? createAutomationFallback(deck.gain);
  const djAutomation = automation?.djFilter ?? createAutomationFallback(djFilter);
  const resonanceAutomation = automation?.resonance ?? createAutomationFallback(resonanceValue);
  const eqLowAutomation = automation?.eqLow ?? createAutomationFallback(deck.eqLowGain);
  const eqMidAutomation = automation?.eqMid ?? createAutomationFallback(deck.eqMidGain);
  const eqHighAutomation = automation?.eqHigh ?? createAutomationFallback(deck.eqHighGain);
  const balanceAutomation = automation?.balance ?? createAutomationFallback(deck.balance);
  const pitchAutomation = automation?.pitch ?? createAutomationFallback(deck.pitchShift);
  const gainValue = gainAutomation.active ? gainAutomation.currentValue : deck.gain;
  const djFilterValue = djAutomation.active ? djAutomation.currentValue : djFilter;
  const resonanceDisplayValue = resonanceAutomation.active
    ? resonanceAutomation.currentValue
    : resonanceValue;
  const eqLowValue = eqLowAutomation.active ? eqLowAutomation.currentValue : deck.eqLowGain;
  const eqMidValue = eqMidAutomation.active ? eqMidAutomation.currentValue : deck.eqMidGain;
  const eqHighValue = eqHighAutomation.active ? eqHighAutomation.currentValue : deck.eqHighGain;
  const balanceValue = balanceAutomation.active
    ? balanceAutomation.currentValue
    : deck.balance;
  const pitchValue = pitchAutomation.active
    ? pitchAutomation.currentValue
    : deck.pitchShift;

  const playbackSnapshotRef = useRef(getDeckPlaybackSnapshot);
  const deckPositionRef = useRef(getDeckPosition);

  useEffect(() => {
    playbackSnapshotRef.current = getDeckPlaybackSnapshot;
  }, [getDeckPlaybackSnapshot]);

  useEffect(() => {
    deckPositionRef.current = getDeckPosition;
  }, [getDeckPosition]);

  const getCurrentSeconds = useCallback(() => {
    const snapshot = playbackSnapshotRef.current(deck.id);
    if (snapshot) return snapshot.position;
    return deckPositionRef.current(deck.id);
  }, [deck.id]);

  const handleSeek = useCallback(
    (progress: number) => {
      onSeek(deck.id, progress);
    },
    [deck.id, onSeek]
  );

  const handleLoopBoundsChange = useCallback(
    (startSeconds: number, endSeconds: number) => {
      if (deck.rearrangerAuto) {
        onRearrangerAutoChange(deck.id, false);
      }
      onLoopBoundsChange(deck.id, startSeconds, endSeconds);
    },
    [deck.id, deck.rearrangerAuto, onLoopBoundsChange, onRearrangerAutoChange]
  );
  const handleLoopBoundsChangeComplete = useCallback(() => {
    onLoopBoundsChangeComplete(deck.id);
  }, [deck.id, onLoopBoundsChangeComplete]);

  const handleLoopEnabledChange = useCallback(
    (enabled: boolean) => {
      onLoopChange(deck.id, enabled);
    },
    [deck.id, onLoopChange]
  );

  const handlePlaybackSnapshot = useCallback(
    () => playbackSnapshotRef.current(deck.id),
    [deck.id]
  );

  const handleEmptyClick = useCallback(() => {
    onLoadClick(deck.id);
  }, [deck.id, onLoadClick]);

  const [saveSettings, setSaveSettings] = useState(true);
  const [tempoFine, setTempoFine] = useState(false);
  const [tempoEditing, setTempoEditing] = useState(false);
  const [tempoInput, setTempoInput] = useState(deck.tempoOffset.toFixed(2));
  const [showQuietDeletePreview, setShowQuietDeletePreview] = useState(false);
  const [autoSliceEnabled, setAutoSliceEnabled] = useState(false);
  const tempoFineDragRef = useRef<{ startY: number; startValue: number } | null>(null);
  const autoSliceTimeoutRef = useRef<number | null>(null);
  const autoSliceLastRunMsRef = useRef(0);
  const tempoIgnoreChangeRef = useRef(false);
  const tempoInputRef = useRef<HTMLInputElement | null>(null);
  const tempoClickTimerRef = useRef<number | null>(null);
  const deckDragDepthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const isFileDrag = useCallback((dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types ?? []);
    return types.includes("Files");
  }, []);
  const getDroppedAudioFile = useCallback((dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return null;
    const files = Array.from(dataTransfer.files ?? []);
    if (!files.length) return null;
    return files.find((file) => file.type.startsWith("audio/")) ?? files[0] ?? null;
  }, []);
  useEffect(() => {
    return () => {
      if (tempoClickTimerRef.current !== null) {
        window.clearTimeout(tempoClickTimerRef.current);
      }
      if (autoSliceTimeoutRef.current !== null) {
        window.clearTimeout(autoSliceTimeoutRef.current);
      }
    };
  }, []);
  const fxPanelOpen = deck.fxPanelOpen;
  useEffect(() => {
    if (!tempoEditing) return;
    tempoInputRef.current?.focus();
    tempoInputRef.current?.select();
  }, [tempoEditing]);

  const scheduleAutoSlice = useCallback(() => {
    if (!deck.buffer) return;
    const run = () => {
      autoSliceLastRunMsRef.current = performance.now();
      onRearrangerAutoSlice(deck.id);
    };
    const totalDuration = deck.duration ?? deck.buffer.duration;
    const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
    const loopEnd =
      deck.loopEnabled && deck.loopEndSeconds > loopStart + 0.01
        ? Math.min(deck.loopEndSeconds, totalDuration)
        : totalDuration;
    const loopDuration = Math.max(0, loopEnd - loopStart);
    const useDebounce = loopDuration > AUTO_SLICE_DEBOUNCE_THRESHOLD_SEC;
    if (useDebounce) {
      if (autoSliceTimeoutRef.current !== null) {
        window.clearTimeout(autoSliceTimeoutRef.current);
      }
      autoSliceTimeoutRef.current = window.setTimeout(() => {
        autoSliceTimeoutRef.current = null;
        run();
      }, AUTO_SLICE_LONG_CLIP_DEBOUNCE_MS);
      return;
    }
    const now = performance.now();
    const elapsed = now - autoSliceLastRunMsRef.current;
    if (elapsed >= AUTO_SLICE_THROTTLE_MS && autoSliceTimeoutRef.current === null) {
      run();
      return;
    }
    if (autoSliceTimeoutRef.current !== null) {
      return;
    }
    const wait = Math.max(0, AUTO_SLICE_THROTTLE_MS - elapsed);
    autoSliceTimeoutRef.current = window.setTimeout(() => {
      autoSliceTimeoutRef.current = null;
      run();
    }, wait);
  }, [
    AUTO_SLICE_DEBOUNCE_THRESHOLD_SEC,
    AUTO_SLICE_LONG_CLIP_DEBOUNCE_MS,
    AUTO_SLICE_THROTTLE_MS,
    deck.buffer,
    deck.duration,
    deck.loopEnabled,
    deck.loopEndSeconds,
    deck.loopStartSeconds,
    deck.id,
    onRearrangerAutoSlice,
  ]);

  const handleRearrangerSlicesKnobChange = useCallback(
    (next: number) => {
      onRearrangerSlicesChange(deck.id, next);
      if (autoSliceEnabled) {
        scheduleAutoSlice();
      }
    },
    [autoSliceEnabled, deck.id, onRearrangerSlicesChange, scheduleAutoSlice]
  );

  const handleAutoSliceToggle = useCallback(
    (enabled: boolean) => {
      setAutoSliceEnabled(enabled);
      if (!enabled) {
        if (autoSliceTimeoutRef.current !== null) {
          window.clearTimeout(autoSliceTimeoutRef.current);
          autoSliceTimeoutRef.current = null;
        }
        return;
      }
      scheduleAutoSlice();
    },
    [scheduleAutoSlice]
  );

  useEffect(() => {
    if (deck.buffer) return;
    if (autoSliceTimeoutRef.current !== null) {
      window.clearTimeout(autoSliceTimeoutRef.current);
      autoSliceTimeoutRef.current = null;
    }
  }, [deck.buffer]);

  const commitTempoInput = useCallback(() => {
    const normalized = tempoInput.replace("%", "").trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      onTempoOffsetChange(deck.id, parsed, { disableSnap: true });
    }
    setTempoEditing(false);
  }, [deck.id, onTempoOffsetChange, tempoInput]);

  const resetTempoOffset = useCallback(() => {
    onTempoOffsetChange(deck.id, 0, { disableSnap: true });
    setTempoInput("0.00");
    setTempoEditing(false);
  }, [deck.id, onTempoOffsetChange]);

  const nudgeTempoBySemitone = useCallback(
    (direction: -1 | 1) => {
      const currentRate = clampPlaybackRate(1 + deck.tempoOffset / 100);
      const nextRate = clampPlaybackRate(
        currentRate * (direction > 0 ? TEMPO_SEMITONE_RATIO : 1 / TEMPO_SEMITONE_RATIO)
      );
      const nextOffset = (nextRate - 1) * 100;
      onTempoOffsetChange(deck.id, nextOffset, { disableSnap: true });
    },
    [deck.id, deck.tempoOffset, onTempoOffsetChange]
  );

  const quietDeletePreviewRanges = useMemo(() => {
    return buildQuietDeletePreviewRanges({
      buffer: deck.buffer,
      duration: deck.duration,
      loopEnabled: deck.loopEnabled,
      loopStartSeconds: deck.loopStartSeconds,
      loopEndSeconds: deck.loopEndSeconds,
      rearrangerQuietThreshold: deck.rearrangerQuietThreshold,
      showQuietDeletePreview,
    });
  }, [
    deck.buffer,
    deck.duration,
    deck.loopEnabled,
    deck.loopEndSeconds,
    deck.rearrangerQuietThreshold,
    deck.loopStartSeconds,
    showQuietDeletePreview,
  ]);
  const toggleFxPanel = useCallback(
    (panel: DeckFxPanel) => {
      onFxPanelToggle(deck.id, panel, !fxPanelOpen[panel]);
    },
    [deck.id, fxPanelOpen, onFxPanelToggle]
  );
  const activeModulatorLabel =
    deck.vocoderCarrierDeckId === null
      ? null
      : carrierDeckOptions.find((option) => option.id === deck.vocoderCarrierDeckId)?.label ?? null;
  const hasActiveVocoderModulatorLink = deck.vocoderMix > 1e-3 && activeModulatorLabel !== null;
  const isVocoderSourceForDecks = vocoderModulatingTargets.length > 0;
  const allFxOpen = FX_PANEL_KEYS.every((key) => fxPanelOpen[key]);
  const toggleAllFxPanels = useCallback(() => {
    onFxPanelsToggleAll(deck.id, !allFxOpen);
  }, [allFxOpen, deck.id, onFxPanelsToggleAll]);
  const commitParametricEqBands = useCallback(
    (bands: ParametricEqBand[]) => {
      if (deck.eqMode !== "parametric") {
        onEqModeChange(deck.id, "parametric");
      }
      onParametricEqBandsChange(deck.id, bands);
    },
    [deck.eqMode, deck.id, onEqModeChange, onParametricEqBandsChange]
  );
  const activateEq3Mode = useCallback(() => {
    if (deck.eqMode !== "eq3") {
      onEqModeChange(deck.id, "eq3");
    }
  }, [deck.eqMode, deck.id, onEqModeChange]);
  const fxIndicators: Record<DeckFxPanel, { automation: boolean; modified: boolean }> = {
    gain: {
      automation: hasAutomationData(gainAutomation),
      modified: isDifferent(deck.gain, 0.9),
    },
    djFilter: {
      automation: hasAutomationData(djAutomation),
      modified: isDifferent(deck.djFilter, 0),
    },
    resonance: {
      automation: hasAutomationData(resonanceAutomation),
      modified: isDifferent(deck.filterResonance, 0),
    },
    eqLow: {
      automation: hasAutomationData(eqLowAutomation),
      modified: isDifferent(deck.eqLowGain, 0),
    },
    eqMid: {
      automation: hasAutomationData(eqMidAutomation),
      modified: isDifferent(deck.eqMidGain, 0),
    },
    eqHigh: {
      automation: hasAutomationData(eqHighAutomation),
      modified: isDifferent(deck.eqHighGain, 0),
    },
    parametricEq: {
      automation: false,
      modified:
        deck.eqMode === "parametric" &&
        deck.parametricEqBands.some((band) => band.enabled && Math.abs(band.gain) > 1e-3),
    },
    balance: {
      automation: hasAutomationData(balanceAutomation),
      modified: isDifferent(deck.balance, 0),
    },
    pitch: {
      automation: hasAutomationData(pitchAutomation),
      modified: isDifferent(deck.pitchShift, 0),
    },
    vocoder: {
      automation: false,
      modified:
        isDifferent(deck.vocoderMix, 0) ||
        deck.vocoderCarrierDeckId !== null ||
        isDifferent(deck.vocoderModulatorMonitor, 0) ||
        isDifferent(deck.vocoderModDrive, 2) ||
        Math.round(deck.vocoderBandCount) !== 12 ||
        isDifferent(deck.vocoderAttackMs, 8) ||
        isDifferent(deck.vocoderReleaseMs, 5) ||
        isDifferent(deck.vocoderNoiseMix, 0) ||
        isDifferent(deck.vocoderGateThreshold, 0.5) ||
        deck.vocoderPostDelay,
    },
    delay: {
      automation: false,
      modified:
        deck.delayMix > 1e-3 &&
        (
          isDifferent(deck.delayMix, 0) ||
          isDifferent(deck.delayTime, 0.35) ||
          isDifferent(deck.delayFeedback, 0.35) ||
          isDifferent(deck.delayTone, 6000, 1) ||
          isDifferent(deck.delaySaturation ?? 0, 0) ||
          isDifferent(deck.delayDamping ?? 0, 0) ||
          isDifferent(deck.delaySafety ?? 0.35, 0.35) ||
          isDifferent(deck.delayRhythmMorph ?? 0, 0) ||
          isDifferent(deck.delayRhythmRateHz ?? 0, 0, 0.01) ||
          isDifferent(deck.delayRhythmSwing ?? 0, 0) ||
          isDifferent(deck.delayDuckDepth ?? 0, 0) ||
          isDifferent(deck.delayDuckThreshold ?? 0.2, 0.2) ||
          isDifferent(deck.delayDuckResponseMs ?? 80, 80, 0.5) ||
          isDifferent(deck.delaySpectralMix ?? 0, 0) ||
          isDifferent(deck.delaySpectralSpread ?? 0.35, 0.35) ||
          deck.delayPingPong ||
          deck.delaySliceSync
        ),
    },
    rearranger: {
      automation: false,
      modified:
        Math.round(deck.rearrangerSlices) > 0 ||
        Math.round(deck.rearrangerSwapCount) !== 0 ||
        isDifferent(deck.rearrangerChaos, 0) ||
        isDifferent(deck.rearrangerReverse, 0) ||
        isDifferent(deck.rearrangerSensitivity, 0.6) ||
        isDifferent(deck.rearrangerQuietThreshold, 0.3) ||
        isDifferent(deck.rearrangerSliceFadeMs, 0, 1) ||
        isDifferent(deck.rearrangerSliceDelaySec, 0) ||
        isDifferent(deck.rearrangerPingPong, 0) ||
        deck.rearrangerAuto ||
        (deck.rearrangerRegions?.length ?? 0) > 0,
    },
    stretch: {
      automation: false,
      modified:
        isDifferent(deck.stretchRatio, 2) ||
        Math.round(deck.stretchWindowSize) !== 16384 ||
        isDifferent(deck.stretchStereoWidth, 1) ||
        isDifferent(deck.stretchPhaseRandomness, 0.5) ||
        isDifferent(deck.stretchTiltDb, 0) ||
        isDifferent(deck.stretchScatter, 1),
    },
  };
  const renderFxToggleLabel = (panel: DeckFxPanel, label: string) => {
    const indicator = fxIndicators[panel];
    return (
      <>
        <span className="deck__fx-toggle-label" title={FX_HINTS[panel]}>
          {fxPanelOpen[panel] ? `${label} -` : `${label} +`}
        </span>
        {(indicator.automation || indicator.modified) && (
          <span className="deck__fx-toggle-indicators">
            {indicator.automation ? (
              <span
                className="deck__fx-toggle-indicator deck__fx-toggle-indicator--automation"
                title="Automation present"
                aria-hidden="true"
              />
            ) : null}
            {indicator.modified ? (
              <span
                className="deck__fx-toggle-indicator deck__fx-toggle-indicator--modified"
                title="Adjusted"
                aria-hidden="true"
              />
            ) : null}
          </span>
        )}
      </>
    );
  };

  return (
    <div
      className={`deck ${deck.deckWidthOverride ? `deck--width-${deck.deckWidthOverride}` : ""} ${isActive ? "deck--active" : ""} ${isClipLoadHovered ? "deck--clip-load-hovered" : ""} ${isFileDragOver && !zipDragActive ? "deck--drop-target" : ""}`.trim()}
      onPointerDownCapture={() => onActivate(deck.id)}
      onFocusCapture={() => onActivate(deck.id)}
      onDragEnter={(event) => {
        if (zipDragActive) return;
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        deckDragDepthRef.current += 1;
        onActivate(deck.id);
        setIsFileDragOver(true);
      }}
      onDragOver={(event) => {
        if (zipDragActive) return;
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!isFileDragOver) {
          onActivate(deck.id);
          setIsFileDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (zipDragActive) return;
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        deckDragDepthRef.current = Math.max(0, deckDragDepthRef.current - 1);
        if (deckDragDepthRef.current === 0) {
          setIsFileDragOver(false);
        }
      }}
      onDrop={(event) => {
        if (zipDragActive) return;
        const file = getDroppedAudioFile(event.dataTransfer);
        if (!file) return;
        event.preventDefault();
        deckDragDepthRef.current = 0;
        setIsFileDragOver(false);
        onActivate(deck.id);
        onFileSelected(deck.id, file);
      }}
    >
      <div className="deck__header">
        <div className="deck__label-row">
          <span className="deck__label">
            <span
              className="deck__drag-title"
              draggable
              onDragStart={(event) => onTitleDragStart?.(event)}
              title="Drag to reorder deck"
            >
              <span className="deck__drag-dots" aria-hidden="true" />
              <span className="deck__label-text">{label}</span>
            </span>
            <button
              type="button"
              className={`deck__record-export-toggle ${deck.includeInRecordExport ? "is-active" : "is-inactive"}`.trim()}
              onClick={(event) =>
                onDeckIncludeInRecordExportChange(deck.id, !deck.includeInRecordExport, {
                  altKey: event.altKey,
                  shiftKey: event.shiftKey,
                })
              }
              title={
                deck.includeInRecordExport
                  ? "Included in Export Mix. Click to exclude. Alt+Click: make only this deck active for export. Shift+Alt+Click: enable or disable export for all decks."
                  : "Excluded from Export Mix. Click to include. Alt+Click: make only this deck active for export. Shift+Alt+Click: enable or disable export for all decks."
              }
              aria-pressed={deck.includeInRecordExport}
            >
              REC
            </button>
            <button
              type="button"
              className="deck__width-toggle"
              onClick={() =>
                onDeckWidthOverrideChange(
                  deck.id,
                  deck.deckWidthOverride === "full" ? "half" : "full"
                )
              }
              title={
                deck.deckWidthOverride === "full"
                  ? "Deck width override: Full. Click to force half width."
                  : "Deck width override: Half. Click to force full width."
              }
            >
              {deck.deckWidthOverride === "full" ? "Full" : "Half"}
            </button>
          </span>
          <div className="deck__actions">
            <div className="deck__actions-left">
              <input
                ref={(node) => setFileInputRef(deck.id, node)}
                className="deck__file-input"
                type="file"
                accept="audio/*"
                onChange={(event) => onFileSelected(deck.id, event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="deck__actions-right">
              <button
                type="button"
                className="deck__action"
                disabled={!deck.buffer || deck.status === "loading"}
                onClick={() => onStop(deck)}
                title="Stop playback and return the playhead to the start."
              >
                Stop
              </button>
              {deck.status === "playing" ? (
                <button
                  type="button"
                  className="deck__action"
                  onClick={() => onPause(deck)}
                  title="Pause playback at the current playhead position. (Space)"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="deck__action"
                  disabled={!deck.buffer || deck.status === "loading"}
                  onClick={() => onPlay(deck)}
                  title={
                    deck.status === "paused"
                      ? "Resume playback from the current playhead position. (Space)"
                      : "Start playback. (Space)"
                  }
                >
                  {deck.status === "paused" ? "Resume" : "Play"}
                </button>
              )}
              <button
                type="button"
                className={`deck__action ${deck.loopEnabled ? "is-active" : ""}`}
                onClick={() => onLoopChange(deck.id, !deck.loopEnabled)}
                title="Toggle loop playback for this deck. (L)"
              >
                {deck.loopEnabled ? "Looping" : "Loop"}
              </button>
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Save"
                busyLabel="Saving..."
                successLabel="Saved"
                onAction={() => onSaveLoopClip(deck.id, saveSettings)}
                title="Save the current loop as a clip."
              />
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Crop"
                busyLabel="Cropping..."
                successLabel="Cropped"
                onAction={() => onCropLoop(deck.id)}
                title="Destructively crop the deck audio to the current loop bounds. (C)"
              />
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Duplicate"
                busyLabel="Duplicating..."
                successLabel="Duplicated"
                onAction={() => onDuplicateLoop(deck.id, saveSettings)}
                title="Open the current loop in a new deck without saving a clip. (D)"
              />
              <button
                type="button"
                className="deck__action"
                onClick={() => onLoadClick(deck.id)}
                title={deck.fileName ? "Replace the loaded audio file." : "Load an audio file."}
              >
                {deck.fileName ? "Replace" : "Load"}
              </button>
              <button
                type="button"
                className="deck__action deck__remove"
                onClick={() => onRemove(deck.id)}
                title="Remove this deck. If this is the last deck, a new empty deck is created. (Delete/Backspace)"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <div className="deck__subrow">
          <div className="deck__title-row">
            <span className={`deck__status deck__status--${deck.status}`}>
              {deck.status}
            </span>
            {hasActiveVocoderModulatorLink ? (
              <button
                type="button"
                className="deck__vocoder-link deck__vocoder-link--button"
                title={`Vocoder modulator linked to ${activeModulatorLabel}.`}
                onClick={() => onDisableDeckVocoder(deck.id)}
              >
                VOC SRC {activeModulatorLabel}
              </button>
            ) : null}
            {isVocoderSourceForDecks ? (
              <button
                type="button"
                className="deck__vocoder-link deck__vocoder-link--source deck__vocoder-link--button"
                title={`Used as vocoder source by ${vocoderModulatingTargets.join(", ")}.`}
                onClick={() => onDisableDeckVocoders(vocoderModulatingTargetDeckIds)}
              >
                VOC MOD {vocoderModulatingTargets.join(", ")}
              </button>
            ) : null}
            <div className="deck__title">{deck.fileName ?? "No file loaded"}</div>
          </div>
          <div className="deck__meta">
            <div className="deck__bpm-summary">
              <div className="deck__meta-actions">
                <label
                  className="deck__pitch-sync"
                  title="When enabled, Save stores the current deck FX/automation/settings (filters, EQ, vocoder, delay, balance, pitch, tempo, stretch, and loop settings) as metadata without baking them into the audio. Loading that clip will reapply those settings to the target deck."
                >
                  <input
                    type="checkbox"
                    checked={saveSettings}
                    onChange={(event) => setSaveSettings(event.target.checked)}
                  />
                  Save FX Settings
                </label>
                <label className="deck__pitch-sync">
                  <input
                    type="checkbox"
                    checked={deck.tempoPitchSync}
                    onChange={(event) => onTempoPitchSyncChange(deck.id, event.target.checked)}
                  />
                  Sync Pitch
                </label>
                {tempoEditing ? (
                  <span className="deck__tempo-inline">
                    <span>Tempo</span>
                    <input
                      ref={tempoInputRef}
                      className="deck__tempo-input"
                      value={tempoInput}
                      onChange={(event) => setTempoInput(event.target.value)}
                      onBlur={commitTempoInput}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitTempoInput();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setTempoInput(deck.tempoOffset.toFixed(2));
                          setTempoEditing(false);
                        }
                      }}
                      aria-label="Tempo offset percent"
                    />
                    <span>%</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="deck__tempo-trigger"
                    onClick={(event) => {
                      if (event.shiftKey) {
                        if (tempoClickTimerRef.current !== null) {
                          window.clearTimeout(tempoClickTimerRef.current);
                          tempoClickTimerRef.current = null;
                        }
                        resetTempoOffset();
                        return;
                      }
                      if (tempoClickTimerRef.current !== null) {
                        window.clearTimeout(tempoClickTimerRef.current);
                      }
                      tempoClickTimerRef.current = window.setTimeout(() => {
                        setTempoInput(deck.tempoOffset.toFixed(2));
                        setTempoEditing(true);
                        tempoClickTimerRef.current = null;
                      }, 220);
                    }}
                    onDoubleClick={() => {
                      if (tempoClickTimerRef.current !== null) {
                        window.clearTimeout(tempoClickTimerRef.current);
                        tempoClickTimerRef.current = null;
                      }
                      resetTempoOffset();
                    }}
                    onBlur={() => {
                      if (tempoClickTimerRef.current !== null) {
                        window.clearTimeout(tempoClickTimerRef.current);
                        tempoClickTimerRef.current = null;
                      }
                    }}
                    title="Click to manually enter tempo offset %. Use +/- for semitone-ratio tempo steps (~5.95% each), which keeps tempo moves aligned to musical pitch relationships."
                  >
                    Tempo {formatTempo(deck.tempoOffset)}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="deck__waveform-row">
        <Waveform
          buffer={deck.buffer}
          isPlaying={deck.status === "playing"}
          startedAtMs={deck.startedAtMs}
          duration={deck.duration}
          offsetSeconds={deck.offsetSeconds}
          zoom={deck.zoom}
          gain={deck.gain}
          eqLowGain={eqLowValue}
          eqMidGain={eqMidValue}
          eqHighGain={eqHighValue}
          loopEnabled={deck.loopEnabled}
          loopStartSeconds={deck.loopStartSeconds}
          loopEndSeconds={deck.loopEndSeconds}
          onSeek={handleSeek}
          onLoopBoundsChange={handleLoopBoundsChange}
          onLoopBoundsChangeComplete={handleLoopBoundsChangeComplete}
          onLoopEnabledChange={handleLoopEnabledChange}
          getCurrentSeconds={getCurrentSeconds}
          getPlaybackSnapshot={handlePlaybackSnapshot}
          onEmptyClick={handleEmptyClick}
          showRearrangerSlices={fxPanelOpen.rearranger}
          rearrangerSlices={deck.rearrangerSlices}
          rearrangerSwapCount={deck.rearrangerSwapCount}
          rearrangerChaos={deck.rearrangerChaos}
          rearrangerReverse={deck.rearrangerReverse}
          rearrangerRegions={deck.rearrangerRegions}
          rearrangerRegionIds={deck.rearrangerRegionIds}
          rearrangerDeletePreviewRanges={quietDeletePreviewRanges}
          onRearrangerRegionsChange={(regions) => onRearrangerRegionsChange(deck.id, regions)}
          onRearrangerSliceDelete={(sliceIndex) => onRearrangerSliceDelete(deck.id, sliceIndex)}
          onRearrangerSlicesChange={(value) => onRearrangerSlicesChange(deck.id, value)}
        />
        <label className="deck__bpm-slider deck__bpm-slider--vertical">
          <button
            type="button"
            className="deck__tempo-step"
            onClick={() => nudgeTempoBySemitone(1)}
            title="Increase tempo by one semitone ratio (~5.95%). 12 clicks = one octave."
          >
            +
          </button>
          <input
            type="range"
            min="-100"
            max="100"
            step={0.001}
            value={deck.tempoOffset}
            onChange={(event) => {
              if (tempoIgnoreChangeRef.current) return;
              const raw = Number(event.target.value);
              const isFine = tempoFine;
              const next = isFine ? raw : Math.round(raw * 10) / 10;
              onTempoOffsetChange(deck.id, next, isFine ? { disableSnap: true } : undefined);
            }}
            onDoubleClick={() => onTempoOffsetChange(deck.id, 0)}
            onPointerDown={(event) => {
              if (event.shiftKey) {
                tempoFineDragRef.current = {
                  startY: event.clientY,
                  startValue: deck.tempoOffset,
                };
                tempoIgnoreChangeRef.current = true;
              }
              setTempoFine(event.shiftKey);
            }}
            onPointerMove={(event) => {
              if (tempoFineDragRef.current) {
                if (!event.shiftKey) {
                  tempoFineDragRef.current = null;
                  tempoIgnoreChangeRef.current = false;
                  setTempoFine(false);
                  return;
                }
                event.preventDefault();
                const delta = (tempoFineDragRef.current.startY - event.clientY) * 0.002;
                const base = tempoFineDragRef.current.startValue;
                const next = Math.min(100, Math.max(-100, base + delta));
                onTempoOffsetChange(deck.id, next, { disableSnap: true });
                return;
              }
              if (tempoFine !== event.shiftKey) {
                setTempoFine(event.shiftKey);
              }
            }}
            onPointerUp={() => {
              const wasFineDrag = Boolean(tempoFineDragRef.current);
              tempoFineDragRef.current = null;
              if (wasFineDrag) {
                tempoIgnoreChangeRef.current = true;
                window.setTimeout(() => {
                  tempoIgnoreChangeRef.current = false;
                }, 0);
              } else {
                tempoIgnoreChangeRef.current = false;
              }
              setTempoFine(false);
            }}
            onPointerCancel={() => {
              tempoFineDragRef.current = null;
              tempoIgnoreChangeRef.current = false;
              setTempoFine(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Shift") {
                setTempoFine(true);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === "Shift") {
                setTempoFine(false);
              }
            }}
            onBlur={() => setTempoFine(false)}
          />
          <button
            type="button"
            className="deck__tempo-step"
            onClick={() => nudgeTempoBySemitone(-1)}
            title="Decrease tempo by one semitone ratio (~5.95%). 12 clicks = one octave."
          >
            -
          </button>
        </label>
        <div className="deck__waveform-side">
          <div className="deck__zoom">
            <span>Zoom</span>
            <div className="deck__zoom-controls">
              <button
                type="button"
                className="deck__zoom-button"
                disabled={zoomIndex <= 0}
                onClick={() => onZoomChange(deck.id, zoomSteps[Math.max(0, zoomIndex - 1)])}
                title="Zoom out waveform. (=)"
              >
                -
              </button>
              <button
                type="button"
                className="deck__zoom-readout"
                onDoubleClick={() => onZoomChange(deck.id, 1)}
              >
                {zoomValue}x
              </button>
              <button
                type="button"
                className="deck__zoom-button"
                disabled={zoomIndex >= zoomSteps.length - 1}
                onClick={() =>
                  onZoomChange(deck.id, zoomSteps[Math.min(zoomSteps.length - 1, zoomIndex + 1)])
                }
                title="Zoom in waveform. (-)"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
      <DeckCardFxRack
        deck={deck}
        deckProps={deckCardFxRackProps}
        fxPanelOpen={fxPanelOpen}
        allFxOpen={allFxOpen}
        toggleAllFxPanels={toggleAllFxPanels}
        toggleFxPanel={toggleFxPanel}
        renderFxToggleLabel={renderFxToggleLabel}
        gainValue={gainValue}
        djFilterValue={djFilterValue}
        resonanceMin={resonanceMin}
        resonanceMax={resonanceMax}
        resonanceDisplayValue={resonanceDisplayValue}
        eqLowValue={eqLowValue}
        eqMidValue={eqMidValue}
        eqHighValue={eqHighValue}
        balanceValue={balanceValue}
        pitchValue={pitchValue}
        gainAutomation={gainAutomation}
        djAutomation={djAutomation}
        resonanceAutomation={resonanceAutomation}
        eqLowAutomation={eqLowAutomation}
        eqMidAutomation={eqMidAutomation}
        eqHighAutomation={eqHighAutomation}
        balanceAutomation={balanceAutomation}
        pitchAutomation={pitchAutomation}
        formatDjFilter={formatDjFilter}
        formatEq={formatEq}
        activateEq3Mode={activateEq3Mode}
        commitParametricEqBands={commitParametricEqBands}
        onSimpleAutomationSet={props.onSimpleAutomationSet}
        onSimpleAutomationClear={props.onSimpleAutomationClear}
        autoSliceEnabled={autoSliceEnabled}
        handleAutoSliceToggle={handleAutoSliceToggle}
        handleRearrangerSlicesKnobChange={handleRearrangerSlicesKnobChange}
        setShowQuietDeletePreview={setShowQuietDeletePreview}
        stretchWindowSizes={stretchWindowSizes}
        stretchWindowIndex={stretchWindowIndex}
      />
    </div>
  );
};

export default DeckCard;
