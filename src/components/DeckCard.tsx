import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckState } from "../types/deck";
import AutomationLane from "./AutomationLane";
import Knob from "./Knob";
import Waveform from "./Waveform";
import AsyncActionButton from "./AsyncActionButton";
import { setPerfCounter } from "../utils/perf";

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
  onDelayTimeChange: (id: number, value: number) => void;
  onDelayFeedbackChange: (id: number, value: number) => void;
  onDelayMixChange: (id: number, value: number) => void;
  onDelayToneChange: (id: number, value: number) => void;
  onDelayPingPongChange: (id: number, value: boolean) => void;
  onBalanceChange: (id: number, value: number) => void;
  onPitchShiftChange: (id: number, value: number) => void;
  automation?: Record<
    "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    {
      samples: Float32Array;
      previewSamples: Float32Array;
      durationSec: number;
      recording: boolean;
      active: boolean;
      currentValue: number;
      amplitudeScale: number;
    }
  >;
  onAutomationStart: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch"
  ) => void;
  onAutomationStop: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch"
  ) => void;
  onAutomationValueChange: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    value: number
  ) => void;
  getAutomationPlayhead: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch"
  ) => number;
  onAutomationToggle: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    active: boolean
  ) => void;
  onAutomationReset: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch"
  ) => void;
  onAutomationPreset: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    preset: "sine" | "triangle" | "ramp",
    min: number,
    max: number
  ) => void;
  onAutomationLengthScale: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    factor: number
  ) => void;
  onAutomationAmplitudeScale: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    factor: number,
    min: number,
    max: number
  ) => void;
  onAutomationDurationChange: (
    id: number,
    param: "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
    durationSec: number
  ) => void;
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
  onStretchLoop: (id: number) => void;
  stretchEstimate?: string | null;
  onSaveLoopClip: (id: number, includeSettings: boolean) => void;
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
  onDelayTimeChange,
  onDelayFeedbackChange,
  onDelayMixChange,
  onDelayToneChange,
  onDelayPingPongChange,
  onBalanceChange,
  onPitchShiftChange,
  automation,
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
  stretchEstimate,
  onSaveLoopClip,
  getDeckPosition,
  getDeckPlaybackSnapshot,
  setFileInputRef,
}: DeckCardProps) => {
  const renderCountRef = useRef(0);
  useEffect(() => {
    renderCountRef.current += 1;
    setPerfCounter("deckCardRenders", renderCountRef.current);
  });

  const formatTempo = (value: number) => {
    if (Math.abs(value) < 0.005) return "0.00%";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };
  const stretchWindowSizes = [2048, 4096, 8192, 16384];
  const stretchWindowIndex = Math.max(
    0,
    stretchWindowSizes.indexOf(deck.stretchWindowSize ?? 16384)
  );
  const zoomSteps = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  const zoomIndex = zoomSteps.reduce((bestIndex, step, index) => {
    const bestDiff = Math.abs(zoomSteps[bestIndex] - deck.zoom);
    const nextDiff = Math.abs(step - deck.zoom);
    return nextDiff < bestDiff ? index : bestIndex;
  }, 0);
  const zoomValue = zoomSteps[zoomIndex];
  const djFilter = Math.min(Math.max(deck.djFilter, -1), 1);
  const resonanceMin = 0;
  const resonanceMax = 24;
  const resonanceValue = Math.min(
    Math.max(deck.filterResonance, resonanceMin),
    resonanceMax
  );
  const formatDjFilter = (value: number, fine = false) => {
    const precision = fine ? 3 : 1;
    if (value > 0.05) return `HP ${value.toFixed(precision)}`;
    if (value < -0.05) return `LP ${Math.abs(value).toFixed(precision)}`;
    return "Flat";
  };
  const formatEq = (value: number, fine = false) => {
    if (value === 0) return "0.0 dB";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(fine ? 2 : 1)} dB`;
  };
  const djAutomation = automation?.djFilter ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: djFilter,
    amplitudeScale: 1,
  };
  const resonanceAutomation = automation?.resonance ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: resonanceValue,
    amplitudeScale: 1,
  };
  const eqLowAutomation = automation?.eqLow ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqLowGain,
    amplitudeScale: 1,
  };
  const eqMidAutomation = automation?.eqMid ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqMidGain,
    amplitudeScale: 1,
  };
  const eqHighAutomation = automation?.eqHigh ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.eqHighGain,
    amplitudeScale: 1,
  };
  const balanceAutomation = automation?.balance ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.balance,
    amplitudeScale: 1,
  };
  const pitchAutomation = automation?.pitch ?? {
    samples: new Float32Array(0),
    previewSamples: new Float32Array(0),
    durationSec: 0,
    recording: false,
    active: false,
    currentValue: deck.pitchShift,
    amplitudeScale: 1,
  };
  const djFilterValue = djAutomation.active ? djAutomation.currentValue : djFilter;
  const resonanceDisplayValue = resonanceAutomation.active
    ? resonanceAutomation.currentValue
    : resonanceValue;
  const eqLowValue = eqLowAutomation.active ? eqLowAutomation.currentValue : deck.eqLowGain;
  const eqMidValue = eqMidAutomation.active ? eqMidAutomation.currentValue : deck.eqMidGain;
  const eqHighValue = eqHighAutomation.active ? eqHighAutomation.currentValue : deck.eqHighGain;
  const balanceValue = balanceAutomation.active
    ? balanceAutomation.currentValue
    : deck.balance;
  const pitchValue = pitchAutomation.active
    ? pitchAutomation.currentValue
    : deck.pitchShift;

  const playbackSnapshotRef = useRef(getDeckPlaybackSnapshot);
  const deckPositionRef = useRef(getDeckPosition);

  useEffect(() => {
    playbackSnapshotRef.current = getDeckPlaybackSnapshot;
  }, [getDeckPlaybackSnapshot]);

  useEffect(() => {
    deckPositionRef.current = getDeckPosition;
  }, [getDeckPosition]);

  const getCurrentSeconds = useCallback(() => {
    const snapshot = playbackSnapshotRef.current(deck.id);
    if (snapshot) return snapshot.position;
    return deckPositionRef.current(deck.id);
  }, [deck.id]);

  const handleSeek = useCallback(
    (progress: number) => {
      onSeek(deck.id, progress);
    },
    [deck.id, onSeek]
  );

  const handleLoopBoundsChange = useCallback(
    (startSeconds: number, endSeconds: number) => {
      onLoopBoundsChange(deck.id, startSeconds, endSeconds);
    },
    [deck.id, onLoopBoundsChange]
  );

  const handleLoopEnabledChange = useCallback(
    (enabled: boolean) => {
      onLoopChange(deck.id, enabled);
    },
    [deck.id, onLoopChange]
  );

  const handlePlaybackSnapshot = useCallback(
    () => playbackSnapshotRef.current(deck.id),
    [deck.id]
  );

  const handleEmptyClick = useCallback(() => {
    onLoadClick(deck.id);
  }, [deck.id, onLoadClick]);

  const [saveSettings, setSaveSettings] = useState(false);
  const [tempoFine, setTempoFine] = useState(false);
  const tempoFineDragRef = useRef<{ startY: number; startValue: number } | null>(null);
  const tempoIgnoreChangeRef = useRef(false);

  return (
    <div className="deck">
      <div className="deck__header">
        <div className="deck__label-row">
          <span className="deck__label">
            <span className="deck__label-text">{label}</span>
            <span className="deck__title">{deck.fileName ?? "No file loaded"}</span>
          </span>
          <div className="deck__actions">
            <div className="deck__actions-left">
              <input
                ref={(node) => setFileInputRef(deck.id, node)}
                className="deck__file-input"
                type="file"
                accept="audio/*"
                onChange={(event) => onFileSelected(deck.id, event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="deck__actions-right">
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
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Save Loop"
                busyLabel="Saving..."
                onAction={() => onSaveLoopClip(deck.id, saveSettings)}
              />
              <button type="button" className="deck__action" onClick={() => onLoadClick(deck.id)}>
                {deck.fileName ? "Replace" : "Load"}
              </button>
              <button
                type="button"
                className="deck__action deck__remove"
                onClick={() => onRemove(deck.id)}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <div className="deck__meta">
          <div className="deck__bpm-summary">
            <span className={`deck__status deck__status--${deck.status}`}>
              {deck.status}
            </span>
            <div className="deck__meta-actions">
              <label
                className="deck__pitch-sync"
                title="When enabled, Save Loop stores the current deck FX/automation/settings (filters, EQ, delay, balance, pitch, tempo, stretch, and loop settings) as metadata without baking them into the audio. Loading that clip will reapply those settings to the target deck."
              >
                <input
                  type="checkbox"
                  checked={saveSettings}
                  onChange={(event) => setSaveSettings(event.target.checked)}
                />
                Save FX Settings
              </label>
              <label className="deck__pitch-sync">
                <input
                  type="checkbox"
                  checked={deck.tempoPitchSync}
                  onChange={(event) => onTempoPitchSyncChange(deck.id, event.target.checked)}
                />
                Sync Pitch
              </label>
              <span>Tempo {formatTempo(deck.tempoOffset)}</span>
            </div>
          </div>
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
          gain={deck.gain}
          balance={deck.balance}
          eqLowGain={eqLowValue}
          eqMidGain={eqMidValue}
          eqHighGain={eqHighValue}
          loopEnabled={deck.loopEnabled}
          loopStartSeconds={deck.loopStartSeconds}
          loopEndSeconds={deck.loopEndSeconds}
          onSeek={handleSeek}
          onLoopBoundsChange={handleLoopBoundsChange}
          onLoopEnabledChange={handleLoopEnabledChange}
          getCurrentSeconds={getCurrentSeconds}
          getPlaybackSnapshot={handlePlaybackSnapshot}
          onEmptyClick={handleEmptyClick}
        />
        <label className="deck__bpm-slider deck__bpm-slider--vertical">
          <span>Tempo</span>
          <input
            type="range"
            min="-100"
            max="100"
            step={0.001}
            value={deck.tempoOffset}
            onChange={(event) => {
              if (tempoIgnoreChangeRef.current) return;
              const raw = Number(event.target.value);
              const isFine = tempoFine;
              const next = isFine ? raw : Math.round(raw * 10) / 10;
              onTempoOffsetChange(deck.id, next, isFine ? { disableSnap: true } : undefined);
            }}
            onDoubleClick={() => onTempoOffsetChange(deck.id, 0)}
            onPointerDown={(event) => {
              if (event.shiftKey) {
                tempoFineDragRef.current = {
                  startY: event.clientY,
                  startValue: deck.tempoOffset,
                };
                tempoIgnoreChangeRef.current = true;
              }
              setTempoFine(event.shiftKey);
            }}
            onPointerMove={(event) => {
              if (tempoFineDragRef.current) {
                if (!event.shiftKey) {
                  tempoFineDragRef.current = null;
                  tempoIgnoreChangeRef.current = false;
                  setTempoFine(false);
                  return;
                }
                event.preventDefault();
                const delta = (tempoFineDragRef.current.startY - event.clientY) * 0.002;
                const base = tempoFineDragRef.current.startValue;
                const next = Math.min(100, Math.max(-100, base + delta));
                onTempoOffsetChange(deck.id, next, { disableSnap: true });
                return;
              }
              if (tempoFine !== event.shiftKey) {
                setTempoFine(event.shiftKey);
              }
            }}
            onPointerUp={() => {
              const wasFineDrag = Boolean(tempoFineDragRef.current);
              tempoFineDragRef.current = null;
              if (wasFineDrag) {
                tempoIgnoreChangeRef.current = true;
                window.setTimeout(() => {
                  tempoIgnoreChangeRef.current = false;
                }, 0);
              } else {
                tempoIgnoreChangeRef.current = false;
              }
              setTempoFine(false);
            }}
            onPointerCancel={() => {
              tempoFineDragRef.current = null;
              tempoIgnoreChangeRef.current = false;
              setTempoFine(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Shift") {
                setTempoFine(true);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === "Shift") {
                setTempoFine(false);
              }
            }}
            onBlur={() => setTempoFine(false)}
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
              labelTitle="Controls deck output level before the FX chain."
              onChange={(next) => onGainChange(deck.id, next)}
            />
          </div>
        </div>
      </div>
      <div className="deck__fx">
        <div className="deck__fx-title">Deck FX</div>
        <div className="deck__fx-row">
          <div className="deck__fx-unit deck__fx-unit--filter">
            <span
              className="deck__fx-hint"
              title="DJ Filter: sweeps between low‑pass and high‑pass to carve the sound. Use it to fade lows/highs during transitions. It runs in real time and affects both playback and rendered stretch output."
            />
            <Knob
              label="DJ Filter"
              min={-1}
              max={1}
              step={0.01}
              value={djFilterValue}
              defaultValue={0}
              labelTitle="Sweeps between low‑pass and high‑pass. Center is full range."
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
              amplitudeScale={djAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "djFilter")}
              onDrawStart={() => onAutomationStart(deck.id, "djFilter")}
              onDrawEnd={() => onAutomationStop(deck.id, "djFilter")}
              onReset={() => onAutomationReset(deck.id, "djFilter")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "djFilter", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "djFilter", value)
              }
              onPreset={(preset) =>
                onAutomationPreset(deck.id, "djFilter", preset, -1, 1)
              }
              onLengthScale={(factor) =>
                onAutomationLengthScale(deck.id, "djFilter", factor)
              }
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "djFilter", factor, -1, 1)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "djFilter", durationSec)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--filter">
            <span
              className="deck__fx-hint"
              title="Resonance: boosts the cutoff edge for sharper, more pronounced filter sweeps. Higher values add bite and intensity; it pairs with DJ Filter and is rendered into stretch output."
            />
            <Knob
              label="Resonance"
              min={resonanceMin}
              max={resonanceMax}
              step={0.05}
              value={resonanceDisplayValue}
              defaultValue={0}
              labelTitle="Boosts the filter edge. Higher values add more bite and focus."
              onChange={(next) => onResonanceChange(deck.id, next)}
              formatValue={(value, fine) => value.toFixed(fine ? 3 : 1)}
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
              amplitudeScale={resonanceAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "resonance")}
              onDrawStart={() => onAutomationStart(deck.id, "resonance")}
              onDrawEnd={() => onAutomationStop(deck.id, "resonance")}
              onReset={() => onAutomationReset(deck.id, "resonance")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "resonance", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "resonance", value)
              }
              onPreset={(preset) =>
                onAutomationPreset(deck.id, "resonance", preset, resonanceMin, resonanceMax)
              }
              onLengthScale={(factor) =>
                onAutomationLengthScale(deck.id, "resonance", factor)
              }
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(
                  deck.id,
                  "resonance",
                  factor,
                  resonanceMin,
                  resonanceMax
                )
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "resonance", durationSec)
              }
            />
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--eq">
          <div className="deck__fx-unit deck__fx-unit--eq">
            <span
              className="deck__fx-hint"
              title="Low EQ: shapes bass energy. Boost to add weight, cut to clean up muddiness. Affects live playback and stretch renders."
            />
            <Knob
              label="Low"
              min={-18}
              max={18}
              step={0.1}
              value={eqLowValue}
              defaultValue={0}
              labelTitle="Low‑shelf EQ. Positive adds bass, negative removes weight."
              onChange={(next) => onEqLowChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqLowAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-18}
              max={18}
              value={eqLowValue}
              samples={eqLowAutomation.samples}
              previewSamples={eqLowAutomation.previewSamples}
              durationSec={eqLowAutomation.durationSec}
              recording={eqLowAutomation.recording}
              active={eqLowAutomation.active}
              amplitudeScale={eqLowAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqLow")}
              onDrawStart={() => onAutomationStart(deck.id, "eqLow")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqLow")}
              onReset={() => onAutomationReset(deck.id, "eqLow")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqLow", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqLow", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "eqLow", preset, -18, 18)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqLow", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "eqLow", factor, -18, 18)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "eqLow", durationSec)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--eq">
            <span
              className="deck__fx-hint"
              title="Mid EQ: controls presence and body. Boost for clarity, cut to reduce boxiness. Impacts live playback and stretch renders."
            />
            <Knob
              label="Mid"
              min={-18}
              max={18}
              step={0.1}
              value={eqMidValue}
              defaultValue={0}
              labelTitle="Mid‑band EQ. Boost presence or cut boxiness."
              onChange={(next) => onEqMidChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqMidAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-18}
              max={18}
              value={eqMidValue}
              samples={eqMidAutomation.samples}
              previewSamples={eqMidAutomation.previewSamples}
              durationSec={eqMidAutomation.durationSec}
              recording={eqMidAutomation.recording}
              active={eqMidAutomation.active}
              amplitudeScale={eqMidAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqMid")}
              onDrawStart={() => onAutomationStart(deck.id, "eqMid")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqMid")}
              onReset={() => onAutomationReset(deck.id, "eqMid")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqMid", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqMid", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "eqMid", preset, -18, 18)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqMid", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "eqMid", factor, -18, 18)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "eqMid", durationSec)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--eq">
            <span
              className="deck__fx-hint"
              title="High EQ: adjusts brightness and air. Boost for sparkle, cut for smoothness. Applied during playback and in stretch renders."
            />
            <Knob
              label="High"
              min={-18}
              max={18}
              step={0.1}
              value={eqHighValue}
              defaultValue={0}
              labelTitle="High‑shelf EQ. Positive adds air, negative tames brightness."
              onChange={(next) => onEqHighChange(deck.id, next)}
              formatValue={formatEq}
              centerSnap={0.25}
              isAutomated={eqHighAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-18}
              max={18}
              value={eqHighValue}
              samples={eqHighAutomation.samples}
              previewSamples={eqHighAutomation.previewSamples}
              durationSec={eqHighAutomation.durationSec}
              recording={eqHighAutomation.recording}
              active={eqHighAutomation.active}
              amplitudeScale={eqHighAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "eqHigh")}
              onDrawStart={() => onAutomationStart(deck.id, "eqHigh")}
              onDrawEnd={() => onAutomationStop(deck.id, "eqHigh")}
              onReset={() => onAutomationReset(deck.id, "eqHigh")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "eqHigh", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "eqHigh", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "eqHigh", preset, -18, 18)}
              onLengthScale={(factor) =>
                onAutomationLengthScale(deck.id, "eqHigh", factor)
              }
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "eqHigh", factor, -18, 18)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "eqHigh", durationSec)
              }
            />
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--single">
          <div className="deck__fx-unit deck__fx-unit--balance">
            <span
              className="deck__fx-hint"
              title="Balance: pans the deck left/right in the stereo field. Use it to place layers in the mix; it affects playback and rendered output."
            />
            <Knob
              label="Balance"
              min={-1}
              max={1}
              step={0.01}
              value={balanceValue}
              defaultValue={0}
              labelTitle="Stereo pan. Left is negative, right is positive."
              onChange={(next) => onBalanceChange(deck.id, next)}
              formatValue={(value, fine) => value.toFixed(fine ? 3 : 1)}
              centerSnap={0.03}
              isAutomated={balanceAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={-1}
              max={1}
              value={balanceValue}
              samples={balanceAutomation.samples}
              previewSamples={balanceAutomation.previewSamples}
              durationSec={balanceAutomation.durationSec}
              recording={balanceAutomation.recording}
              active={balanceAutomation.active}
              amplitudeScale={balanceAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "balance")}
              onDrawStart={() => onAutomationStart(deck.id, "balance")}
              onDrawEnd={() => onAutomationStop(deck.id, "balance")}
              onReset={() => onAutomationReset(deck.id, "balance")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "balance", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "balance", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "balance", preset, -1, 1)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "balance", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "balance", factor, -1, 1)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "balance", durationSec)
              }
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--pitch">
            <span
              className="deck__fx-hint"
              title="Pitch: shifts the deck in semitones. Use for key matching or creative detune. When tempo‑pitch sync is off, it changes pitch independently; included in stretch renders."
            />
            <Knob
              label="Pitch"
              min={-24}
              max={24}
              step={0.1}
              value={pitchValue}
              defaultValue={0}
              labelTitle="Pitch shift in semitones. Positive raises, negative lowers."
              onChange={(next) => onPitchShiftChange(deck.id, next)}
              formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)} st`}
              centerSnap={0.25}
              isAutomated={pitchAutomation.active}
              disabled={deck.tempoPitchSync}
            />
            <AutomationLane
              label="Automation"
              min={-24}
              max={24}
              value={pitchValue}
              samples={pitchAutomation.samples}
              previewSamples={pitchAutomation.previewSamples}
              durationSec={pitchAutomation.durationSec}
              recording={pitchAutomation.recording}
              active={pitchAutomation.active}
              amplitudeScale={pitchAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "pitch")}
              onDrawStart={() => onAutomationStart(deck.id, "pitch")}
              onDrawEnd={() => onAutomationStop(deck.id, "pitch")}
              onReset={() => onAutomationReset(deck.id, "pitch")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "pitch", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "pitch", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "pitch", preset, -24, 24)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "pitch", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "pitch", factor, -24, 24)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "pitch", durationSec)
              }
              disabled={deck.tempoPitchSync}
            />
          </div>
          <div className="deck__fx-unit deck__fx-unit--delay deck__fx-unit--span-2">
            <span
              className="deck__fx-hint"
              title="Delay: time-based echo with feedback, tone, and mix controls. Ping pong bounces repeats left/right."
            />
            <div className="deck__fx-unit-title">Delay</div>
            <div className="deck__delay-controls">
              <Knob
                className="knob--compact"
                label="Time"
                min={0.01}
                max={1.5}
                step={0.01}
                value={deck.delayTime}
                defaultValue={0.35}
                labelTitle="Delay time in seconds. Longer values create wider gaps between repeats."
                onChange={(next) => onDelayTimeChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}s`}
              />
              <Knob
                className="knob--compact"
                label="Feedback"
                min={0}
                max={0.95}
                step={0.01}
                value={deck.delayFeedback}
                defaultValue={0.35}
                labelTitle="Feedback amount. Higher values create more repeats."
                onChange={(next) => onDelayFeedbackChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.delayMix}
                defaultValue={0}
                labelTitle="Wet/dry mix. 0 = dry, 1 = fully delayed."
                onChange={(next) => onDelayMixChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Tone"
                min={400}
                max={12000}
                step={100}
                value={deck.delayTone}
                defaultValue={6000}
                labelTitle="Low-pass filter inside the feedback path. Lower = darker repeats."
                onChange={(next) => onDelayToneChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 1 : 0)} Hz`}
              />
              <label className="deck__delay-toggle">
                <span>Ping Pong</span>
                <input
                  type="checkbox"
                  checked={deck.delayPingPong}
                  onChange={(event) =>
                    onDelayPingPongChange(deck.id, event.target.checked)
                  }
                />
              </label>
            </div>
          </div>
          <div className="deck__fx-unit deck__fx-unit--stretch deck__fx-unit--span-2">
            <span
              className="deck__fx-hint"
              title="Stretch: offline Paulstretch render of the current loop. Use it to create long ambient textures; settings control scatter (grain spacing), phase randomness, width, and tone. The render replaces the deck buffer."
            />
            <div className="deck__fx-unit-title">Stretch</div>
            <div className="deck__stretch-grid">
              <Knob
                label="Amount"
                min={1}
                max={16}
                step={0.1}
                value={deck.stretchRatio}
                defaultValue={2}
                labelTitle="Lengthens or shortens the loop. Higher values create longer, slower textures."
                onChange={(next) => onStretchRatioChange(deck.id, next)}
                formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}x`}
              />
              <div className="deck__stretch-controls">
                <Knob
                  className="knob--compact"
                  label="Phase"
                  min={0}
                  max={1}
                  step={0.05}
                  value={deck.stretchPhaseRandomness}
                  defaultValue={0.5}
                  labelTitle="Controls how random the phase is. Higher values sound more diffuse and airy."
                  onChange={(next) => onStretchPhaseRandomnessChange(deck.id, next)}
                  formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
                />
                <Knob
                  className="knob--compact"
                  label="Width"
                  min={0}
                  max={2}
                  step={0.05}
                  value={deck.stretchStereoWidth}
                  defaultValue={1}
                  labelTitle="Stereo width after stretch. 0 = mono, 1 = original width, 2 = wide."
                  onChange={(next) => onStretchStereoWidthChange(deck.id, next)}
                  formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}x`}
                />
                <Knob
                  className="knob--compact"
                  label="Tilt"
                  min={-18}
                  max={18}
                  step={0.1}
                  value={deck.stretchTiltDb}
                  defaultValue={0}
                  labelTitle="Spectral tilt across frequencies. Positive = brighter, negative = darker."
                  onChange={(next) => onStretchTiltDbChange(deck.id, next)}
                  formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)} dB`}
                />
                <Knob
                  className="knob--compact"
                  label="Scatter"
                  min={1}
                  max={16}
                  step={0.05}
                  value={deck.stretchScatter}
                  defaultValue={1}
                  labelTitle="Grain spacing multiplier. Higher = grains farther apart with more space between."
                  onChange={(next) => onStretchScatterChange(deck.id, next)}
                  formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}x`}
                />
                <Knob
                  className="knob--compact"
                  label="Window"
                  min={1}
                  max={stretchWindowSizes.length}
                  step={1}
                  value={stretchWindowIndex + 1}
                  defaultValue={stretchWindowSizes.indexOf(16384) + 1}
                  labelTitle="FFT window size. Larger = smoother, smaller = grainier/clearer transients."
                  centerSnap={0}
                  onChange={(next) => {
                    const index = Math.min(
                      stretchWindowSizes.length - 1,
                      Math.max(0, Math.round(next) - 1)
                    );
                    onStretchWindowSizeChange(deck.id, stretchWindowSizes[index]);
                  }}
                  formatValue={() => `${stretchWindowSizes[stretchWindowIndex] / 1024}k`}
                />
              </div>
            </div>
            <div className="deck__fx-actions">
              <AsyncActionButton
                className="deck__action"
                disabled={!deck.buffer}
                idleLabel="Stretch Loop"
                busyLabel="Stretching..."
                onAction={() => onStretchLoop(deck.id)}
              />
              {stretchEstimate ? (
                <span className="deck__stretch-estimate">{stretchEstimate}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeckCard;
