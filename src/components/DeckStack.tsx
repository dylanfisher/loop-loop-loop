import DeckCard from "./DeckCard";
import type { DeckState } from "../types/deck";

type DeckStackProps = {
  decks: DeckState[];
  onAddDeck: () => void;
  onRemoveDeck: (id: number) => void;
  onLoadClick: (id: number) => void;
  onFileSelected: (id: number, file: File | null) => void;
  onPlay: (deck: DeckState) => void;
  onStop: (deck: DeckState) => void;
  onGainChange: (id: number, value: number) => void;
  setFileInputRef: (id: number, node: HTMLInputElement | null) => void;
};

const DeckStack = ({
  decks,
  onAddDeck,
  onRemoveDeck,
  onLoadClick,
  onFileSelected,
  onPlay,
  onStop,
  onGainChange,
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
            onStop={onStop}
            onGainChange={onGainChange}
            setFileInputRef={setFileInputRef}
          />
        ))}
      </div>
    </section>
  );
};

export default DeckStack;
