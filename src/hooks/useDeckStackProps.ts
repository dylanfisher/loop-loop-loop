import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DeckState } from "../types/deck";
import type { DeckStackProps } from "../components/DeckStack";
import type { AutomationParam } from "../types/session";
import type { AutomationView } from "./useDecksShared";

type UseDeckStackPropsArgs = {
  decks: DeckState[];
  deckLayoutMode: "single" | "two";
  zipDragOver: boolean;
  activeDeckId: number | null;
  scrollToDeckId: number | null;
  setScrollToDeckId: Dispatch<SetStateAction<number | null>>;
  handleDeckActivate: (deckId: number) => void;
  removeDeck: (id: number) => void;
  handleLoadClick: (id: number) => void;
  handleFileSelected: (id: number, file: File | null, options?: {
    gain?: number;
    pitchShift?: number;
    balance?: number;
    tempoOffset?: number;
  }) => void;
  playDeck: (deck: DeckState) => void;
  pauseDeck: (deck: DeckState) => void;
  stopDeck: (deck: DeckState) => void;
  setDeckGain: (id: number, value: number) => void;
  setDeckFilter: (id: number, value: number) => void;
  setDeckResonance: (id: number, value: number) => void;
  setDeckEqLow: (id: number, value: number) => void;
  setDeckEqMid: (id: number, value: number) => void;
  setDeckEqHigh: (id: number, value: number) => void;
  setDeckEqMode: DeckStackProps["onEqModeChange"];
  setDeckParametricEqBands: DeckStackProps["onParametricEqBandsChange"];
  setDeckParametricEqMotion: DeckStackProps["onParametricEqMotionChange"];
  setDeckDelayTime: (id: number, value: number) => void;
  setDeckDelayFeedback: (id: number, value: number) => void;
  setDeckDelayMix: (id: number, value: number) => void;
  setDeckDelayTone: (id: number, value: number) => void;
  setDeckDelayPingPong: (id: number, value: boolean) => void;
  setDeckDelaySaturation: (id: number, value: number) => void;
  setDeckDelayDamping: (id: number, value: number) => void;
  setDeckDelaySafety: (id: number, value: number) => void;
  setDeckDelaySliceSync: (id: number, value: boolean) => void;
  setDeckVocoderMix: (id: number, value: number) => void;
  setDeckVocoderCarrierDeckId: (id: number, value: number | null) => void;
  setDeckVocoderModulatorMonitor: (id: number, value: number) => void;
  setDeckVocoderModDrive: (id: number, value: number) => void;
  setDeckVocoderBandCount: (id: number, value: number) => void;
  setDeckVocoderAttackMs: (id: number, value: number) => void;
  setDeckVocoderReleaseMs: (id: number, value: number) => void;
  setDeckVocoderNoiseMix: (id: number, value: number) => void;
  setDeckVocoderGateThreshold: (id: number, value: number) => void;
  setDeckBalance: (id: number, value: number) => void;
  setDeckPitchShift: (id: number, value: number) => void;
  seekDeck: (id: number, progress: number) => void;
  setDeckZoom: (id: number, value: number) => void;
  setDeckLoop: (id: number, value: boolean) => void;
  setDeckLoopBounds: (id: number, startSeconds: number, endSeconds: number) => void;
  commitDeckLoopBoundsHistory: (id: number) => void;
  setDeckTempoOffset: DeckStackProps["onTempoOffsetChange"];
  setDeckTempoPitchSync: (id: number, value: boolean) => void;
  setDeckWidthOverride: (id: number, value?: "full" | "half") => void;
  setDeckStretchRatio: (id: number, value: number) => void;
  setDeckStretchWindowSize: (id: number, value: number) => void;
  setDeckStretchStereoWidth: (id: number, value: number) => void;
  setDeckStretchPhaseRandomness: (id: number, value: number) => void;
  setDeckStretchTiltDb: (id: number, value: number) => void;
  setDeckStretchScatter: (id: number, value: number) => void;
  setDeckRearrangerSlices: (id: number, value: number) => void;
  setDeckRearrangerSwapCount: (id: number, value: number) => void;
  setDeckRearrangerChaos: (id: number, value: number) => void;
  setDeckRearrangerReverse: (id: number, value: number) => void;
  setDeckRearrangerSensitivity: (id: number, value: number) => void;
  setDeckRearrangerQuietThreshold: (id: number, value: number) => void;
  setDeckRearrangerSliceFadeMs: (id: number, value: number) => void;
  setDeckRearrangerSliceDelaySec: (id: number, value: number) => void;
  setDeckRearrangerPingPong: (id: number, value: number) => void;
  setDeckRearrangerAuto: (id: number, value: boolean) => void;
  setDeckRearrangerRegions: (id: number, regions?: number[]) => void;
  handleDeleteRearrangerSlice: (id: number, sliceIndex: number) => void;
  handleAutoSliceRearranger: (id: number) => void;
  handleTrimQuietRearranger: (id: number) => void;
  handleRearrangeLoop: (id: number) => void;
  setDeckFxPanelOpen: DeckStackProps["onFxPanelToggle"];
  setDeckFxPanelsOpen: DeckStackProps["onFxPanelsToggleAll"];
  resetDeckFx: (id: number) => void;
  handleStretchLoop: (id: number) => Promise<void>;
  stretchEstimateByDeckId: Record<number, string>;
  automationState: Map<number, Record<AutomationParam, AutomationView>>;
  startAutomationRecording: (id: number, param: AutomationParam) => void;
  stopAutomationRecording: (id: number, param: AutomationParam) => void;
  updateAutomationValue: (id: number, param: AutomationParam, value: number) => void;
  getAutomationPlayhead: (id: number, param: AutomationParam) => number;
  toggleAutomationActive: (id: number, param: AutomationParam, active: boolean) => void;
  resetAutomationTrack: (id: number, param: AutomationParam) => void;
  applyAutomationPreset: (id: number, param: AutomationParam, preset: "sine" | "triangle" | "ramp", min: number, max: number) => void;
  adjustAutomationLength: (id: number, param: AutomationParam, factor: number) => void;
  adjustAutomationAmplitude: (id: number, param: AutomationParam, factor: number, min: number, max: number) => void;
  invertAutomation: (id: number, param: AutomationParam, min: number, max: number) => void;
  setAutomationDuration: (id: number, param: AutomationParam, durationSec: number) => void;
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
  handleSaveLoopClip: (id: number, includeSettings: boolean) => void;
  handleCropLoop: (id: number) => void;
  handleDuplicateLoop: (id: number, includeSettings: boolean) => void;
};

