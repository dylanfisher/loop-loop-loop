import DeckCard from "./DeckCard";
import { useCallback, useEffect, useRef } from "react";
import type { DeckFxPanel, DeckState } from "../types/deck";
import type { AutomationParam } from "../types/session";

type DeckStackProps = {
  decks: DeckState[];
  layoutMode: "single" | "two";
  zipDragActive?: boolean;
  activeDeckId: number | null;
  scrollToDeckId?: number | null;
  onScrollComplete?: (id: number) => void;
  onDeckActivate: (id: number) => void;
  onRemoveDeck: (id: number) => void;
  onLoadClick: (id: number) => void;
  onFileSelected: (id: number, file: File | null, options?: {
    gain?: number;
    pitchShift?: number;
    balance?: number;
    tempoOffset?: number;
  }) => void;
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
  onBalanceChange: (id: number, value: number) => void;
  onPitchShiftChange: (id: number, value: number) => void;
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
  onRearrangerSwapCountChange: (id: number, value: number) => void;
  onRearrangerChaosChange: (id: number, value: number) => void;
  onRearrangerReverseChange: (id: number, value: number) => void;
  onRearrangerSensitivityChange: (id: number, value: number) => void;
  onRearrangerQuietThresholdChange: (id: number, value: number) => void;
  onRearrangerSliceFadeChange: (id: number, value: number) => void;
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
  stretchEstimateByDeckId: Record<number, string>;
  onSaveLoopClip: (id: number, includeSettings: boolean) => void;
  onCropLoop: (id: number) => void;
  onDuplicateLoop: (id: number, includeSettings: boolean) => void;
  automationState: Map<number, Record<AutomationParam, {
    samples: Float32Array;
    previewSamples: Float32Array;
    durationSec: number;
    recording: boolean;
    active: boolean;
    currentValue: number;
    amplitudeScale: number;
  }>>;
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
  onAutomationPreset: (id: number, param: AutomationParam, preset: "sine" | "triangle" | "ramp", min: number, max: number) => void;
  onAutomationLengthScale: (id: number, param: AutomationParam, factor: number) => void;
  onAutomationAmplitudeScale: (id: number, param: AutomationParam, factor: number, min: number, max: number) => void;
  onAutomationInvert: (id: number, param: AutomationParam, min: number, max: number) => void;
  onAutomationDurationChange: (id: number, param: AutomationParam, durationSec: number) => void;
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

const DeckStack = ({
  decks,
  layoutMode,
  zipDragActive = false,
  activeDeckId,
  scrollToDeckId,
  onScrollComplete,
  onDeckActivate,
  onRemoveDeck,
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
  onBalanceChange,
  onPitchShiftChange,
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
  onRearrangerSwapCountChange,
  onRearrangerChaosChange,
  onRearrangerReverseChange,
  onRearrangerSensitivityChange,
  onRearrangerQuietThresholdChange,
  onRearrangerSliceFadeChange,
  onRearrangerPingPongChange,
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
  stretchEstimateByDeckId,
  onSaveLoopClip,
  onCropLoop,
  onDuplicateLoop,
  automationState,
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
  getDeckPosition,
  getDeckPlaybackSnapshot,
  setFileInputRef,
}: DeckStackProps) => {
  const layoutClass =
    layoutMode === "two"
      ? "deck-stack__list--two-column"
      : "deck-stack__list--single-column";
  const deckRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const setDeckRef = useCallback((id: number, node: HTMLDivElement | null) => {
    deckRefs.current.set(id, node);
  }, []);

  useEffect(() => {
    if (scrollToDeckId == null) return;
    let cancelled = false;
    let attempts = 0;

    const scrollToDeck = () => {
      if (cancelled) return;
      const node = deckRefs.current.get(scrollToDeckId);
      if (!node) {
        attempts += 1;
        if (attempts < 10) {
          requestAnimationFrame(scrollToDeck);
        }
        return;
      }
      const header = document.querySelector<HTMLElement>(".app__header");
      const headerOffset = header?.offsetHeight ?? 0;
      const rect = node.getBoundingClientRect();
      const targetTop = rect.top + window.scrollY - headerOffset - 16;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
      onScrollComplete?.(scrollToDeckId);
    };

    scrollToDeck();
    return () => {
      cancelled = true;
    };
  }, [onScrollComplete, scrollToDeckId]);
  return (
    <section className="deck-stack">
      <div
        className={`deck-stack__list ${layoutClass} ${decks.length === 1 ? "deck-stack__list--single" : ""}`.trim()}
      >
        {decks.map((deck, index) => (
          <div
            key={deck.id}
            ref={(node) => setDeckRef(deck.id, node)}
            className={`deck-stack__item ${deck.deckWidthOverride ? `deck-stack__item--width-${deck.deckWidthOverride}` : ""}`.trim()}
          >
            <DeckCard
              deck={deck}
              label={`Deck ${index + 1}`}
              isActive={activeDeckId === deck.id}
              zipDragActive={zipDragActive}
              onActivate={onDeckActivate}
              onRemove={onRemoveDeck}
              onLoadClick={onLoadClick}
              onFileSelected={onFileSelected}
              onPlay={onPlay}
              onPause={onPause}
              onStop={onStop}
              onGainChange={onGainChange}
              onFilterChange={onFilterChange}
              onResonanceChange={onResonanceChange}
              onEqLowChange={onEqLowChange}
              onEqMidChange={onEqMidChange}
              onEqHighChange={onEqHighChange}
              onDelayTimeChange={onDelayTimeChange}
              onDelayFeedbackChange={onDelayFeedbackChange}
              onDelayMixChange={onDelayMixChange}
              onDelayToneChange={onDelayToneChange}
              onDelayPingPongChange={onDelayPingPongChange}
              onDelaySliceSyncChange={onDelaySliceSyncChange}
              onBalanceChange={onBalanceChange}
              onPitchShiftChange={onPitchShiftChange}
              onSeek={onSeek}
              onZoomChange={onZoomChange}
              onLoopChange={onLoopChange}
              onLoopBoundsChange={onLoopBoundsChange}
              onLoopBoundsChangeComplete={onLoopBoundsChangeComplete}
              onTempoOffsetChange={onTempoOffsetChange}
              onTempoPitchSyncChange={onTempoPitchSyncChange}
              onDeckWidthOverrideChange={onDeckWidthOverrideChange}
              onStretchRatioChange={onStretchRatioChange}
              onStretchWindowSizeChange={onStretchWindowSizeChange}
              onStretchStereoWidthChange={onStretchStereoWidthChange}
              onStretchPhaseRandomnessChange={onStretchPhaseRandomnessChange}
              onStretchTiltDbChange={onStretchTiltDbChange}
              onStretchScatterChange={onStretchScatterChange}
              onRearrangerSlicesChange={onRearrangerSlicesChange}
            onRearrangerSwapCountChange={onRearrangerSwapCountChange}
              onRearrangerChaosChange={onRearrangerChaosChange}
              onRearrangerReverseChange={onRearrangerReverseChange}
              onRearrangerSensitivityChange={onRearrangerSensitivityChange}
              onRearrangerQuietThresholdChange={onRearrangerQuietThresholdChange}
              onRearrangerSliceFadeChange={onRearrangerSliceFadeChange}
              onRearrangerPingPongChange={onRearrangerPingPongChange}
              onRearrangerAutoChange={onRearrangerAutoChange}
              onRearrangerRegionsChange={onRearrangerRegionsChange}
              onRearrangerSliceDelete={onRearrangerSliceDelete}
              onRearrangerAutoSlice={onRearrangerAutoSlice}
              onRearrangerTrimQuiet={onRearrangerTrimQuiet}
              onRearrangeLoop={onRearrangeLoop}
              onFxPanelToggle={onFxPanelToggle}
              onFxPanelsToggleAll={onFxPanelsToggleAll}
              onFxResetAll={onFxResetAll}
              onStretchLoop={onStretchLoop}
              stretchEstimate={stretchEstimateByDeckId[deck.id] ?? null}
              onSaveLoopClip={onSaveLoopClip}
              onCropLoop={onCropLoop}
              onDuplicateLoop={onDuplicateLoop}
              automation={automationState.get(deck.id)}
              onAutomationStart={onAutomationStart}
              onAutomationStop={onAutomationStop}
              onAutomationValueChange={onAutomationValueChange}
              getAutomationPlayhead={getAutomationPlayhead}
              onAutomationToggle={onAutomationToggle}
              onAutomationReset={onAutomationReset}
              onAutomationPreset={onAutomationPreset}
              onAutomationLengthScale={onAutomationLengthScale}
              onAutomationAmplitudeScale={onAutomationAmplitudeScale}
              onAutomationInvert={onAutomationInvert}
              onAutomationDurationChange={onAutomationDurationChange}
              getDeckPosition={getDeckPosition}
              getDeckPlaybackSnapshot={getDeckPlaybackSnapshot}
              setFileInputRef={setFileInputRef}
            />
          </div>
        ))}
      </div>
    </section>
  );
};

export default DeckStack;
