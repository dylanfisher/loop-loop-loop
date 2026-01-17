import type { DeckState } from "../types/deck";

type DeckCardProps = {
  deck: DeckState;
  label: string;
  onRemove: (id: number) => void;
  onLoadClick: (id: number) => void;
  onFileSelected: (id: number, file: File | null) => void;
  onPlay: (deck: DeckState) => void;
  onStop: (deck: DeckState) => void;
  onGainChange: (id: number, value: number) => void;
  setFileInputRef: (id: number, node: HTMLInputElement | null) => void;
};

const DeckCard = ({
  deck,
  label,
  onRemove,
  onLoadClick,
  onFileSelected,
  onPlay,
  onStop,
  onGainChange,
  setFileInputRef,
}: DeckCardProps) => {
  return (
    <div className="deck">
      <div className="deck__header">
        <span className="deck__label">{label}</span>
        <div className="deck__meta">
          <span className={`deck__status deck__status--${deck.status}`}>
            {deck.status}
          </span>
          <button
            type="button"
            className="deck__remove"
            onClick={() => onRemove(deck.id)}
          >
            Remove
          </button>
        </div>
      </div>
      <div className="deck__waveform">Waveform / Spectrum</div>
      <div className="deck__controls">
        <input
          ref={(node) => setFileInputRef(deck.id, node)}
          className="deck__file-input"
          type="file"
          accept="audio/*"
          onChange={(event) => onFileSelected(deck.id, event.target.files?.[0] ?? null)}
        />
        <button type="button" onClick={() => onLoadClick(deck.id)}>
          {deck.fileName ? "Replace" : "Load"}
        </button>
        {deck.status === "playing" ? (
          <button type="button" onClick={() => onStop(deck)}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!deck.buffer || deck.status === "loading"}
            onClick={() => onPlay(deck)}
          >
            Play
          </button>
        )}
        <button type="button">Loop</button>
        <button type="button">Slice</button>
      </div>
      <label className="deck__gain">
        <span>Gain</span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={deck.gain}
          onChange={(event) => onGainChange(deck.id, Number(event.target.value))}
        />
      </label>
      <div className="deck__file-name">{deck.fileName ?? "No file loaded"}</div>
      <div className="deck__fx">
        <div className="deck__fx-title">Deck FX</div>
        <div className="deck__fx-row">
          <span>Filter</span>
          <span>Delay</span>
          <span>Granular</span>
          <span>Freeze</span>
        </div>
      </div>
    </div>
  );
};

export default DeckCard;