const useDeckStackProps = ({
  decks,
  deckLayoutMode,
  zipDragOver,
  activeDeckId,
  scrollToDeckId,
  setScrollToDeckId,
  handleDeckActivate,
  removeDeck,
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
  setDeckDelayTime,
  setDeckDelayFeedback,
  setDeckDelayMix,
  setDeckDelayTone,
  setDeckDelayPingPong,
  setDeckDelaySaturation,
  setDeckDelayDamping,
  setDeckDelaySafety,
  setDeckDelaySliceSync,
  setDeckVocoderMix,
  setDeckVocoderCarrierDeckId,
  setDeckVocoderModulatorMonitor,
  setDeckVocoderModDrive,
  setDeckVocoderBandCount,
  setDeckVocoderAttackMs,
  setDeckVocoderReleaseMs,
  setDeckVocoderNoiseMix,
  setDeckVocoderGateThreshold,
  setDeckBalance,
  setDeckPitchShift,
  seekDeck,
  setDeckZoom,
  setDeckLoop,
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
}: UseDeckStackPropsArgs): DeckStackProps => {
  const handleScrollComplete = useCallback(
    (id: number) => {
      if (scrollToDeckId === id) {
        setScrollToDeckId(null);
      }
    },
    [scrollToDeckId, setScrollToDeckId]
  );

  const handleDisableDeckVocoder = useCallback(
    (id: number) => {
      setDeckVocoderMix(id, 0);
      setDeckVocoderCarrierDeckId(id, null);
      setDeckVocoderModulatorMonitor(id, 0);
      setDeckVocoderModDrive(id, 2);
    },
    [
      setDeckVocoderCarrierDeckId,
      setDeckVocoderMix,
      setDeckVocoderModDrive,
      setDeckVocoderModulatorMonitor,
    ]
  );

  const handleDisableDeckVocoders = useCallback(
    (ids: number[]) => {
      ids.forEach((id) => {
        setDeckVocoderMix(id, 0);
        setDeckVocoderCarrierDeckId(id, null);
        setDeckVocoderModulatorMonitor(id, 0);
        setDeckVocoderModDrive(id, 2);
      });
    },
    [
      setDeckVocoderCarrierDeckId,
      setDeckVocoderMix,
      setDeckVocoderModDrive,
      setDeckVocoderModulatorMonitor,
    ]
  );

  return {
    decks,
    layoutMode: deckLayoutMode,
    zipDragActive: zipDragOver,
    activeDeckId,
    scrollToDeckId,
    onScrollComplete: handleScrollComplete,
    onDeckActivate: handleDeckActivate,
    onRemoveDeck: removeDeck,
    onLoadClick: handleLoadClick,
    onFileSelected: handleFileSelected,
    onPlay: playDeck,
    onPause: pauseDeck,
    onStop: stopDeck,
    onGainChange: setDeckGain,
    onFilterChange: setDeckFilter,
    onResonanceChange: setDeckResonance,
    onEqLowChange: setDeckEqLow,
    onEqMidChange: setDeckEqMid,
    onEqHighChange: setDeckEqHigh,
    onEqModeChange: setDeckEqMode,
    onParametricEqBandsChange: setDeckParametricEqBands,
    onParametricEqMotionChange: setDeckParametricEqMotion,
    onDelayTimeChange: setDeckDelayTime,
    onDelayFeedbackChange: setDeckDelayFeedback,
    onDelayMixChange: setDeckDelayMix,
    onDelayToneChange: setDeckDelayTone,
    onDelayPingPongChange: setDeckDelayPingPong,
    onDelaySaturationChange: setDeckDelaySaturation,
    onDelayDampingChange: setDeckDelayDamping,
    onDelaySafetyChange: setDeckDelaySafety,
    onDelaySliceSyncChange: setDeckDelaySliceSync,
    onVocoderMixChange: setDeckVocoderMix,
    onVocoderCarrierDeckIdChange: setDeckVocoderCarrierDeckId,
    onVocoderModulatorMonitorChange: setDeckVocoderModulatorMonitor,
    onVocoderModDriveChange: setDeckVocoderModDrive,
    onVocoderBandCountChange: setDeckVocoderBandCount,
    onVocoderAttackMsChange: setDeckVocoderAttackMs,
    onVocoderReleaseMsChange: setDeckVocoderReleaseMs,
    onVocoderPhaseRotateChange: setDeckVocoderNoiseMix,
    onVocoderGateThresholdChange: setDeckVocoderGateThreshold,
    onDisableDeckVocoder: handleDisableDeckVocoder,
    onDisableDeckVocoders: handleDisableDeckVocoders,
    onBalanceChange: setDeckBalance,
    onPitchShiftChange: setDeckPitchShift,
    onSeek: seekDeck,
    onZoomChange: setDeckZoom,
    onLoopChange: setDeckLoop,
    onLoopBoundsChange: setDeckLoopBounds,
    onLoopBoundsChangeComplete: commitDeckLoopBoundsHistory,
    onTempoOffsetChange: setDeckTempoOffset,
    onTempoPitchSyncChange: setDeckTempoPitchSync,
    onDeckWidthOverrideChange: setDeckWidthOverride,
    onStretchRatioChange: setDeckStretchRatio,
    onStretchWindowSizeChange: setDeckStretchWindowSize,
    onStretchStereoWidthChange: setDeckStretchStereoWidth,
    onStretchPhaseRandomnessChange: setDeckStretchPhaseRandomness,
    onStretchTiltDbChange: setDeckStretchTiltDb,
    onStretchScatterChange: setDeckStretchScatter,
    onRearrangerSlicesChange: setDeckRearrangerSlices,
    onRearrangerSwapCountChange: setDeckRearrangerSwapCount,
    onRearrangerChaosChange: setDeckRearrangerChaos,
    onRearrangerReverseChange: setDeckRearrangerReverse,
    onRearrangerSensitivityChange: setDeckRearrangerSensitivity,
    onRearrangerQuietThresholdChange: setDeckRearrangerQuietThreshold,
    onRearrangerSliceFadeChange: setDeckRearrangerSliceFadeMs,
    onRearrangerSliceDelayChange: setDeckRearrangerSliceDelaySec,
    onRearrangerPingPongChange: setDeckRearrangerPingPong,
    onRearrangerAutoChange: setDeckRearrangerAuto,
    onRearrangerRegionsChange: setDeckRearrangerRegions,
    onRearrangerSliceDelete: handleDeleteRearrangerSlice,
    onRearrangerAutoSlice: handleAutoSliceRearranger,
    onRearrangerTrimQuiet: handleTrimQuietRearranger,
    onRearrangeLoop: handleRearrangeLoop,
    onFxPanelToggle: setDeckFxPanelOpen,
    onFxPanelsToggleAll: setDeckFxPanelsOpen,
    onFxResetAll: resetDeckFx,
    onStretchLoop: handleStretchLoop,
    stretchEstimateByDeckId,
    automationState,
    onAutomationStart: startAutomationRecording,
    onAutomationStop: stopAutomationRecording,
    onAutomationValueChange: updateAutomationValue,
    getAutomationPlayhead,
    onAutomationToggle: toggleAutomationActive,
    onAutomationReset: resetAutomationTrack,
    onAutomationPreset: applyAutomationPreset,
    onAutomationLengthScale: adjustAutomationLength,
    onAutomationAmplitudeScale: adjustAutomationAmplitude,
    onAutomationInvert: invertAutomation,
    onAutomationDurationChange: setAutomationDuration,
    getDeckPosition,
    getDeckPlaybackSnapshot,
    setFileInputRef,
    onSaveLoopClip: handleSaveLoopClip,
    onCropLoop: handleCropLoop,
    onDuplicateLoop: handleDuplicateLoop,
  };
};

export default useDeckStackProps;
