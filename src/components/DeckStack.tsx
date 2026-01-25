import DeckCard from "./DeckCard";
import type { DeckState } from "../types/deck";

type DeckStackProps = {
  decks: DeckState[];
  onAddDeck: () => void;
  onRemoveDeck: (id: number) => void;
  onLoadClick: (id: number) => void;
  onFileSelected: (id: number, file: File | null) => void;
  onPlay: (deck: DeckState) => void;
  onPause: (deck: DeckState) => void;
  onGainChange: (id: number, value: number) => void;
  onFilterChange: (id: number, value: number) => void;
  onResonanceChange: (id: number, value: number) => void;
  onEqLowChange: (id: number, value: number) => void;
  onEqMidChange: (id: number, value: number) => void;
  onEqHighChange: (id: number, value: number) => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onBpmOverrideChange: (id: number, value: number | null) => void;
  automationState: Map<number, Record<"djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh", {
    samples: Float32Array;
    previewSamples: Float32Array;
    durationSec: number;
    recording: boolean;
    active: boolean;
    currentValue: number;
  }>>;
  onAutomationStart: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh") => void;
  onAutomationStop: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh") => void;
  onAutomationValueChange: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh",
    value: number
  ) => void;
  getAutomationPlayhead: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh") => number;
  onAutomationToggle: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh",
    active: boolean
  ) => void;
  onAutomationReset: (id: number, param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh") => void;
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
  onSeek,
  onZoomChange,
  onLoopChange,
  onLoopBoundsChange,
  onBpmOverrideChange,
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
      <div className="deck-stack__list">
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
            onSeek={onSeek}
            onZoomChange={onZoomChange}
            onLoopChange={onLoopChange}
            onLoopBoundsChange={onLoopBoundsChange}
            onBpmOverrideChange={onBpmOverrideChange}
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
