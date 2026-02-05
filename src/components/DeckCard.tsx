import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckFxPanel, DeckState } from "../types/deck";
import type { AutomationParam } from "../types/session";
import AutomationLane from "./AutomationLane";
import Knob from "./Knob";
import Waveform from "./Waveform";
import AsyncActionButton from "./AsyncActionButton";
import { setPerfCounter } from "../utils/perf";

type DeckCardProps = {
  deck: DeckState;
  label: string;
  isActive: boolean;
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
  onDelayTimeChange: (id: number, value: number) => void;
  onDelayFeedbackChange: (id: number, value: number) => void;
  onDelayMixChange: (id: number, value: number) => void;
  onDelayToneChange: (id: number, value: number) => void;
  onDelayPingPongChange: (id: number, value: boolean) => void;
  onDelaySliceSyncChange: (id: number, value: boolean) => void;
  onFractalMixChange: (id: number, value: number) => void;
  onFractalStructureChange: (id: number, value: number) => void;
  onFractalDepthChange: (id: number, value: number) => void;
  onFractalDriftChange: (id: number, value: number) => void;
  onFractalDecayChange: (id: number, value: number) => void;
  onFractalToneChange: (id: number, value: number) => void;
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
  onDeckWidthOverrideChange: (id: number, value?: "full" | "half") => void;
  onStretchRatioChange: (id: number, value: number) => void;
  onStretchWindowSizeChange: (id: number, value: number) => void;
  onStretchStereoWidthChange: (id: number, value: number) => void;
  onStretchPhaseRandomnessChange: (id: number, value: number) => void;
  onStretchTiltDbChange: (id: number, value: number) => void;
  onStretchScatterChange: (id: number, value: number) => void;
  onRearrangerSlicesChange: (id: number, value: number) => void;
  onRearrangerOffsetChange: (id: number, value: number) => void;
  onRearrangerChaosChange: (id: number, value: number) => void;
  onRearrangerReverseChange: (id: number, value: number) => void;
  onRearrangerSensitivityChange: (id: number, value: number) => void;
  onRearrangerQuietThresholdChange: (id: number, value: number) => void;
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
};

const FX_PANEL_KEYS: DeckFxPanel[] = [
  "gain",
  "djFilter",
  "resonance",
  "eqLow",
  "eqMid",
  "eqHigh",
  "balance",
  "pitch",
  "delay",
  "fractal",
  "rearranger",
  "stretch",
];
const TEMPO_SEMITONE_RATIO = Math.pow(2, 1 / 12);

