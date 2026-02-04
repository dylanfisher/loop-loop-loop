import DeckCard from "./DeckCard";
import type { DeckFxPanel, DeckState } from "../types/deck";

type DeckStackProps = {
  decks: DeckState[];
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
  onFractalMixChange: (id: number, value: number) => void;
  onFractalStructureChange: (id: number, value: number) => void;
  onFractalDepthChange: (id: number, value: number) => void;
  onFractalDriftChange: (id: number, value: number) => void;
  onFractalDecayChange: (id: number, value: number) => void;
  onFractalToneChange: (id: number, value: number) => void;
  onBalanceChange: (id: number, value: number) => void;
  onPitchShiftChange: (id: number, value: number) => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onTempoOffsetChange: (
    id: number,
    value: number,
    options?: { disableSnap?: boolean }
  ) => void;
  onTempoPitchSyncChange: (id: number, value: boolean) => void;
  onStretchRatioChange: (id: number, value: number) => void;
  onStretchWindowSizeChange: (id: number, value: number) => void;
  onStretchStereoWidthChange: (id: number, value: number) => void;
  onStretchPhaseRandomnessChange: (id: number, value: number) => void;
  onStretchTiltDbChange: (id: number, value: number) => void;
  onStretchScatterChange: (id: number, value: number) => void;
  onFxPanelToggle: (id: number, panel: DeckFxPanel, open: boolean) => void;
  onFxPanelsToggleAll: (id: number, open: boolean) => void;
  onStretchLoop: (id: number) => void;
  stretchEstimateByDeckId: Record<number, string>;
  onSaveLoopClip: (id: number, includeSettings: boolean) => void;
  automationState: Map<number, Record<"djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch", {
    samples: Float32Array;
    previewSamples: Float32Array;
    durationSec: number;
    recording: boolean;
    active: boolean;
    currentValue: number;
    amplitudeScale: number;
  }>>;
  onAutomationStart: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch") => void;
  onAutomationStop: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch") => void;
  onAutomationValueChange: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    value: number
  ) => void;
  getAutomationPlayhead: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch") => number;
  onAutomationToggle: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    active: boolean
  ) => void;
  onAutomationReset: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch") => void;
  onAutomationPreset: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch", preset: "sine" | "triangle" | "ramp", min: number, max: number) => void;
  onAutomationLengthScale: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch", factor: number) => void;
  onAutomationAmplitudeScale: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch", factor: number, min: number, max: number) => void;
  onAutomationDurationChange: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch", durationSec: number) => void;
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
  onRemoveDeck,
  onLoadClick,
  onFileSelected,
  onPlay,
  onPause,
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
  onFractalMixChange,
  onFractalStructureChange,
  onFractalDepthChange,
  onFractalDriftChange,
  onFractalDecayChange,
  onFractalToneChange,
  onBalanceChange,
  onPitchShiftChange,
  onSeek,
  onZoomChange,
  onLoopChange,
  onLoopBoundsChange,
  onTempoOffsetChange,
  onTempoPitchSyncChange,
  onStretchRatioChange,
  onStretchWindowSizeChange,
  onStretchStereoWidthChange,
  onStretchPhaseRandomnessChange,
  onStretchTiltDbChange,
  onStretchScatterChange,
  onFxPanelToggle,
  onFxPanelsToggleAll,
  onStretchLoop,
  stretchEstimateByDeckId,
  onSaveLoopClip,
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
  onAutomationDurationChange,
  getDeckPosition,
  getDeckPlaybackSnapshot,
  setFileInputRef,
}: DeckStackProps) => {
  return (
    <section className="deck-stack">
      <div className={`deck-stack__list ${decks.length === 1 ? "deck-stack__list--single" : ""}`.trim()}>
        {decks.map((deck, index) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            label={`Deck ${index + 1}`}
            onRemove={onRemoveDeck}
            onLoadClick={onLoadClick}
            onFileSelected={onFileSelected}
            onPlay={onPlay}
            onPause={onPause}
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
            onFractalMixChange={onFractalMixChange}
            onFractalStructureChange={onFractalStructureChange}
            onFractalDepthChange={onFractalDepthChange}
            onFractalDriftChange={onFractalDriftChange}
            onFractalDecayChange={onFractalDecayChange}
            onFractalToneChange={onFractalToneChange}
            onBalanceChange={onBalanceChange}
            onPitchShiftChange={onPitchShiftChange}
            onSeek={onSeek}
            onZoomChange={onZoomChange}
            onLoopChange={onLoopChange}
            onLoopBoundsChange={onLoopBoundsChange}
            onTempoOffsetChange={onTempoOffsetChange}
            onTempoPitchSyncChange={onTempoPitchSyncChange}
            onStretchRatioChange={onStretchRatioChange}
            onStretchWindowSizeChange={onStretchWindowSizeChange}
            onStretchStereoWidthChange={onStretchStereoWidthChange}
            onStretchPhaseRandomnessChange={onStretchPhaseRandomnessChange}
            onStretchTiltDbChange={onStretchTiltDbChange}
            onStretchScatterChange={onStretchScatterChange}
            onFxPanelToggle={onFxPanelToggle}
            onFxPanelsToggleAll={onFxPanelsToggleAll}
            onStretchLoop={onStretchLoop}
            stretchEstimate={stretchEstimateByDeckId[deck.id] ?? null}
            onSaveLoopClip={onSaveLoopClip}
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
            onAutomationDurationChange={onAutomationDurationChange}
            getDeckPosition={getDeckPosition}
            getDeckPlaybackSnapshot={getDeckPlaybackSnapshot}
            setFileInputRef={setFileInputRef}
          />
        ))}
      </div>
    </section>
  );
};

export default DeckStack;
