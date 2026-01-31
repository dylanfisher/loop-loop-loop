import DeckCard from "./DeckCard";
import type { DeckState } from "../types/deck";

type DeckStackProps = {
  decks: DeckState[];
  onAddDeck: () => void;
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
  onBalanceChange: (id: number, value: number) => void;
  onPitchShiftChange: (id: number, value: number) => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onTempoOffsetChange: (id: number, value: number) => void;
  onTempoPitchSyncChange: (id: number, value: boolean) => void;
  onStretchRatioChange: (id: number, value: number) => void;
  onStretchWindowSizeChange: (id: number, value: number) => void;
  onStretchStereoWidthChange: (id: number, value: number) => void;
  onStretchPhaseRandomnessChange: (id: number, value: number) => void;
  onStretchTiltDbChange: (id: number, value: number) => void;
  onStretchScatterChange: (id: number, value: number) => void;
  onStretchLoop: (id: number) => void;
  onSaveLoopClip: (id: number) => void;
  automationState: Map<number, Record<"djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch", {
    samples: Float32Array;
    previewSamples: Float32Array;
    durationSec: number;
    recording: boolean;
    active: boolean;
    currentValue: number;
  }>>;
  onAutomationStart: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch") => void;
  onAutomationStop: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch") => void;
  onAutomationValueChange: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch",
    value: number
  ) => void;
  getAutomationPlayhead: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch") => number;
  onAutomationToggle: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch",
    active: boolean
  ) => void;
  onAutomationReset: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch") => void;
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
  onAddDeck,
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
  onStretchLoop,
  onSaveLoopClip,
  automationState,
  onAutomationStart,
  onAutomationStop,
  onAutomationValueChange,
  getAutomationPlayhead,
  onAutomationToggle,
  onAutomationReset,
  getDeckPosition,
  getDeckPlaybackSnapshot,
  setFileInputRef,
}: DeckStackProps) => {
  return (
    <section className="deck-stack">
      <div className="deck-stack__header">
        <button type="button" onClick={onAddDeck}>
          Add Deck
        </button>
      </div>
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
            onStretchLoop={onStretchLoop}
            onSaveLoopClip={onSaveLoopClip}
            automation={automationState.get(deck.id)}
            onAutomationStart={onAutomationStart}
            onAutomationStop={onAutomationStop}
            onAutomationValueChange={onAutomationValueChange}
            getAutomationPlayhead={getAutomationPlayhead}
            onAutomationToggle={onAutomationToggle}
            onAutomationReset={onAutomationReset}
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
