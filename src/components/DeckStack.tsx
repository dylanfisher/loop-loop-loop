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
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onFollowChange: (id: number, value: boolean) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onBpmOverrideChange: (id: number, value: number | null) => void;
  onTapTempo: (id: number) => void;
  automationState: Map<number, Record<"djFilter" | "resonance", {
    samples: Float32Array;
    previewSamples: Float32Array;
    durationSec: number;
    recording: boolean;
    active: boolean;
    currentValue: number;
  }>>;
  onAutomationStart: (id: number, param: "djFilter" | "resonance") => void;
  onAutomationStop: (id: number, param: "djFilter" | "resonance") => void;
  onAutomationValueChange: (id: number, param: "djFilter" | "resonance", value: number) => void;
  getAutomationPlayhead: (id: number, param: "djFilter" | "resonance") => number;
  onAutomationToggle: (id: number, param: "djFilter" | "resonance", active: boolean) => void;
  onAutomationReset: (id: number, param: "djFilter" | "resonance") => void;
  getDeckPosition: (id: number) => number | null;
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
  onSeek,
  onZoomChange,
  onFollowChange,
  onLoopChange,
  onLoopBoundsChange,
  onBpmOverrideChange,
  onTapTempo,
  automationState,
  onAutomationStart,
  onAutomationStop,
  onAutomationValueChange,
  getAutomationPlayhead,
  onAutomationToggle,
  onAutomationReset,
  getDeckPosition,
  setFileInputRef,
}: DeckStackProps) => {
  return (
    <section className="panel deck-stack">
      <div className="panel__title">
        <span>Decks</span>
        <div className="panel__actions">
          <button type="button" onClick={onAddDeck}>
            Add Deck
          </button>
        </div>
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
            onSeek={onSeek}
            onZoomChange={onZoomChange}
            onFollowChange={onFollowChange}
            onLoopChange={onLoopChange}
            onLoopBoundsChange={onLoopBoundsChange}
            onBpmOverrideChange={onBpmOverrideChange}
            onTapTempo={onTapTempo}
            automation={automationState.get(deck.id)}
            onAutomationStart={onAutomationStart}
            onAutomationStop={onAutomationStop}
            onAutomationValueChange={onAutomationValueChange}
            getAutomationPlayhead={getAutomationPlayhead}
            onAutomationToggle={onAutomationToggle}
            onAutomationReset={onAutomationReset}
            getDeckPosition={getDeckPosition}
            setFileInputRef={setFileInputRef}
          />
        ))}
      </div>
    </section>
  );
};

export default DeckStack;
