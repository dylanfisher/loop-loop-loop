import { useCallback } from "react";
import type { DeckState } from "../types/deck";
import AutomationLane from "./AutomationLane";
import Knob from "./Knob";
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
  onFilterChange: (id: number, value: number) => void;
  onResonanceChange: (id: number, value: number) => void;
  automation?: Record<
    "djFilter" | "resonance",
    {
      samples: Float32Array;
      previewSamples: Float32Array;
      durationSec: number;
      recording: boolean;
      active: boolean;
      currentValue: number;
    }
  >;
  onAutomationStart: (id: number, param: "djFilter" | "resonance") => void;
  onAutomationStop: (id: number, param: "djFilter" | "resonance") => void;
  onAutomationValueChange: (
    id: number,
    param: "djFilter" | "resonance",
    value: number
  ) => void;
  getAutomationPlayhead: (id: number, param: "djFilter" | "resonance") => number;
  onAutomationToggle: (id: number, param: "djFilter" | "resonance", active: boolean) => void;
  onAutomationReset: (id: number, param: "djFilter" | "resonance") => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onFollowChange: (id: number, value: boolean) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onBpmOverrideChange: (id: number, value: number | null) => void;
  onTapTempo: (id: number) => void;
  getDeckPosition: (id: number) => number | null;
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
  onFilterChange,
  onResonanceChange,
  automation,
  onAutomationStart,
  onAutomationStop,
  onAutomationValueChange,
  getAutomationPlayhead,
  onAutomationToggle,
  onAutomationReset,
  onSeek,
  onZoomChange,
  onFollowChange,
  onLoopChange,
  onLoopBoundsChange,
  onBpmOverrideChange,
  onTapTempo,
  getDeckPosition,
  setFileInputRef,
}: DeckCardProps) => {
  const formatBpm = (value: number | null) =>
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "--";
  const effectiveBpm = deck.bpmOverride ?? deck.bpm;
  const sliderValue = effectiveBpm ?? 120;
  const confidenceLabel =
    deck.bpmConfidence > 0 ? `${Math.round(deck.bpmConfidence * 100)}%` : "--";
  const djFilter = Math.min(Math.max(deck.djFilter, -1), 1);
  const resonanceMin = 0.3;
  const resonanceMax = 24;
  const resonanceValue = Math.min(
    Math.max(deck.filterResonance, resonanceMin),
    resonanceMax
  );
  const formatDjFilter = (value: number) => {
    if (value > 0.05) return `HP ${value.toFixed(2)}`;
    if (value < -0.05) return `LP ${Math.abs(value).toFixed(2)}`;
    return "Flat";
  };
  const djAutomation = automation?.djFilter ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: djFilter,
  };
  const resonanceAutomation = automation?.resonance ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: resonanceValue,
  };
  const djFilterValue = djAutomation.active ? djAutomation.currentValue : djFilter;
  const resonanceDisplayValue = resonanceAutomation.active
    ? resonanceAutomation.currentValue
    : resonanceValue;

  const getCurrentSeconds = useCallback(() => getDeckPosition(deck.id), [deck.id, getDeckPosition]);

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
        loopEnabled={deck.loopEnabled}
        loopStartSeconds={deck.loopStartSeconds}
        loopEndSeconds={deck.loopEndSeconds}
        onSeek={(progress) => onSeek(deck.id, progress)}
        onLoopBoundsChange={(startSeconds, endSeconds) =>
          onLoopBoundsChange(deck.id, startSeconds, endSeconds)
        }
        getCurrentSeconds={getCurrentSeconds}
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
        <button
          type="button"
          className={deck.loopEnabled ? "is-active" : undefined}
          onClick={() => onLoopChange(deck.id, !deck.loopEnabled)}
        >
          {deck.loopEnabled ? "Looping" : "Loop"}
        </button>
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
          max="256"
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
      <div className="deck__bpm">
        <div className="deck__bpm-header">BPM</div>
        <div className="deck__bpm-values">
          <div>
            Detected: <strong>{formatBpm(deck.bpm)}</strong>{" "}
            <span className="deck__bpm-confidence">{confidenceLabel}</span>
          </div>
          <div>
            Effective: <strong>{formatBpm(effectiveBpm)}</strong>
          </div>
        </div>
        <div className="deck__bpm-controls">
          <input
            type="number"
            min="1"
            max="999"
            step="0.1"
            placeholder="Override"
            value={deck.bpmOverride ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "") {
                onBpmOverrideChange(deck.id, null);
                return;
              }
              const parsed = Number(next);
              if (Number.isFinite(parsed)) {
                onBpmOverrideChange(deck.id, parsed);
              }
            }}
          />
          <button type="button" onClick={() => onTapTempo(deck.id)}>
            Tap
          </button>
          <button
            type="button"
            disabled={deck.bpmOverride === null}
            onClick={() => onBpmOverrideChange(deck.id, null)}
          >
            Reset
          </button>
        </div>
        <div className="deck__bpm-slider">
          <input
            type="range"
            min="1"
            max="999"
            step="0.1"
            value={sliderValue}
            onChange={(event) => onBpmOverrideChange(deck.id, Number(event.target.value))}
          />
        </div>
      </div>
      <div className="deck__file-name">{deck.fileName ?? "No file loaded"}</div>
      <div className="deck__fx">
        <div className="deck__fx-title">Deck FX</div>
        <div className="deck__fx-row">
          <div className="deck__fx-unit deck__fx-unit--filter">
            <Knob
              label="DJ Filter"
              min={-1}
              max={1}
              step={0.01}
              value={djFilterValue}
              onChange={(next) => onFilterChange(deck.id, next)}
              formatValue={formatDjFilter}
              centerSnap={0.03}
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
              getPlayhead={() => getAutomationPlayhead(deck.id, "djFilter")}
              onDrawStart={() => onAutomationStart(deck.id, "djFilter")}
              onDrawEnd={() => onAutomationStop(deck.id, "djFilter")}
              onReset={() => onAutomationReset(deck.id, "djFilter")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "djFilter", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "djFilter", value)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--filter">
            <Knob
              label="Resonance"
              min={resonanceMin}
              max={resonanceMax}
              step={0.05}
              value={resonanceDisplayValue}
              onChange={(next) => onResonanceChange(deck.id, next)}
              formatValue={(value) => value.toFixed(2)}
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
              getPlayhead={() => getAutomationPlayhead(deck.id, "resonance")}
              onDrawStart={() => onAutomationStart(deck.id, "resonance")}
              onDrawEnd={() => onAutomationStop(deck.id, "resonance")}
              onReset={() => onAutomationReset(deck.id, "resonance")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "resonance", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "resonance", value)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeckCard;