const DeckCard = ({
  deck,
  label,
  isActive,
  zipDragActive = false,
  onActivate,
  onRemove,
  onLoadClick,
  onFileSelected,
  onPlay,
  onPause,
  onStop,
  onGainChange,
  onFilterChange,
  onResonanceChange,
  onEqLowChange,
  onEqMidChange,
  onEqHighChange,
  onDelayTimeChange,
  onDelayFeedbackChange,
  onDelayMixChange,
  onDelayToneChange,
  onDelayPingPongChange,
  onDelaySliceSyncChange,
  onFractalMixChange,
  onFractalStructureChange,
  onFractalDepthChange,
  onFractalDriftChange,
  onFractalDecayChange,
  onFractalToneChange,
  onBalanceChange,
  onPitchShiftChange,
  automation,
  onAutomationStart,
  onAutomationStop,
  onAutomationValueChange,
  getAutomationPlayhead,
  onAutomationToggle,
  onAutomationReset,
  onAutomationPreset,
  onAutomationLengthScale,
  onAutomationAmplitudeScale,
  onAutomationInvert,
  onAutomationDurationChange,
  onSeek,
  onZoomChange,
  onLoopChange,
  onLoopBoundsChange,
  onLoopBoundsChangeComplete,
  onTempoOffsetChange,
  onTempoPitchSyncChange,
  onDeckWidthOverrideChange,
  onStretchRatioChange,
  onStretchWindowSizeChange,
  onStretchStereoWidthChange,
  onStretchPhaseRandomnessChange,
  onStretchTiltDbChange,
  onStretchScatterChange,
  onRearrangerSlicesChange,
  onRearrangerOffsetChange,
  onRearrangerChaosChange,
  onRearrangerReverseChange,
  onRearrangerSensitivityChange,
  onRearrangerQuietThresholdChange,
  onRearrangerAutoChange,
  onRearrangerRegionsChange,
  onRearrangerSliceDelete,
  onRearrangerAutoSlice,
  onRearrangerTrimQuiet,
  onRearrangeLoop,
  onFxPanelToggle,
  onFxPanelsToggleAll,
  onFxResetAll,
  onStretchLoop,
  stretchEstimate,
  onSaveLoopClip,
  onCropLoop,
  getDeckPosition,
  getDeckPlaybackSnapshot,
  setFileInputRef,
}: DeckCardProps) => {
  const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
  const renderCountRef = useRef(0);
  useEffect(() => {
    renderCountRef.current += 1;
    setPerfCounter("deckCardRenders", renderCountRef.current);
  });

  const formatTempo = (value: number) => {
    if (Math.abs(value) < 0.005) return "0.00%";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };
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
  const formatDjFilter = (value: number, fine = false) => {
    const precision = fine ? 3 : 1;
    if (value > 0.05) return `HP ${value.toFixed(precision)}`;
    if (value < -0.05) return `LP ${Math.abs(value).toFixed(precision)}`;
    return "Flat";
  };
  const formatEq = (value: number, fine = false) => {
    if (value === 0) return "0.0 dB";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(fine ? 2 : 1)} dB`;
  };
  const isDifferent = (value: number, target: number, epsilon = 1e-3) =>
    Math.abs(value - target) > epsilon;
  const hasAutomationData = (track: {
    samples: Float32Array;
    previewSamples: Float32Array;
    recording: boolean;
  }) => track.samples.length > 0 || track.previewSamples.length > 0 || track.recording;
  const gainAutomation = automation?.gain ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.gain,
    amplitudeScale: 1,
  };
  const djAutomation = automation?.djFilter ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: djFilter,
    amplitudeScale: 1,
  };
  const resonanceAutomation = automation?.resonance ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: resonanceValue,
    amplitudeScale: 1,
  };
  const eqLowAutomation = automation?.eqLow ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqLowGain,
    amplitudeScale: 1,
  };
  const eqMidAutomation = automation?.eqMid ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqMidGain,
    amplitudeScale: 1,
  };
  const eqHighAutomation = automation?.eqHigh ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqHighGain,
    amplitudeScale: 1,
  };
  const balanceAutomation = automation?.balance ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.balance,
    amplitudeScale: 1,
  };
  const pitchAutomation = automation?.pitch ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.pitchShift,
    amplitudeScale: 1,
  };
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
  const tempoFineDragRef = useRef<{ startY: number; startValue: number } | null>(null);
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
    };
  }, []);
  const fxPanelOpen = deck.fxPanelOpen;
  useEffect(() => {
    if (!tempoEditing) return;
    tempoInputRef.current?.focus();
    tempoInputRef.current?.select();
  }, [tempoEditing]);

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
    if (!showQuietDeletePreview || !deck.buffer || !deck.loopEnabled) return [];
    const duration = deck.duration ?? deck.buffer.duration;
    const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
    const loopEnd =
      deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
        ? Math.min(deck.loopEndSeconds, duration)
        : duration;
    const loopDuration = loopEnd - loopStart;
    if (loopDuration <= 0.01) return [];
    const sampleRate = deck.buffer.sampleRate;
    const startSample = Math.max(0, Math.min(deck.buffer.length - 1, Math.round(loopStart * sampleRate)));
    const endSample = Math.max(startSample + 1, Math.min(deck.buffer.length, Math.round(loopEnd * sampleRate)));
    const segmentLength = endSample - startSample;
    if (segmentLength < 128) return [];
    const frameSize = Math.max(32, Math.round(sampleRate * 0.012));
    const hopSize = Math.max(16, Math.floor(frameSize / 2));
    if (segmentLength <= frameSize + hopSize) return [];
    const frameCount = Math.floor((segmentLength - frameSize) / hopSize) + 1;
    const envelope = new Array<number>(frameCount);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameStart = startSample + frameIndex * hopSize;
      let sum = 0;
      for (let channel = 0; channel < deck.buffer.numberOfChannels; channel += 1) {
        const data = deck.buffer.getChannelData(channel);
        for (let offset = 0; offset < frameSize; offset += 1) {
          const sample = data[frameStart + offset] ?? 0;
          sum += sample * sample;
        }
      }
      const count = frameSize * deck.buffer.numberOfChannels;
      envelope[frameIndex] = count > 0 ? Math.sqrt(sum / count) : 0;
    }
    const sorted = [...envelope].sort((a, b) => a - b);
    const p20 = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
    const p80 = sorted[Math.floor((sorted.length - 1) * 0.8)] ?? 0;
    const dynamic = Math.max(0, p80 - p20);
    const quietFactor = 0.03 + deck.rearrangerQuietThreshold * 0.17;
    const quietThreshold = p20 + dynamic * quietFactor;
    const minQuietSamples = Math.max(1, Math.round(sampleRate * 0.09));
    const keepGuardSamples = Math.max(1, Math.round(sampleRate * 0.01));
    const ranges: Array<{ start: number; end: number }> = [];
    let runStart = -1;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const isQuiet = envelope[frameIndex] <= quietThreshold;
      if (isQuiet) {
        if (runStart < 0) runStart = frameIndex;
        continue;
      }
      if (runStart >= 0) {
        const absStart = startSample + runStart * hopSize + keepGuardSamples;
        const absEnd = startSample + frameIndex * hopSize + frameSize - keepGuardSamples;
        if (absEnd - absStart >= minQuietSamples) {
          ranges.push({
            start: Math.max(0, Math.min(1, (absStart - startSample) / segmentLength)),
            end: Math.max(0, Math.min(1, (absEnd - startSample) / segmentLength)),
          });
        }
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      const absStart = startSample + runStart * hopSize + keepGuardSamples;
      const absEnd = endSample - keepGuardSamples;
      if (absEnd - absStart >= minQuietSamples) {
        ranges.push({
          start: Math.max(0, Math.min(1, (absStart - startSample) / segmentLength)),
          end: Math.max(0, Math.min(1, (absEnd - startSample) / segmentLength)),
        });
      }
    }
    return ranges.filter((range) => range.end > range.start);
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
  const allFxOpen = FX_PANEL_KEYS.every((key) => fxPanelOpen[key]);
  const toggleAllFxPanels = useCallback(() => {
    onFxPanelsToggleAll(deck.id, !allFxOpen);
  }, [allFxOpen, deck.id, onFxPanelsToggleAll]);
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
    balance: {
      automation: hasAutomationData(balanceAutomation),
      modified: isDifferent(deck.balance, 0),
    },
    pitch: {
      automation: hasAutomationData(pitchAutomation),
      modified: isDifferent(deck.pitchShift, 0),
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
          deck.delayPingPong ||
          deck.delaySliceSync
        ),
    },
    fractal: {
      automation: false,
      modified:
        deck.fractalMix > 1e-3 &&
        (
          isDifferent(deck.fractalMix, 0) ||
          isDifferent(deck.fractalStructure, 0.45) ||
          isDifferent(deck.fractalDepth, 0.35) ||
          isDifferent(deck.fractalDrift, 0.15) ||
          isDifferent(deck.fractalDecay, 0.2) ||
          isDifferent(deck.fractalTone, 6000, 1)
        ),
    },
    rearranger: {
      automation: false,
      modified:
        Math.round(deck.rearrangerSlices) > 0 ||
        Math.round(deck.rearrangerOffset) !== 0 ||
        isDifferent(deck.rearrangerChaos, 0) ||
        isDifferent(deck.rearrangerReverse, 0) ||
        isDifferent(deck.rearrangerSensitivity, 0.6) ||
        isDifferent(deck.rearrangerQuietThreshold, 0.3) ||
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
  const fxHints: Record<DeckFxPanel, string> = {
    gain: "Gain: controls deck output level before the FX chain.",
    djFilter: "DJ Filter: sweeps between low-pass and high-pass for transitions and tone shaping.",
    resonance: "Resonance: boosts filter edge intensity for sharper sweeps.",
    eqLow: "Low EQ: shape bass energy; boost for weight, cut for cleanup.",
    eqMid: "Mid EQ: shape presence and body; boost clarity or reduce boxiness.",
    eqHigh: "High EQ: shape brightness and air.",
    balance: "Balance: pan the deck left/right in stereo.",
    pitch: "Pitch: semitone shift for key matching or creative detune.",
    delay: "Delay: time, feedback, tone, mix, and ping-pong echo.",
    fractal: "Fractal Resonator: recursive modal texture generator.",
    rearranger:
      "Rearranger: Auto Slice detects transient boundaries. Delete Quiet removes low-energy spans in the loop. You can also click waveform between boundaries to add slices; hold Shift and click a slice to destructively remove that slice audio.",
    stretch: "Stretch: offline Paulstretch render with phase/width/tilt/scatter controls.",
  };
  const renderFxToggleLabel = (panel: DeckFxPanel, label: string) => {
    const indicator = fxIndicators[panel];
    return (
      <>
        <span className="deck__fx-toggle-label" title={fxHints[panel]}>
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
      className={`deck ${deck.deckWidthOverride ? `deck--width-${deck.deckWidthOverride}` : ""} ${isActive ? "deck--active" : ""} ${isFileDragOver && !zipDragActive ? "deck--drop-target" : ""}`.trim()}
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
            <span className="deck__label-text">{label}</span>
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
                  title="Pause playback at the current playhead position."
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
                      ? "Resume playback from the current playhead position."
                      : "Start playback."
                  }
                >
                  {deck.status === "paused" ? "Resume" : "Play"}
                </button>
              )}
              <button
                type="button"
                className={`deck__action ${deck.loopEnabled ? "is-active" : ""}`}
                onClick={() => onLoopChange(deck.id, !deck.loopEnabled)}
                title="Toggle loop playback for this deck."
              >
                {deck.loopEnabled ? "Looping" : "Loop"}
              </button>
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Save Loop"
                busyLabel="Saving..."
                onAction={() => onSaveLoopClip(deck.id, saveSettings)}
                title="Save the current loop as a clip."
              />
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Crop Loop"
                busyLabel="Cropping..."
                onAction={() => onCropLoop(deck.id)}
                title="Destructively crop the deck audio to the current loop bounds."
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
                title="Remove this deck. If this is the last deck, a new empty deck is created."
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
            <div className="deck__title">{deck.fileName ?? "No file loaded"}</div>
          </div>
          <div className="deck__meta">
            <div className="deck__bpm-summary">
              <div className="deck__meta-actions">
                <label
                  className="deck__pitch-sync"
                  title="When enabled, Save Loop stores the current deck FX/automation/settings (filters, EQ, delay, balance, pitch, tempo, stretch, and loop settings) as metadata without baking them into the audio. Loading that clip will reapply those settings to the target deck."
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
          balance={deck.balance}
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
          rearrangerOffset={deck.rearrangerOffset}
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
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="deck__fx">
        <div className="deck__fx-title">
          <span>Deck FX</span>
          <div className="deck__fx-title-actions">
            <button
              type="button"
              className="deck__action deck__fx-title-toggle"
              onClick={() => onFxResetAll(deck.id)}
            >
              Reset FX
            </button>
            <button type="button" className="deck__action deck__fx-title-toggle" onClick={toggleAllFxPanels}>
              {allFxOpen ? "Close All" : "Open All"}
            </button>
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--core">
          <div
            className={`deck__fx-unit deck__fx-unit--gain ${fxPanelOpen.gain ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.gain}
              onClick={() => toggleFxPanel("gain")}
            >
              {renderFxToggleLabel("gain", "Gain")}
            </button>
            <Knob
              label="Gain"
              min={0}
              max={1.5}
              step={0.01}
              value={gainValue}
              defaultValue={0.9}
              labelTitle="Controls deck output level before the FX chain."
              onChange={(next) => onGainChange(deck.id, next)}
              formatValue={(value, fine) => value.toFixed(fine ? 3 : 2)}
              isAutomated={gainAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={0}
              max={1.5}
              value={gainValue}
              samples={gainAutomation.samples}
              previewSamples={gainAutomation.previewSamples}
              durationSec={gainAutomation.durationSec}
              recording={gainAutomation.recording}
              active={gainAutomation.active}
              amplitudeScale={gainAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "gain")}
              onDrawStart={() => onAutomationStart(deck.id, "gain")}
              onDrawEnd={() => onAutomationStop(deck.id, "gain")}
              onReset={() => onAutomationReset(deck.id, "gain")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "gain", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "gain", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "gain", preset, 0, 1.5)}
              onInvert={() => onAutomationInvert(deck.id, "gain", 0, 1.5)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "gain", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "gain", factor, 0, 1.5)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "gain", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--filter ${fxPanelOpen.djFilter ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.djFilter}
              onClick={() => toggleFxPanel("djFilter")}
            >
              {renderFxToggleLabel("djFilter", "DJ Filter")}
            </button>
            <Knob
              label="DJ Filter"
              min={-1}
              max={1}
              step={0.01}
              value={djFilterValue}
              defaultValue={0}
              labelTitle="Sweeps between low‑pass and high‑pass. Center is full range."
              onChange={(next) => onFilterChange(deck.id, next)}
              formatValue={formatDjFilter}
              centerSnap={0.03}
              isAutomated={djAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-1}
              max={1}
              value={djFilterValue}
              samples={djAutomation.samples}
              previewSamples={djAutomation.previewSamples}
              durationSec={djAutomation.durationSec}
              recording={djAutomation.recording}
              active={djAutomation.active}
              amplitudeScale={djAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "djFilter")}
              onDrawStart={() => onAutomationStart(deck.id, "djFilter")}
              onDrawEnd={() => onAutomationStop(deck.id, "djFilter")}
              onReset={() => onAutomationReset(deck.id, "djFilter")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "djFilter", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "djFilter", value)
              }
              onPreset={(preset) =>
                onAutomationPreset(deck.id, "djFilter", preset, -1, 1)
              }
              onInvert={() => onAutomationInvert(deck.id, "djFilter", -1, 1)}
              onLengthScale={(factor) =>
                onAutomationLengthScale(deck.id, "djFilter", factor)
              }
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "djFilter", factor, -1, 1)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "djFilter", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--filter ${fxPanelOpen.resonance ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.resonance}
              onClick={() => toggleFxPanel("resonance")}
            >
              {renderFxToggleLabel("resonance", "Resonance")}
            </button>
            <Knob
              label="Resonance"
              min={resonanceMin}
              max={resonanceMax}
              step={0.05}
              value={resonanceDisplayValue}
              defaultValue={0}
              labelTitle="Boosts the filter edge. Higher values add more bite and focus."
              onChange={(next) => onResonanceChange(deck.id, next)}
              formatValue={(value, fine) => value.toFixed(fine ? 3 : 1)}
              isAutomated={resonanceAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={resonanceMin}
              max={resonanceMax}
              value={resonanceDisplayValue}
              samples={resonanceAutomation.samples}
              previewSamples={resonanceAutomation.previewSamples}
              durationSec={resonanceAutomation.durationSec}
              recording={resonanceAutomation.recording}
              active={resonanceAutomation.active}
              amplitudeScale={resonanceAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "resonance")}
              onDrawStart={() => onAutomationStart(deck.id, "resonance")}
              onDrawEnd={() => onAutomationStop(deck.id, "resonance")}
              onReset={() => onAutomationReset(deck.id, "resonance")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "resonance", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "resonance", value)
              }
              onPreset={(preset) =>
                onAutomationPreset(deck.id, "resonance", preset, resonanceMin, resonanceMax)
              }
              onInvert={() =>
                onAutomationInvert(deck.id, "resonance", resonanceMin, resonanceMax)
              }
              onLengthScale={(factor) =>
                onAutomationLengthScale(deck.id, "resonance", factor)
              }
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(
                  deck.id,
                  "resonance",
                  factor,
                  resonanceMin,
                  resonanceMax
                )
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "resonance", durationSec)
              }
            />
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--eq">
          <div
            className={`deck__fx-unit deck__fx-unit--eq ${fxPanelOpen.eqLow ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.eqLow}
              onClick={() => toggleFxPanel("eqLow")}
            >
              {renderFxToggleLabel("eqLow", "Low EQ")}
            </button>
            <Knob
              label="Low"
              min={-18}
              max={18}
              step={0.1}
              value={eqLowValue}
              defaultValue={0}
              labelTitle="Low‑shelf EQ. Positive adds bass, negative removes weight."
              onChange={(next) => onEqLowChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqLowAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-18}
              max={18}
              value={eqLowValue}
              samples={eqLowAutomation.samples}
              previewSamples={eqLowAutomation.previewSamples}
              durationSec={eqLowAutomation.durationSec}
              recording={eqLowAutomation.recording}
              active={eqLowAutomation.active}
              amplitudeScale={eqLowAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqLow")}
              onDrawStart={() => onAutomationStart(deck.id, "eqLow")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqLow")}
              onReset={() => onAutomationReset(deck.id, "eqLow")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqLow", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqLow", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "eqLow", preset, -18, 18)}
              onInvert={() => onAutomationInvert(deck.id, "eqLow", -18, 18)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqLow", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "eqLow", factor, -18, 18)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "eqLow", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--eq ${fxPanelOpen.eqMid ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.eqMid}
              onClick={() => toggleFxPanel("eqMid")}
            >
              {renderFxToggleLabel("eqMid", "Mid EQ")}
            </button>
            <Knob
              label="Mid"
              min={-18}
              max={18}
              step={0.1}
              value={eqMidValue}
              defaultValue={0}
              labelTitle="Mid‑band EQ. Boost presence or cut boxiness."
              onChange={(next) => onEqMidChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqMidAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-18}
              max={18}
              value={eqMidValue}
              samples={eqMidAutomation.samples}
              previewSamples={eqMidAutomation.previewSamples}
              durationSec={eqMidAutomation.durationSec}
              recording={eqMidAutomation.recording}
              active={eqMidAutomation.active}
              amplitudeScale={eqMidAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqMid")}
              onDrawStart={() => onAutomationStart(deck.id, "eqMid")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqMid")}
              onReset={() => onAutomationReset(deck.id, "eqMid")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqMid", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqMid", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "eqMid", preset, -18, 18)}
              onInvert={() => onAutomationInvert(deck.id, "eqMid", -18, 18)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqMid", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "eqMid", factor, -18, 18)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "eqMid", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--eq ${fxPanelOpen.eqHigh ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.eqHigh}
              onClick={() => toggleFxPanel("eqHigh")}
            >
              {renderFxToggleLabel("eqHigh", "High EQ")}
            </button>
            <Knob
              label="High"
              min={-18}
              max={18}
              step={0.1}
              value={eqHighValue}
              defaultValue={0}
              labelTitle="High‑shelf EQ. Positive adds air, negative tames brightness."
              onChange={(next) => onEqHighChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqHighAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-18}
              max={18}
              value={eqHighValue}
              samples={eqHighAutomation.samples}
              previewSamples={eqHighAutomation.previewSamples}
              durationSec={eqHighAutomation.durationSec}
              recording={eqHighAutomation.recording}
              active={eqHighAutomation.active}
              amplitudeScale={eqHighAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqHigh")}
              onDrawStart={() => onAutomationStart(deck.id, "eqHigh")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqHigh")}
              onReset={() => onAutomationReset(deck.id, "eqHigh")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqHigh", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqHigh", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "eqHigh", preset, -18, 18)}
              onInvert={() => onAutomationInvert(deck.id, "eqHigh", -18, 18)}
              onLengthScale={(factor) =>
                onAutomationLengthScale(deck.id, "eqHigh", factor)
              }
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "eqHigh", factor, -18, 18)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "eqHigh", durationSec)
              }
            />
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--single">
          <div
            className={`deck__fx-unit deck__fx-unit--balance ${fxPanelOpen.balance ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.balance}
              onClick={() => toggleFxPanel("balance")}
            >
              {renderFxToggleLabel("balance", "Balance")}
            </button>
            <Knob
              label="Balance"
              min={-1}
              max={1}
              step={0.01}
              value={balanceValue}
              defaultValue={0}
              labelTitle="Stereo pan. Left is negative, right is positive."
              onChange={(next) => onBalanceChange(deck.id, next)}
              formatValue={(value, fine) => value.toFixed(fine ? 3 : 1)}
              centerSnap={0.03}
              isAutomated={balanceAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-1}
              max={1}
              value={balanceValue}
              samples={balanceAutomation.samples}
              previewSamples={balanceAutomation.previewSamples}
              durationSec={balanceAutomation.durationSec}
              recording={balanceAutomation.recording}
              active={balanceAutomation.active}
              amplitudeScale={balanceAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "balance")}
              onDrawStart={() => onAutomationStart(deck.id, "balance")}
              onDrawEnd={() => onAutomationStop(deck.id, "balance")}
              onReset={() => onAutomationReset(deck.id, "balance")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "balance", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "balance", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "balance", preset, -1, 1)}
              onInvert={() => onAutomationInvert(deck.id, "balance", -1, 1)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "balance", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "balance", factor, -1, 1)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "balance", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--pitch ${fxPanelOpen.pitch ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.pitch}
              onClick={() => toggleFxPanel("pitch")}
            >
              {renderFxToggleLabel("pitch", "Pitch")}
            </button>
            <Knob
              label="Pitch"
              min={-24}
              max={24}
              step={0.1}
              value={pitchValue}
              defaultValue={0}
              labelTitle="Pitch shift in semitones. Positive raises, negative lowers."
              onChange={(next) => onPitchShiftChange(deck.id, next)}
              formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)} st`}
              centerSnap={0.25}
              isAutomated={pitchAutomation.active}
              disabled={deck.tempoPitchSync}
            />
            <AutomationLane
              label="Automation"
              min={-24}
              max={24}
              value={pitchValue}
              samples={pitchAutomation.samples}
              previewSamples={pitchAutomation.previewSamples}
              durationSec={pitchAutomation.durationSec}
              recording={pitchAutomation.recording}
              active={pitchAutomation.active}
              amplitudeScale={pitchAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "pitch")}
              onDrawStart={() => onAutomationStart(deck.id, "pitch")}
              onDrawEnd={() => onAutomationStop(deck.id, "pitch")}
              onReset={() => onAutomationReset(deck.id, "pitch")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "pitch", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "pitch", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "pitch", preset, -24, 24)}
              onInvert={() => onAutomationInvert(deck.id, "pitch", -24, 24)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "pitch", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "pitch", factor, -24, 24)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "pitch", durationSec)
              }
              disabled={deck.tempoPitchSync}
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--delay deck__fx-unit--span-2 ${fxPanelOpen.delay ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.delay}
              onClick={() => toggleFxPanel("delay")}
            >
              {renderFxToggleLabel("delay", "Delay")}
            </button>
            <div className="deck__delay-controls">
              <Knob
                className="knob--compact"
                label="Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.delayMix}
                defaultValue={0}
                labelTitle="Wet/dry mix. 0 = dry, 1 = fully delayed."
                onChange={(next) => onDelayMixChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Time"
                min={0.01}
                max={1.5}
                step={0.01}
                value={deck.delayTime}
                defaultValue={0.35}
                labelTitle="Delay time in seconds. Longer values create wider gaps between repeats."
                onChange={(next) => onDelayTimeChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}s`}
                disabled={deck.delaySliceSync}
              />
              <Knob
                className="knob--compact"
                label="Feedback"
                min={0}
                max={0.95}
                step={0.01}
                value={deck.delayFeedback}
                defaultValue={0.35}
                labelTitle="Feedback amount. Higher values create more repeats."
                onChange={(next) => onDelayFeedbackChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Tone"
                min={400}
                max={12000}
                step={100}
                value={deck.delayTone}
                defaultValue={6000}
                labelTitle="Low-pass filter inside the feedback path. Lower = darker repeats."
                onChange={(next) => onDelayToneChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 1 : 0)} Hz`}
              />
            </div>
            <div className="deck__delay-options">
              <label
                className="deck__delay-toggle"
                title="Cross-feed delay repeats between left and right channels."
              >
                <span>Ping Pong</span>
                <input
                  type="checkbox"
                  checked={deck.delayPingPong}
                  onChange={(event) =>
                    onDelayPingPongChange(deck.id, event.target.checked)
                  }
                />
              </label>
              <label
                className="deck__delay-toggle"
                title="Match delay time to the currently playing rearranger slice length. When enabled, the Time knob is disabled."
              >
                <span>Slice Sync</span>
                <input
                  type="checkbox"
                  checked={deck.delaySliceSync}
                  onChange={(event) =>
                    onDelaySliceSyncChange(deck.id, event.target.checked)
                  }
                />
              </label>
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--fractal deck__fx-unit--span-2 ${fxPanelOpen.fractal ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.fractal}
              onClick={() => toggleFxPanel("fractal")}
            >
              {renderFxToggleLabel("fractal", "Fractal Resonator")}
            </button>
            <div className="deck__fractal-controls">
              <Knob
                className="knob--compact"
                label="Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.fractalMix}
                defaultValue={0}
                labelTitle="Wet/dry blend for the resonator."
                onChange={(next) => onFractalMixChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Structure"
                min={0}
                max={1}
                step={0.01}
                value={deck.fractalStructure}
                defaultValue={0.45}
                labelTitle="Shapes modal spacing from clustered to spread."
                onChange={(next) => onFractalStructureChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Depth"
                min={0}
                max={1}
                step={0.01}
                value={deck.fractalDepth}
                defaultValue={0.35}
                labelTitle="Controls resonance density and emphasis."
                onChange={(next) => onFractalDepthChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Drift"
                min={0}
                max={1}
                step={0.01}
                value={deck.fractalDrift}
                defaultValue={0.15}
                labelTitle="Detunes resonant modes for motion and shimmer."
                onChange={(next) => onFractalDriftChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Decay"
                min={0}
                max={0.96}
                step={0.01}
                value={deck.fractalDecay}
                defaultValue={0.2}
                labelTitle="Feedback amount inside the resonator."
                onChange={(next) => onFractalDecayChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Tone"
                min={300}
                max={14000}
                step={100}
                value={deck.fractalTone}
                defaultValue={6000}
                labelTitle="Top-end damping for the resonator body."
                onChange={(next) => onFractalToneChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 1 : 0)} Hz`}
              />
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--rearranger deck__fx-unit--span-2 ${fxPanelOpen.rearranger ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.rearranger}
              onClick={() => toggleFxPanel("rearranger")}
            >
              {renderFxToggleLabel("rearranger", "Rearranger")}
            </button>
            <div className="deck__rearranger-controls">
              <Knob
                className="knob--compact"
                label="Slices"
                min={0}
                max={Math.max(64, Math.round(deck.rearrangerSlices || 0))}
                step={1}
                value={deck.rearrangerSlices}
                defaultValue={0}
                labelTitle="Number of slices. You can also click between waveform boundaries to add slices, or hold Shift and click a slice region to destructively remove it."
                onChange={(next) => onRearrangerSlicesChange(deck.id, next)}
                formatValue={(value) => {
                  const rounded = Math.round(value);
                  return rounded <= 0 ? "Off" : `${rounded}`;
                }}
              />
              <Knob
                className="knob--compact"
                label="Offset"
                min={-32}
                max={32}
                step={1}
                value={deck.rearrangerOffset}
                defaultValue={0}
                labelTitle="Rotates slice order by this many steps."
                onChange={(next) => onRearrangerOffsetChange(deck.id, next)}
                formatValue={(value) => `${Math.round(value)}`}
              />
              <Knob
                className="knob--compact"
                label="Chaos"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerChaos}
                defaultValue={0}
                labelTitle="Randomly swaps slices; higher values produce less predictable order."
                onChange={(next) => onRearrangerChaosChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Reverse"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerReverse}
                defaultValue={0}
                labelTitle="Chance each slice is reversed."
                onChange={(next) => onRearrangerReverseChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Sensitivity"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerSensitivity}
                defaultValue={0.6}
                labelTitle="Auto Slice sensitivity. Higher values detect quieter/smaller onset changes and create more slices."
                onChange={(next) => onRearrangerSensitivityChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Quiet Thresh"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerQuietThreshold}
                defaultValue={0.3}
                labelTitle="Delete Quiet threshold. Higher values classify more of the loop as quiet."
                onChange={(next) => onRearrangerQuietThresholdChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <label
                className="deck__delay-toggle"
                title="When enabled, the current loop is rearranged again each time playback wraps to the loop start."
              >
                <span>On Loop</span>
                <input
                  type="checkbox"
                  checked={deck.rearrangerAuto}
                  onChange={(event) => onRearrangerAutoChange(deck.id, event.target.checked)}
                />
              </label>
            </div>
            <div className="deck__fx-actions">
              <button
                type="button"
                className="deck__action"
                disabled={!deck.buffer}
                onClick={() => onRearrangerAutoSlice(deck.id)}
                title="Detect slice boundaries from loop transients."
              >
                Auto Slice
              </button>
              <button
                type="button"
                className="deck__action"
                disabled={!deck.buffer}
                onClick={() => onRearrangerTrimQuiet(deck.id)}
                onPointerEnter={() => setShowQuietDeletePreview(true)}
                onPointerLeave={() => setShowQuietDeletePreview(false)}
                onFocus={() => setShowQuietDeletePreview(true)}
                onBlur={() => setShowQuietDeletePreview(false)}
                title="Detect quiet sections in the loop and destructively remove them."
              >
                Delete Quiet
              </button>
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Rearrange Loop"
                busyLabel="Rearranging..."
                onAction={() => onRearrangeLoop(deck.id)}
              />
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--stretch deck__fx-unit--span-2 ${fxPanelOpen.stretch ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.stretch}
              onClick={() => toggleFxPanel("stretch")}
            >
              {renderFxToggleLabel("stretch", "Stretch")}
            </button>
            <div className="deck__stretch-grid">
              <Knob
                label="Amount"
                min={1}
                max={16}
                step={0.1}
                value={deck.stretchRatio}
                defaultValue={2}
                labelTitle="Lengthens or shortens the loop. Higher values create longer, slower textures."
                onChange={(next) => onStretchRatioChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}x`}
              />
              <div className="deck__stretch-controls">
                <Knob
                  className="knob--compact"
                  label="Phase"
                  min={0}
                  max={1}
                  step={0.05}
                  value={deck.stretchPhaseRandomness}
                  defaultValue={0.5}
                  labelTitle="Controls how random the phase is. Higher values sound more diffuse and airy."
                  onChange={(next) => onStretchPhaseRandomnessChange(deck.id, next)}
                  formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
                />
                <Knob
                  className="knob--compact"
                  label="Width"
                  min={0}
                  max={2}
                  step={0.05}
                  value={deck.stretchStereoWidth}
                  defaultValue={1}
                  labelTitle="Stereo width after stretch. 0 = mono, 1 = original width, 2 = wide."
                  onChange={(next) => onStretchStereoWidthChange(deck.id, next)}
                  formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}x`}
                />
                <Knob
                  className="knob--compact"
                  label="Tilt"
                  min={-18}
                  max={18}
                  step={0.1}
                  value={deck.stretchTiltDb}
                  defaultValue={0}
                  labelTitle="Spectral tilt across frequencies. Positive = brighter, negative = darker."
                  onChange={(next) => onStretchTiltDbChange(deck.id, next)}
                  formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)} dB`}
                />
                <Knob
                  className="knob--compact"
                  label="Scatter"
                  min={1}
                  max={16}
                  step={0.05}
                  value={deck.stretchScatter}
                  defaultValue={1}
                  labelTitle="Grain spacing multiplier. Higher = grains farther apart with more space between."
                  onChange={(next) => onStretchScatterChange(deck.id, next)}
                  formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}x`}
                />
                <Knob
                  className="knob--compact"
                  label="Window"
                  min={1}
                  max={stretchWindowSizes.length}
                  step={1}
                  value={stretchWindowIndex + 1}
                  defaultValue={stretchWindowSizes.indexOf(16384) + 1}
                  labelTitle="FFT window size. Larger = smoother, smaller = grainier/clearer transients."
                  centerSnap={0}
                  onChange={(next) => {
                    const index = Math.min(
                      stretchWindowSizes.length - 1,
                      Math.max(0, Math.round(next) - 1)
                    );
                    onStretchWindowSizeChange(deck.id, stretchWindowSizes[index]);
                  }}
                  formatValue={() => `${stretchWindowSizes[stretchWindowIndex] / 1024}k`}
                />
              </div>
            </div>
            <div className="deck__fx-actions">
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Stretch Loop"
                busyLabel="Stretching..."
                onAction={() => onStretchLoop(deck.id)}
              />
              {stretchEstimate ? (
                <span className="deck__stretch-estimate">{stretchEstimate}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeckCard;
