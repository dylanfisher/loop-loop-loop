import type { DeckState } from "../types/deck";
import Waveform from "./Waveform";

type DeckCardProps = {
  deck: DeckState;
  label: string;
  onRemove: (id: number) => void;
  onLoadClick: (id: number) => void;
  onFileSelected: (id: number, file: File | null) => void;
  onPlay: (deck: DeckState) => void;
  onPause: (deck: DeckState) => void;
  onGainChange: (id: number, value: number) => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onFollowChange: (id: number, value: boolean) => void;
  setFileInputRef: (id: number, node: HTMLInputElement | null) => void;
};

const DeckCard = ({
  deck,
  label,
  onRemove,
  onLoadClick,
  onFileSelected,
  onPlay,
  onPause,
  onGainChange,
  onSeek,
  onZoomChange,
  onFollowChange,
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
      <Waveform
        buffer={deck.buffer}
        isPlaying={deck.status === "playing"}
        startedAtMs={deck.startedAtMs}
        duration={deck.duration}
        offsetSeconds={deck.offsetSeconds}
        zoom={deck.zoom}
        follow={deck.follow}
        onSeek={(progress) => onSeek(deck.id, progress)}
      />
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
          <button type="button" onClick={() => onPause(deck)}>
            Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={!deck.buffer || deck.status === "loading"}
            onClick={() => onPlay(deck)}
          >
            {deck.status === "paused" ? "Resume" : "Play"}
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
      <label className="deck__zoom">
        <span>Zoom</span>
        <input
          type="range"
          min="1"
          max="64"
          step="1"
          value={deck.zoom}
          onChange={(event) => onZoomChange(deck.id, Number(event.target.value))}
        />
      </label>
      <label className="deck__follow">
        <span>Follow</span>
        <input
          type="checkbox"
          checked={deck.follow}
          onChange={(event) => onFollowChange(deck.id, event.target.checked)}
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
