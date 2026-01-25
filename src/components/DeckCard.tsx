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
  onFileSelected: (id: number, file: File | null, options?: { gain?: number }) => void;
  onPlay: (deck: DeckState) => void;
  onPause: (deck: DeckState) => void;
  onGainChange: (id: number, value: number) => void;
  onFilterChange: (id: number, value: number) => void;
  onResonanceChange: (id: number, value: number) => void;
  onEqLowChange: (id: number, value: number) => void;
  onEqMidChange: (id: number, value: number) => void;
  onEqHighChange: (id: number, value: number) => void;
  onPitchShiftChange: (id: number, value: number) => void;
  automation?: Record<
    "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch",
    {
      samples: Float32Array;
      previewSamples: Float32Array;
      durationSec: number;
      recording: boolean;
      active: boolean;
      currentValue: number;
    }
  >;
  onAutomationStart: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch"
  ) => void;
  onAutomationStop: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch"
  ) => void;
  onAutomationValueChange: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch",
    value: number
  ) => void;
  getAutomationPlayhead: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch"
  ) => number;
  onAutomationToggle: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch",
    active: boolean
  ) => void;
  onAutomationReset: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "pitch"
  ) => void;
  onSeek: (id: number, progress: number) => void;
  onZoomChange: (id: number, value: number) => void;
  onLoopChange: (id: number, value: boolean) => void;
  onLoopBoundsChange: (id: number, startSeconds: number, endSeconds: number) => void;
  onTempoOffsetChange: (id: number, value: number) => void;
  onSaveLoopClip: (id: number) => void;
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
  onEqLowChange,
  onEqMidChange,
  onEqHighChange,
  onPitchShiftChange,
  automation,
  onAutomationStart,
  onAutomationStop,
  onAutomationValueChange,
  getAutomationPlayhead,
  onAutomationToggle,
  onAutomationReset,
  onSeek,
  onZoomChange,
  onLoopChange,
  onLoopBoundsChange,
  onTempoOffsetChange,
  onSaveLoopClip,
  getDeckPosition,
  getDeckPlaybackSnapshot,
  setFileInputRef,
}: DeckCardProps) => {
  const formatTempo = (value: number) => {
    if (Math.abs(value) < 0.05) return "0.0%";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  };
  const zoomSteps = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  const zoomIndex = zoomSteps.reduce((bestIndex, step, index) => {
    const bestDiff = Math.abs(zoomSteps[bestIndex] - deck.zoom);
    const nextDiff = Math.abs(step - deck.zoom);
    return nextDiff < bestDiff ? index : bestIndex;
  }, 0);
  const zoomValue = zoomSteps[zoomIndex];
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
  const formatEq = (value: number) => {
    if (value === 0) return "0.0 dB";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)} dB`;
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
  const eqLowAutomation = automation?.eqLow ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqLowGain,
  };
  const eqMidAutomation = automation?.eqMid ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqMidGain,
  };
  const eqHighAutomation = automation?.eqHigh ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqHighGain,
  };
  const pitchAutomation = automation?.pitch ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.pitchShift,
  };
  const djFilterValue = djAutomation.active ? djAutomation.currentValue : djFilter;
  const resonanceDisplayValue = resonanceAutomation.active
    ? resonanceAutomation.currentValue
    : resonanceValue;
  const eqLowValue = eqLowAutomation.active ? eqLowAutomation.currentValue : deck.eqLowGain;
  const eqMidValue = eqMidAutomation.active ? eqMidAutomation.currentValue : deck.eqMidGain;
  const eqHighValue = eqHighAutomation.active ? eqHighAutomation.currentValue : deck.eqHighGain;
  const pitchValue = pitchAutomation.active
    ? pitchAutomation.currentValue
    : deck.pitchShift;

  const getCurrentSeconds = useCallback(() => {
    const snapshot = getDeckPlaybackSnapshot(deck.id);
    if (snapshot) return snapshot.position;
    return getDeckPosition(deck.id);
  }, [deck.id, getDeckPlaybackSnapshot, getDeckPosition]);

  return (
    <div className="deck">
      <div className="deck__header">
        <div className="deck__label-row">
          <span className="deck__label">
            {label}
            <span className="deck__title">{deck.fileName ?? "No file loaded"}</span>
          </span>
          <div className="deck__actions">
            <input
              ref={(node) => setFileInputRef(deck.id, node)}
              className="deck__file-input"
              type="file"
              accept="audio/*"
              onChange={(event) => onFileSelected(deck.id, event.target.files?.[0] ?? null)}
            />
            <button type="button" className="deck__action" onClick={() => onLoadClick(deck.id)}>
              {deck.fileName ? "Replace" : "Load"}
            </button>
            {deck.status === "playing" ? (
              <button type="button" className="deck__action" onClick={() => onPause(deck)}>
                Pause
              </button>
            ) : (
              <button
                type="button"
                className="deck__action"
                disabled={!deck.buffer || deck.status === "loading"}
                onClick={() => onPlay(deck)}
              >
                {deck.status === "paused" ? "Resume" : "Play"}
              </button>
            )}
            <button
              type="button"
              className={`deck__action ${deck.loopEnabled ? "is-active" : ""}`}
              onClick={() => onLoopChange(deck.id, !deck.loopEnabled)}
            >
              {deck.loopEnabled ? "Looping" : "Loop"}
            </button>
            <button
              type="button"
              className="deck__action"
              disabled={!deck.buffer}
              onClick={() => onSaveLoopClip(deck.id)}
            >
              Save Loop
            </button>
            <button type="button" className="deck__action">
              Slice
            </button>
          </div>
        </div>
        <div className="deck__meta">
          <div className="deck__bpm-summary">
            <span>Tempo {formatTempo(deck.tempoOffset)}</span>
          </div>
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
      <div className="deck__waveform-row">
        <Waveform
          buffer={deck.buffer}
          isPlaying={deck.status === "playing"}
          startedAtMs={deck.startedAtMs}
          duration={deck.duration}
          offsetSeconds={deck.offsetSeconds}
          zoom={deck.zoom}
          loopEnabled={deck.loopEnabled}
          loopStartSeconds={deck.loopStartSeconds}
          loopEndSeconds={deck.loopEndSeconds}
          onSeek={(progress) => onSeek(deck.id, progress)}
          onLoopBoundsChange={(startSeconds, endSeconds) =>
            onLoopBoundsChange(deck.id, startSeconds, endSeconds)
          }
          getCurrentSeconds={getCurrentSeconds}
          getPlaybackSnapshot={() => getDeckPlaybackSnapshot(deck.id)}
          onEmptyClick={() => onLoadClick(deck.id)}
        />
        <label className="deck__bpm-slider deck__bpm-slider--vertical">
          <span>Tempo</span>
          <input
            type="range"
            min="-100"
            max="100"
            step="0.1"
            value={deck.tempoOffset}
            onChange={(event) => onTempoOffsetChange(deck.id, Number(event.target.value))}
            onDoubleClick={() => onTempoOffsetChange(deck.id, 0)}
          />
        </label>
        <div className="deck__waveform-side">
          <div className="deck__zoom">
            <span>Zoom</span>
            <div className="deck__zoom-controls">
              <button
                type="button"
                className="deck__zoom-button"
                disabled={zoomIndex <= 0}
                onClick={() => onZoomChange(deck.id, zoomSteps[Math.max(0, zoomIndex - 1)])}
              >
                -
              </button>
              <button
                type="button"
                className="deck__zoom-readout"
                onDoubleClick={() => onZoomChange(deck.id, 1)}
              >
                {zoomValue}x
              </button>
              <button
                type="button"
                className="deck__zoom-button"
                disabled={zoomIndex >= zoomSteps.length - 1}
                onClick={() =>
                  onZoomChange(deck.id, zoomSteps[Math.min(zoomSteps.length - 1, zoomIndex + 1)])
                }
              >
                +
              </button>
            </div>
          </div>
          <div className="deck__gain-knob">
            <Knob
              label="Gain"
              min={0}
              max={1.5}
              step={0.01}
              value={deck.gain}
              defaultValue={0.9}
              onChange={(next) => onGainChange(deck.id, next)}
            />
          </div>
        </div>
      </div>
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
              defaultValue={0}
              onChange={(next) => onFilterChange(deck.id, next)}
              formatValue={formatDjFilter}
              centerSnap={0.03}
              isAutomated={djAutomation.active}
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
              defaultValue={0.7}
              onChange={(next) => onResonanceChange(deck.id, next)}
              formatValue={(value) => value.toFixed(2)}
              isAutomated={resonanceAutomation.active}
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
        <div className="deck__fx-row deck__fx-row--eq">
          <div className="deck__fx-unit deck__fx-unit--eq">
            <Knob
              label="Low"
              min={-36}
              max={36}
              step={0.5}
              value={eqLowValue}
              defaultValue={0}
              onChange={(next) => onEqLowChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqLowAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-36}
              max={36}
              value={eqLowValue}
              samples={eqLowAutomation.samples}
              previewSamples={eqLowAutomation.previewSamples}
              durationSec={eqLowAutomation.durationSec}
              recording={eqLowAutomation.recording}
              active={eqLowAutomation.active}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqLow")}
              onDrawStart={() => onAutomationStart(deck.id, "eqLow")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqLow")}
              onReset={() => onAutomationReset(deck.id, "eqLow")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqLow", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqLow", value)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--eq">
            <Knob
              label="Mid"
              min={-36}
              max={36}
              step={0.5}
              value={eqMidValue}
              defaultValue={0}
              onChange={(next) => onEqMidChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqMidAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-36}
              max={36}
              value={eqMidValue}
              samples={eqMidAutomation.samples}
              previewSamples={eqMidAutomation.previewSamples}
              durationSec={eqMidAutomation.durationSec}
              recording={eqMidAutomation.recording}
              active={eqMidAutomation.active}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqMid")}
              onDrawStart={() => onAutomationStart(deck.id, "eqMid")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqMid")}
              onReset={() => onAutomationReset(deck.id, "eqMid")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqMid", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqMid", value)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--eq">
            <Knob
              label="High"
              min={-36}
              max={36}
              step={0.5}
              value={eqHighValue}
              defaultValue={0}
              onChange={(next) => onEqHighChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqHighAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-36}
              max={36}
              value={eqHighValue}
              samples={eqHighAutomation.samples}
              previewSamples={eqHighAutomation.previewSamples}
              durationSec={eqHighAutomation.durationSec}
              recording={eqHighAutomation.recording}
              active={eqHighAutomation.active}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqHigh")}
              onDrawStart={() => onAutomationStart(deck.id, "eqHigh")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqHigh")}
              onReset={() => onAutomationReset(deck.id, "eqHigh")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqHigh", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqHigh", value)
              }
            />
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--single">
          <div className="deck__fx-unit deck__fx-unit--pitch">
            <Knob
              label="Pitch"
              min={-12}
              max={12}
              step={0.1}
              value={pitchValue}
              defaultValue={0}
              onChange={(next) => onPitchShiftChange(deck.id, next)}
              formatValue={(value) => `${value.toFixed(1)} st`}
              centerSnap={0.25}
              isAutomated={pitchAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-12}
              max={12}
              value={pitchValue}
              samples={pitchAutomation.samples}
              previewSamples={pitchAutomation.previewSamples}
              durationSec={pitchAutomation.durationSec}
              recording={pitchAutomation.recording}
              active={pitchAutomation.active}
              getPlayhead={() => getAutomationPlayhead(deck.id, "pitch")}
              onDrawStart={() => onAutomationStart(deck.id, "pitch")}
              onDrawEnd={() => onAutomationStop(deck.id, "pitch")}
              onReset={() => onAutomationReset(deck.id, "pitch")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "pitch", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "pitch", value)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeckCard;
