import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  DeckFxPanel,
  DeckState,
  ParametricEqBand,
  SimpleAutomationParam,
} from "../types/deck";
import AutomationLane from "./AutomationLane";
import AsyncActionButton from "./AsyncActionButton";
import Knob from "./Knob";
import ParametricEqEditor from "./ParametricEqEditor";
import type { DeckCardProps } from "./DeckCard";
import type { AutomationTrackView } from "./deckCardUtils";

const DEFAULT_DECK_GAIN = 0.9;

type DeckCardFxRackProps = {
  deck: DeckState;
  deckProps: DeckCardProps;
  fxPanelOpen: DeckState["fxPanelOpen"];
  allFxOpen: boolean;
  toggleAllFxPanels: () => void;
  toggleFxPanel: (panel: DeckFxPanel) => void;
  renderFxToggleLabel: (panel: DeckFxPanel, label: string) => ReactNode;
  gainValue: number;
  djFilterValue: number;
  resonanceMin: number;
  resonanceMax: number;
  resonanceDisplayValue: number;
  eqLowValue: number;
  eqMidValue: number;
  eqHighValue: number;
  balanceValue: number;
  pitchValue: number;
  gainAutomation: AutomationTrackView;
  djAutomation: AutomationTrackView;
  resonanceAutomation: AutomationTrackView;
  eqLowAutomation: AutomationTrackView;
  eqMidAutomation: AutomationTrackView;
  eqHighAutomation: AutomationTrackView;
  balanceAutomation: AutomationTrackView;
  pitchAutomation: AutomationTrackView;
  formatDjFilter: (value: number, fine?: boolean) => string;
  formatEq: (value: number, fine?: boolean) => string;
  activateEq3Mode: () => void;
  commitParametricEqBands: (bands: ParametricEqBand[]) => void;
  onSimpleAutomationSet: (
    deckId: number,
    param: SimpleAutomationParam,
    target: number,
    baseline: number,
    recording?: { samples: number[]; sampleRate: number; durationSec: number }
  ) => void;
  onSimpleAutomationClear: (deckId: number, param: SimpleAutomationParam) => void;
  rearrangerSnapshotCapturedAtMs: number | null;
  autoSliceEnabled: boolean;
  handleAutoSliceToggle: (enabled: boolean) => void;
  handleRearrangerSlicesKnobChange: (next: number) => void;
  setShowQuietDeletePreview: (value: boolean) => void;
  stretchWindowSizes: number[];
  stretchWindowIndex: number;
};

const DeckCardFxRack = ({
  deck,
  deckProps,
  fxPanelOpen,
  allFxOpen,
  toggleAllFxPanels,
  toggleFxPanel,
  renderFxToggleLabel,
  gainValue,
  djFilterValue,
  resonanceMin,
  resonanceMax,
  resonanceDisplayValue,
  eqLowValue,
  eqMidValue,
  eqHighValue,
  balanceValue,
  pitchValue,
  gainAutomation,
  djAutomation,
  resonanceAutomation,
  eqLowAutomation,
  eqMidAutomation,
  eqHighAutomation,
  balanceAutomation,
  pitchAutomation,
  formatDjFilter,
  formatEq,
  activateEq3Mode,
  commitParametricEqBands,
  onSimpleAutomationSet,
  onSimpleAutomationClear,
  rearrangerSnapshotCapturedAtMs,
  autoSliceEnabled,
  handleAutoSliceToggle,
  handleRearrangerSlicesKnobChange,
  setShowQuietDeletePreview,
  stretchWindowSizes,
  stretchWindowIndex,
}: DeckCardFxRackProps) => {
  const {
    onFxResetAll,
    onGainChange,
    getAutomationPlayhead,
    onAutomationStart,
    onAutomationStop,
    onAutomationReset,
    onAutomationToggle,
    onAutomationValueChange,
    onAutomationPreset,
    onAutomationInvert,
    onAutomationLengthScale,
    onAutomationAmplitudeScale,
    onAutomationDurationChange,
    onFilterChange,
    onResonanceChange,
    onBalanceChange,
    onPitchShiftChange,
    onEqModeChange,
    onEqLowChange,
    onEqMidChange,
    onEqHighChange,
    onVocoderMixChange,
    onVocoderModulatorMonitorChange,
    onVocoderModDriveChange,
    onVocoderBandCountChange,
    onVocoderVocalCharacterChange,
    onVocoderFormantShiftChange,
    onVocoderPreEmphasisChange,
    onVocoderTightnessChange,
    onVocoderAttackMsChange,
    onVocoderReleaseMsChange,
    onVocoderPhaseRotateChange,
    onVocoderGateThresholdChange,
    onVocoderPostDelayChange,
    onVocoderCarrierDeckIdChange,
    carrierDeckOptions,
    onDelayMixChange,
    onDelayTimeChange,
    onDelayFeedbackChange,
    onDelayToneChange,
    onDelaySaturationChange,
    onDelayDampingChange,
    onDelaySafetyChange,
    onDelayRhythmMorphChange,
    onDelayRhythmRateHzChange,
    onDelaySpectralMixChange,
    onDelaySpectralSpreadChange,
    onDelaySpectralMotionChange,
    onDelayPingPongChange,
    onDelaySliceSyncChange,
    onSpectralSpaceMixChange,
    onSpectralSpaceSpreadChange,
    onSpectralSpaceMotionChange,
    onSpectralSpaceTiltChange,
    onSpectralSpaceLowMonoChange,
    onSpectralSpaceTransientProtectChange,
    onRearrangerSwapCountChange,
    onRearrangerChaosChange,
    onRearrangerReverseChange,
    onRearrangerSensitivityChange,
    onRearrangerQuietThresholdChange,
    onRearrangerSliceFadeChange,
    onRearrangerSliceDelayChange,
    onRearrangerPingPongChange,
    onRearrangerAutoChange,
    onRearrangerTrimQuiet,
    onRearrangeLoop,
    onRearrangerSnapshotCapture,
    onRearrangerSnapshotRestore,
    hasRearrangerSnapshot,
    onStretchRatioChange,
    onStretchPhaseRandomnessChange,
    onStretchStereoWidthChange,
    onStretchTiltDbChange,
    onStretchScatterChange,
    onStretchWindowSizeChange,
    onStretchLoop,
    stretchEstimate,
  } = deckProps;

  const isSimpleAutomated = (param: SimpleAutomationParam) =>
    deck.simpleAutomation?.[param]?.active === true;
  const handleParametricEqReset = () => {
    for (let slot = 1; slot <= 8; slot += 1) {
      onSimpleAutomationClear(deck.id, `parametricEqBand${slot}Frequency` as SimpleAutomationParam);
      onSimpleAutomationClear(deck.id, `parametricEqBand${slot}Gain` as SimpleAutomationParam);
    }
    onAutomationReset(deck.id, "gain");
    onGainChange(deck.id, DEFAULT_DECK_GAIN);
  };
  const lastDelayTapMsRef = useRef<number | null>(null);
  const delayTapIntervalsRef = useRef<number[]>([]);
  const [snapshotSavedFlash, setSnapshotSavedFlash] = useState(false);
  const snapshotFlashTimeoutRef = useRef<number | null>(null);

  const handleSnapshotCapture = () => {
    if (hasRearrangerSnapshot) {
      const confirmed = window.confirm(
        "A snapshot already exists for this deck. Replace it with a new snapshot?"
      );
      if (!confirmed) return;
    }
    onRearrangerSnapshotCapture(deck.id);
    setSnapshotSavedFlash(true);
    if (snapshotFlashTimeoutRef.current !== null) {
      window.clearTimeout(snapshotFlashTimeoutRef.current);
    }
    snapshotFlashTimeoutRef.current = window.setTimeout(() => {
      snapshotFlashTimeoutRef.current = null;
      setSnapshotSavedFlash(false);
    }, 1500);
  };
  const handleSnapshotRestore = () => {
    if (hasRearrangerSnapshot) {
      const confirmed = window.confirm(
        "Restore the saved snapshot for this deck? Current rearranger edits will be replaced."
      );
      if (!confirmed) return;
    }
    onRearrangerSnapshotRestore(deck.id);
  };
  const snapshotCapturedLabel =
    rearrangerSnapshotCapturedAtMs !== null
      ? new Date(rearrangerSnapshotCapturedAtMs).toLocaleString([], {
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  useEffect(
    () => () => {
      if (snapshotFlashTimeoutRef.current !== null) {
        window.clearTimeout(snapshotFlashTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (deck.eqMode === "parametric") return;
    onEqModeChange(deck.id, "parametric");
  }, [deck.eqMode, deck.id, onEqModeChange]);

  const handleDelayTap = () => {
    const now = performance.now();
    const lastTapMs = lastDelayTapMsRef.current;

    if (lastTapMs == null) {
      lastDelayTapMsRef.current = now;
      return;
    }

    const intervalMs = now - lastTapMs;
    lastDelayTapMsRef.current = now;

    // Reset tap history after long pauses and ignore ultra-fast accidental double-clicks.
    if (intervalMs > 3000 || intervalMs < 60) {
      delayTapIntervalsRef.current = [];
      return;
    }

    const intervals = [...delayTapIntervalsRef.current, intervalMs].slice(-4);
    delayTapIntervalsRef.current = intervals;

    const averageIntervalMs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const delayTimeSec = Math.min(Math.max(averageIntervalMs / 1000, 0.01), 1.5);
    onDelayTimeChange(deck.id, delayTimeSec);
  };

  return (
      <div className="deck__fx">
        <div className="deck__fx-title">
          <span>Deck FX</span>
          <div className="deck__fx-title-actions">
            <button
              type="button"
              className="deck__action deck__fx-title-toggle"
              onClick={() => onFxResetAll(deck.id)}
            >
              Reset FX
            </button>
            <button type="button" className="deck__action deck__fx-title-toggle" onClick={toggleAllFxPanels}>
              {allFxOpen ? "Close All" : "Open All"}
            </button>
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--core">
          <div
            className={`deck__fx-unit deck__fx-unit--gain ${fxPanelOpen.gain ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.gain}
              onClick={() => toggleFxPanel("gain")}
            >
              {renderFxToggleLabel("gain", "Gain")}
            </button>
            <Knob
              label="Gain"
              min={0}
              max={1.5}
              step={0.01}
              value={gainValue}
              defaultValue={0.9}
              labelTitle="Controls deck output level before the FX chain."
              onChange={(next) => onGainChange(deck.id, next)}
              formatValue={(value, fine) => value.toFixed(fine ? 3 : 2)}
              isAutomated={gainAutomation.active}
            />
            <AutomationLane
              label="Automation"
              min={0}
              max={1.5}
              value={gainValue}
              samples={gainAutomation.samples}
              previewSamples={gainAutomation.previewSamples}
              durationSec={gainAutomation.durationSec}
              recording={gainAutomation.recording}
              active={gainAutomation.active}
              amplitudeScale={gainAutomation.amplitudeScale}
              getPlayhead={() => getAutomationPlayhead(deck.id, "gain")}
              onDrawStart={() => onAutomationStart(deck.id, "gain")}
              onDrawEnd={() => onAutomationStop(deck.id, "gain")}
              onReset={() => onAutomationReset(deck.id, "gain")}
              onToggleActive={(next) => onAutomationToggle(deck.id, "gain", next)}
              onDrawValueChange={(value) =>
                onAutomationValueChange(deck.id, "gain", value)
              }
              onPreset={(preset) => onAutomationPreset(deck.id, "gain", preset, 0, 1.5)}
              onInvert={() => onAutomationInvert(deck.id, "gain", 0, 1.5)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "gain", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "gain", factor, 0, 1.5)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "gain", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--filter ${fxPanelOpen.djFilter ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.djFilter}
              onClick={() => toggleFxPanel("djFilter")}
            >
              {renderFxToggleLabel("djFilter", "DJ Filter")}
            </button>
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
              onInvert={() => onAutomationInvert(deck.id, "djFilter", -1, 1)}
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
          <div
            className={`deck__fx-unit deck__fx-unit--filter ${fxPanelOpen.resonance ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.resonance}
              onClick={() => toggleFxPanel("resonance")}
            >
              {renderFxToggleLabel("resonance", "Resonance")}
            </button>
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
              onInvert={() =>
                onAutomationInvert(deck.id, "resonance", resonanceMin, resonanceMax)
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
        <div className="deck__fx-row deck__fx-row--single">
          <div
            className={`deck__fx-unit deck__fx-unit--balance ${fxPanelOpen.balance ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.balance}
              onClick={() => toggleFxPanel("balance")}
            >
              {renderFxToggleLabel("balance", "Balance")}
            </button>
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
              onInvert={() => onAutomationInvert(deck.id, "balance", -1, 1)}
              onLengthScale={(factor) => onAutomationLengthScale(deck.id, "balance", factor)}
              onAmplitudeScale={(factor) =>
                onAutomationAmplitudeScale(deck.id, "balance", factor, -1, 1)
              }
              onDurationChange={(durationSec) =>
                onAutomationDurationChange(deck.id, "balance", durationSec)
              }
            />
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--pitch ${fxPanelOpen.pitch ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.pitch}
              onClick={() => toggleFxPanel("pitch")}
            >
              {renderFxToggleLabel("pitch", "Pitch")}
            </button>
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
              onInvert={() => onAutomationInvert(deck.id, "pitch", -24, 24)}
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
        </div>
        <div className="deck__fx-row deck__fx-row--parametric">
          <div
            className={`deck__fx-unit deck__fx-unit--parametric deck__fx-unit--span-3 ${fxPanelOpen.parametricEq ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.parametricEq}
              title="Toggle Parametric EQ panel."
              onClick={() => toggleFxPanel("parametricEq")}
            >
              {renderFxToggleLabel("parametricEq", "EQ")}
            </button>
            <div className="deck__parametric-controls">
              <div className="deck__parametric-mode">
                <span className="deck__fx-unit-title">Parametric EQ</span>
              </div>
              {deck.eqMode === "parametric" ? (
                <ParametricEqEditor
                  bands={deck.parametricEqBands}
                  playbackActive={deck.status === "playing"}
                  disabled={false}
                  outputGain={gainValue}
                  isSimpleAutomated={isSimpleAutomated}
                  onSimpleAutomationSet={(param, target, baseline, recording) => {
                    onSimpleAutomationSet(deck.id, param, target, baseline, recording);
                  }}
                  onSimpleAutomationClear={(param) => {
                    onSimpleAutomationClear(deck.id, param);
                  }}
                  onOutputGainChange={(next) => onGainChange(deck.id, next)}
                  onResetAll={handleParametricEqReset}
                  onChange={commitParametricEqBands}
                />
              ) : (
                <div className="deck__eq3-inline">
                  <div className="deck__eq3-sections">
                    <div className="deck__eq3-section">
                      <Knob
                        label="Low"
                        min={-18}
                        max={18}
                        step={0.1}
                        value={eqLowValue}
                        defaultValue={0}
                        labelTitle="Low‑shelf EQ. Positive adds bass, negative removes weight."
                        onChange={(next) => {
                          activateEq3Mode();
                          onEqLowChange(deck.id, next);
                        }}
                        formatValue={formatEq}
                        centerSnap={0.25}
                        isAutomated={eqLowAutomation.active}
                      />
                      <AutomationLane
                        label="Low Auto"
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
                        onDrawStart={() => {
                          activateEq3Mode();
                          onAutomationStart(deck.id, "eqLow");
                        }}
                        onDrawEnd={() => onAutomationStop(deck.id, "eqLow")}
                        onReset={() => onAutomationReset(deck.id, "eqLow")}
                        onToggleActive={(next) => {
                          activateEq3Mode();
                          onAutomationToggle(deck.id, "eqLow", next);
                        }}
                        onDrawValueChange={(value) => {
                          activateEq3Mode();
                          onAutomationValueChange(deck.id, "eqLow", value);
                        }}
                        onPreset={(preset) => onAutomationPreset(deck.id, "eqLow", preset, -18, 18)}
                        onInvert={() => onAutomationInvert(deck.id, "eqLow", -18, 18)}
                        onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqLow", factor)}
                        onAmplitudeScale={(factor) =>
                          onAutomationAmplitudeScale(deck.id, "eqLow", factor, -18, 18)
                        }
                        onDurationChange={(durationSec) =>
                          onAutomationDurationChange(deck.id, "eqLow", durationSec)
                        }
                      />
                    </div>
                    <div className="deck__eq3-section">
                      <Knob
                        label="Mid"
                        min={-18}
                        max={18}
                        step={0.1}
                        value={eqMidValue}
                        defaultValue={0}
                        labelTitle="Mid‑band EQ. Boost presence or cut boxiness."
                        onChange={(next) => {
                          activateEq3Mode();
                          onEqMidChange(deck.id, next);
                        }}
                        formatValue={formatEq}
                        centerSnap={0.25}
                        isAutomated={eqMidAutomation.active}
                      />
                      <AutomationLane
                        label="Mid Auto"
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
                        onDrawStart={() => {
                          activateEq3Mode();
                          onAutomationStart(deck.id, "eqMid");
                        }}
                        onDrawEnd={() => onAutomationStop(deck.id, "eqMid")}
                        onReset={() => onAutomationReset(deck.id, "eqMid")}
                        onToggleActive={(next) => {
                          activateEq3Mode();
                          onAutomationToggle(deck.id, "eqMid", next);
                        }}
                        onDrawValueChange={(value) => {
                          activateEq3Mode();
                          onAutomationValueChange(deck.id, "eqMid", value);
                        }}
                        onPreset={(preset) => onAutomationPreset(deck.id, "eqMid", preset, -18, 18)}
                        onInvert={() => onAutomationInvert(deck.id, "eqMid", -18, 18)}
                        onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqMid", factor)}
                        onAmplitudeScale={(factor) =>
                          onAutomationAmplitudeScale(deck.id, "eqMid", factor, -18, 18)
                        }
                        onDurationChange={(durationSec) =>
                          onAutomationDurationChange(deck.id, "eqMid", durationSec)
                        }
                      />
                    </div>
                    <div className="deck__eq3-section">
                      <Knob
                        label="High"
                        min={-18}
                        max={18}
                        step={0.1}
                        value={eqHighValue}
                        defaultValue={0}
                        labelTitle="High‑shelf EQ. Positive adds air, negative tames brightness."
                        onChange={(next) => {
                          activateEq3Mode();
                          onEqHighChange(deck.id, next);
                        }}
                        formatValue={formatEq}
                        centerSnap={0.25}
                        isAutomated={eqHighAutomation.active}
                      />
                      <AutomationLane
                        label="High Auto"
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
                        onDrawStart={() => {
                          activateEq3Mode();
                          onAutomationStart(deck.id, "eqHigh");
                        }}
                        onDrawEnd={() => onAutomationStop(deck.id, "eqHigh")}
                        onReset={() => onAutomationReset(deck.id, "eqHigh")}
                        onToggleActive={(next) => {
                          activateEq3Mode();
                          onAutomationToggle(deck.id, "eqHigh", next);
                        }}
                        onDrawValueChange={(value) => {
                          activateEq3Mode();
                          onAutomationValueChange(deck.id, "eqHigh", value);
                        }}
                        onPreset={(preset) => onAutomationPreset(deck.id, "eqHigh", preset, -18, 18)}
                        onInvert={() => onAutomationInvert(deck.id, "eqHigh", -18, 18)}
                        onLengthScale={(factor) => onAutomationLengthScale(deck.id, "eqHigh", factor)}
                        onAmplitudeScale={(factor) =>
                          onAutomationAmplitudeScale(deck.id, "eqHigh", factor, -18, 18)
                        }
                        onDurationChange={(durationSec) =>
                          onAutomationDurationChange(deck.id, "eqHigh", durationSec)
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="deck__fx-row deck__fx-row--single">
          <div
            className={`deck__fx-unit deck__fx-unit--vocoder deck__fx-unit--span-2 ${fxPanelOpen.vocoder ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.vocoder}
              onClick={() => toggleFxPanel("vocoder")}
            >
              {renderFxToggleLabel("vocoder", "Vocoder")}
            </button>
            <div className="deck__fx-controls-grid deck__fx-controls-grid--cols-4">
              <Knob
                className="knob--compact"
                label="Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.vocoderMix}
                defaultValue={0}
                labelTitle="Wet/dry mix for deck-to-deck vocoding."
                onChange={(next) => onVocoderMixChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderMix")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderMix", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "vocoderMix")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Monitor"
                min={0}
                max={1}
                step={0.01}
                value={deck.vocoderModulatorMonitor}
                defaultValue={0}
                labelTitle="Controls how much of the linked modulator deck is audible in the mix. 0 = fully muted."
                onChange={(next) => onVocoderModulatorMonitorChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderModulatorMonitor")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderModulatorMonitor", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderModulatorMonitor")
                }
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Mod Drive"
                min={0.5}
                max={10}
                step={0.01}
                value={deck.vocoderModDrive}
                defaultValue={2}
                labelTitle="Boosts modulator envelope sensitivity for stronger/louder vocoder articulation."
                onChange={(next) => onVocoderModDriveChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderModDrive")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderModDrive", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "vocoderModDrive")}
                formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)}x`}
              />
              <Knob
                className="knob--compact"
                label="Bands"
                min={4}
                max={24}
                step={1}
                value={deck.vocoderBandCount}
                defaultValue={12}
                labelTitle="Number of analysis/synthesis bands."
                onChange={(next) => onVocoderBandCountChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderBandCount")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderBandCount", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "vocoderBandCount")}
                formatValue={(value) => `${Math.round(value)}`}
              />
              <Knob
                className="knob--compact"
                label="Vocal Character"
                min={0}
                max={3}
                step={0.01}
                value={deck.vocoderVocalCharacter}
                defaultValue={1}
                labelTitle="Controls formant emphasis intensity. Higher values exaggerate vowel-like vocal articulation."
                onChange={(next) => onVocoderVocalCharacterChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderVocalCharacter")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderVocalCharacter", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderVocalCharacter")
                }
                formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)}x`}
              />
              <Knob
                className="knob--compact"
                label="Formant Shift"
                min={-12}
                max={12}
                step={0.1}
                value={deck.vocoderFormantShift}
                defaultValue={0}
                labelTitle="Shifts vocoder formants up/down in semitones for brighter or darker vocal color."
                onChange={(next) => onVocoderFormantShiftChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderFormantShift")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderFormantShift", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderFormantShift")
                }
                formatValue={(value, fine) => `${value.toFixed(fine ? 2 : 1)} st`}
              />
              <Knob
                className="knob--compact"
                label="Pre-Emphasis"
                min={0}
                max={1}
                step={0.01}
                value={deck.vocoderPreEmphasis}
                defaultValue={0.45}
                labelTitle="Brightens the modulator before envelope extraction to improve intelligibility."
                onChange={(next) => onVocoderPreEmphasisChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderPreEmphasis")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderPreEmphasis", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderPreEmphasis")
                }
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Tightness"
                min={0}
                max={1}
                step={0.01}
                value={deck.vocoderTightness}
                defaultValue={0.35}
                labelTitle="Shortens envelope attack/release for sharper, speech-like articulation."
                onChange={(next) => onVocoderTightnessChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderTightness")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderTightness", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderTightness")
                }
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Attack"
                min={1}
                max={160}
                step={1}
                value={deck.vocoderAttackMs}
                defaultValue={8}
                labelTitle="Envelope attack time in milliseconds."
                onChange={(next) => onVocoderAttackMsChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderAttackMs")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderAttackMs", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "vocoderAttackMs")}
                formatValue={(value) => `${Math.round(value)} ms`}
              />
              <Knob
                className="knob--compact"
                label="Release"
                min={1}
                max={1200}
                step={1}
                value={deck.vocoderReleaseMs}
                defaultValue={5}
                labelTitle="Envelope release time in milliseconds."
                onChange={(next) => onVocoderReleaseMsChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderReleaseMs")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderReleaseMs", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderReleaseMs")
                }
                formatValue={(value) => `${Math.round(value)} ms`}
              />
              <Knob
                className="knob--compact"
                label="Phase Rotate"
                min={0}
                max={1}
                step={0.01}
                value={deck.vocoderNoiseMix}
                defaultValue={0}
                labelTitle="Continuously rotates vocoder band phases in a loop."
                onChange={(next) => onVocoderPhaseRotateChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderNoiseMix")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderNoiseMix", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "vocoderNoiseMix")}
                formatValue={(value, fine) => {
                  if (value <= 1e-6) return "Off";
                  const durationSec = 16 + value * (0.25 - 16);
                  return `${durationSec.toFixed(fine ? 2 : 1)}s`;
                }}
              />
              <Knob
                className="knob--compact"
                label="Gate"
                min={0}
                max={1}
                step={0.01}
                value={deck.vocoderGateThreshold}
                defaultValue={0.5}
                labelTitle="Envelope gate threshold to suppress low-level chatter."
                onChange={(next) => onVocoderGateThresholdChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("vocoderGateThreshold")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "vocoderGateThreshold", value, baseline, recording)
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "vocoderGateThreshold")
                }
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
            </div>
            <div className="deck__delay-options deck__fx-footer">
              <label className="deck__delay-toggle" title="Modulator deck used to imprint its envelope onto this deck.">
                <span>Modulator</span>
                <select
                  value={deck.vocoderCarrierDeckId ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    onVocoderCarrierDeckIdChange(deck.id, raw ? Number(raw) : null);
                  }}
                >
                  <option value="">None</option>
                  {carrierDeckOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="deck__delay-toggle"
                title="Process vocoder after delay so delayed signal is vocoded instead of delaying the vocoded signal."
              >
                <span>Post Delay</span>
                <input
                  type="checkbox"
                  checked={deck.vocoderPostDelay}
                  onChange={(event) =>
                    onVocoderPostDelayChange(deck.id, event.target.checked)
                  }
                />
              </label>
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--delay deck__fx-unit--span-2 ${fxPanelOpen.delay ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.delay}
              onClick={() => toggleFxPanel("delay")}
            >
              {renderFxToggleLabel("delay", "Delay")}
            </button>
            <div className="deck__fx-controls-grid deck__fx-controls-grid--cols-4">
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
                isSimpleAutomated={isSimpleAutomated("delayMix")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayMix", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayMix")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
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
                isSimpleAutomated={isSimpleAutomated("delayTime")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayTime", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayTime")}
                formatValue={(value, fine) => `${value.toFixed(fine ? 3 : 1)}s`}
                disabled={deck.delaySliceSync}
              />
              <Knob
                className="knob--compact"
                label="Feedback"
                min={0}
                max={0.99}
                step={0.01}
                value={deck.delayFeedback}
                defaultValue={0.35}
                labelTitle="Feedback amount. Higher values create more repeats."
                onChange={(next) => onDelayFeedbackChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delayFeedback")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayFeedback", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayFeedback")}
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
                isSimpleAutomated={isSimpleAutomated("delayTone")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayTone", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayTone")}
                formatValue={(value, fine) => `${value.toFixed(fine ? 1 : 0)} Hz`}
              />
              <Knob
                className="knob--compact"
                label="Drive FB"
                min={0}
                max={1}
                step={0.01}
                value={deck.delaySaturation ?? 0}
                defaultValue={0}
                labelTitle="Drive in the feedback loop so repeats progressively degrade."
                onChange={(next) => onDelaySaturationChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delaySaturation")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delaySaturation", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delaySaturation")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Damping"
                min={0}
                max={1}
                step={0.01}
                value={deck.delayDamping ?? 0}
                defaultValue={0}
                labelTitle="Extra high-frequency damping per repeat for smoother, less brittle tails."
                onChange={(next) => onDelayDampingChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delayDamping")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayDamping", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayDamping")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Safety"
                min={0}
                max={1}
                step={0.01}
                value={deck.delaySafety ?? 0}
                defaultValue={0}
                labelTitle="Safety compressor plus feedback ceiling trim to keep high-feedback loops controlled without added drive."
                onChange={(next) => onDelaySafetyChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delaySafety")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delaySafety", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delaySafety")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Pitch Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.delayRhythmMorph ?? 0}
                defaultValue={0}
                labelTitle="Blend amount for pitch shifting inside the feedback loop."
                onChange={(next) => onDelayRhythmMorphChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delayRhythmMorph")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayRhythmMorph", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayRhythmMorph")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Pitch Step"
                min={-12}
                max={12}
                step={0.01}
                value={deck.delayRhythmRateHz ?? 0}
                defaultValue={0}
                labelTitle="Semitone interval applied per repeat (+3, -5, octave, etc.)."
                onChange={(next) => onDelayRhythmRateHzChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delayRhythmRateHz")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delayRhythmRateHz", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delayRhythmRateHz")}
                formatValue={(value, fine) => `${value >= 0 ? "+" : ""}${value.toFixed(fine ? 2 : 1)} st`}
              />
              <Knob
                className="knob--compact"
                label="Spectral Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.delaySpectralMix ?? 0}
                defaultValue={0}
                labelTitle="Blend in 3-band spectral delay branch."
                onChange={(next) => onDelaySpectralMixChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delaySpectralMix")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delaySpectralMix", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delaySpectralMix")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Spectral Spread"
                min={0}
                max={1}
                step={0.01}
                value={deck.delaySpectralSpread ?? 0.35}
                defaultValue={0.35}
                labelTitle="Separates spectral band delay times/pans for prism-like repeats."
                onChange={(next) => onDelaySpectralSpreadChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delaySpectralSpread")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delaySpectralSpread", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delaySpectralSpread")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Spectral Motion"
                min={0}
                max={1}
                step={0.01}
                value={deck.delaySpectralMotion ?? 0.2}
                defaultValue={0.2}
                labelTitle="Adds slow movement to spectral band panning and delay offsets."
                onChange={(next) => onDelaySpectralMotionChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("delaySpectralMotion")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "delaySpectralMotion", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "delaySpectralMotion")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
            </div>
            <div className="deck__delay-options deck__fx-footer">
              <button
                type="button"
                className="deck__action deck__delay-tap"
                onClick={handleDelayTap}
                title="Tap repeatedly to set delay time from your tap interval."
              >
                Tap
              </button>
              <label
                className="deck__delay-toggle"
                title="Cross-feed delay repeats between left and right channels."
              >
                <span>Ping Pong</span>
                <input
                  type="checkbox"
                  checked={deck.delayPingPong}
                  onChange={(event) =>
                    onDelayPingPongChange(deck.id, event.target.checked)
                  }
                />
              </label>
              <label
                className="deck__delay-toggle"
                title="Match delay time to the currently playing rearranger slice length. When enabled, the Time knob is disabled."
              >
                <span>Slice Sync</span>
                <input
                  type="checkbox"
                  checked={deck.delaySliceSync}
                  onChange={(event) =>
                    onDelaySliceSyncChange(deck.id, event.target.checked)
                  }
                />
              </label>
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--spectral-space deck__fx-unit--span-2 ${fxPanelOpen.spectralSpace ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.spectralSpace}
              onClick={() => toggleFxPanel("spectralSpace")}
            >
              {renderFxToggleLabel("spectralSpace", "Spectral Space")}
            </button>
            <div className="deck__fx-controls-grid deck__fx-controls-grid--cols-4">
              <Knob
                className="knob--compact"
                label="Mix"
                min={0}
                max={1}
                step={0.01}
                value={deck.spectralSpaceMix ?? 0}
                defaultValue={0}
                labelTitle="Wet/dry mix of the Spectral Space processor."
                onChange={(next) => onSpectralSpaceMixChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("spectralSpaceMix")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "spectralSpaceMix", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "spectralSpaceMix")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Spread"
                min={0}
                max={1}
                step={0.01}
                value={deck.spectralSpaceSpread ?? 0.35}
                defaultValue={0.35}
                labelTitle="Band separation and stereo widening amount."
                onChange={(next) => onSpectralSpaceSpreadChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("spectralSpaceSpread")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "spectralSpaceSpread", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "spectralSpaceSpread")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Motion"
                min={0}
                max={1}
                step={0.01}
                value={deck.spectralSpaceMotion ?? 0.25}
                defaultValue={0.25}
                labelTitle="LFO movement depth for micro-delay/pan motion."
                onChange={(next) => onSpectralSpaceMotionChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("spectralSpaceMotion")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "spectralSpaceMotion", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "spectralSpaceMotion")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Tilt"
                min={-1}
                max={1}
                step={0.01}
                value={deck.spectralSpaceTilt ?? 0}
                defaultValue={0}
                labelTitle="Bias energy darker (negative) or brighter (positive)."
                onChange={(next) => onSpectralSpaceTiltChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("spectralSpaceTilt")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "spectralSpaceTilt", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "spectralSpaceTilt")}
                formatValue={(value, fine) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(fine ? 2 : 1)}%`}
                centerSnap={0.03}
              />
              <Knob
                className="knob--compact"
                label="Low Mono"
                min={0}
                max={1}
                step={0.01}
                value={deck.spectralSpaceLowMono ?? 0.6}
                defaultValue={0.6}
                labelTitle="Keeps low frequencies centered while highs can stay wide."
                onChange={(next) => onSpectralSpaceLowMonoChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("spectralSpaceLowMono")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "spectralSpaceLowMono", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "spectralSpaceLowMono")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Transient"
                min={0}
                max={1}
                step={0.01}
                value={deck.spectralSpaceTransientProtect ?? 0.35}
                defaultValue={0.35}
                labelTitle="Ducks spectral wet signal on strong transients for clarity."
                onChange={(next) => onSpectralSpaceTransientProtectChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("spectralSpaceTransientProtect")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(
                    deck.id,
                    "spectralSpaceTransientProtect",
                    value,
                    baseline,
                    recording
                  )
                }
                onSimpleAutomationClear={() =>
                  onSimpleAutomationClear(deck.id, "spectralSpaceTransientProtect")
                }
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--rearranger deck__fx-unit--span-3 ${fxPanelOpen.rearranger ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.rearranger}
              onClick={() => toggleFxPanel("rearranger")}
              title="Toggle Rearranger panel. (R)"
            >
              {renderFxToggleLabel("rearranger", "Rearranger")}
            </button>
            <div className="deck__fx-controls-grid deck__fx-controls-grid--cols-5">
              <Knob
                className="knob--compact"
                label="Slices"
                min={0}
                max={Math.max(64, Math.round(deck.rearrangerSlices || 0))}
                step={1}
                value={deck.rearrangerSlices}
                defaultValue={0}
                labelTitle="Number of slices. You can also click between waveform boundaries to add slices, or hold Shift and click a slice region to destructively remove it."
                onChange={handleRearrangerSlicesKnobChange}
                formatValue={(value) => {
                  const rounded = Math.round(value);
                  return rounded <= 0 ? "Off" : `${rounded}`;
                }}
              />
              <Knob
                className="knob--compact"
                label="Swaps"
                min={0}
                max={Math.max(64, Math.round(deck.rearrangerSlices || 0))}
                step={1}
                value={deck.rearrangerSwapCount}
                defaultValue={0}
                labelTitle="Number of slices to swap each pass."
                onChange={(next) => onRearrangerSwapCountChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("rearrangerSwapCount")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "rearrangerSwapCount", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "rearrangerSwapCount")}
                formatValue={(value) => `${Math.round(value)}`}
              />
              <Knob
                className="knob--compact"
                label="Chaos"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerChaos}
                defaultValue={0}
                labelTitle="How far swaps can travel. Low stays local, high can jump anywhere."
                onChange={(next) => onRearrangerChaosChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("rearrangerChaos")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "rearrangerChaos", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "rearrangerChaos")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Reverse"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerReverse}
                defaultValue={0}
                labelTitle="Chance each slice is reversed."
                onChange={(next) => onRearrangerReverseChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("rearrangerReverse")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "rearrangerReverse", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "rearrangerReverse")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Sensitivity"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerSensitivity}
                defaultValue={0.6}
                labelTitle="Auto Slice sensitivity. Higher values detect quieter/smaller onset changes and create more slices."
                onChange={(next) => onRearrangerSensitivityChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Quiet Thresh"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerQuietThreshold}
                defaultValue={0.3}
                labelTitle="Delete Quiet threshold. Higher values classify more of the loop as quiet."
                onChange={(next) => onRearrangerQuietThresholdChange(deck.id, next)}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <Knob
                className="knob--compact"
                label="Slice Fade"
                min={0}
                max={12}
                step={1}
                value={deck.rearrangerSliceFadeMs}
                defaultValue={0}
                labelTitle="Short fades on slice edges to reduce clicks."
                onChange={(next) => onRearrangerSliceFadeChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("rearrangerSliceFadeMs")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "rearrangerSliceFadeMs", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "rearrangerSliceFadeMs")}
                formatValue={(value) => `${Math.round(value)} ms`}
              />
              <Knob
                className="knob--compact"
                label="Slice Delay"
                min={0}
                max={5}
                step={0.01}
                value={deck.rearrangerSliceDelaySec}
                defaultValue={0}
                labelTitle="Simulates a short hold between slices during live playback (non-destructive, FX tails keep processing) and is baked in offline renders."
                onChange={(next) => onRearrangerSliceDelayChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("rearrangerSliceDelaySec")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "rearrangerSliceDelaySec", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "rearrangerSliceDelaySec")}
                formatValue={(value) => `${value.toFixed(2)}s`}
              />
              <Knob
                className="knob--compact"
                label="Ping Pong"
                min={0}
                max={1}
                step={0.01}
                value={deck.rearrangerPingPong}
                defaultValue={0}
                labelTitle="Alternates slices between left and right. 0 = centered/no processing, 1 = full L/R ping pong."
                onChange={(next) => onRearrangerPingPongChange(deck.id, next)}
                isSimpleAutomated={isSimpleAutomated("rearrangerPingPong")}
                onSimpleAutomationSet={(value, baseline, recording) =>
                  onSimpleAutomationSet(deck.id, "rearrangerPingPong", value, baseline, recording)
                }
                onSimpleAutomationClear={() => onSimpleAutomationClear(deck.id, "rearrangerPingPong")}
                formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
              />
              <label
                className="deck__delay-toggle"
                title="When enabled, the current loop is rearranged again each time playback wraps to the loop start."
              >
                <span>On Loop</span>
                <input
                  type="checkbox"
                  checked={deck.rearrangerAuto}
                  onChange={(event) => onRearrangerAutoChange(deck.id, event.target.checked)}
                />
              </label>
              <label
                className="deck__delay-toggle"
                title="When enabled, changing the Slices knob re-detects slice boundaries from loop transients."
              >
                <span>Auto Slice</span>
                <input
                  type="checkbox"
                  checked={Boolean(deck.buffer) && autoSliceEnabled}
                  disabled={!deck.buffer}
                  onChange={(event) => handleAutoSliceToggle(event.target.checked)}
                />
              </label>
            </div>
            <div className="deck__fx-actions deck__fx-footer">
              <div className="deck__rearranger-actions deck__rearranger-actions--left">
                <button
                  type="button"
                  className={`deck__action ${hasRearrangerSnapshot ? "is-active" : ""}`.trim()}
                  disabled={!deck.buffer}
                  onClick={handleSnapshotCapture}
                  title="Capture current audio and slice state so you can restore it later."
                >
                  {snapshotSavedFlash ? "Snapshot Saved" : "Snapshot"}
                </button>
                <button
                  type="button"
                  className="deck__action"
                  disabled={!hasRearrangerSnapshot}
                  onClick={handleSnapshotRestore}
                  title="Restore the last rearranger snapshot for this deck."
                >
                  Restore
                </button>
                {hasRearrangerSnapshot && snapshotCapturedLabel ? (
                  <span className="deck__snapshot-meta" title={`Snapshot saved ${snapshotCapturedLabel}`}>
                    Saved {snapshotCapturedLabel}
                  </span>
                ) : null}
              </div>
              <div className="deck__rearranger-actions deck__rearranger-actions--right">
                <button
                  type="button"
                  className="deck__action"
                  disabled={!deck.buffer}
                  onClick={() => onRearrangerTrimQuiet(deck.id)}
                  onPointerEnter={() => setShowQuietDeletePreview(true)}
                  onPointerLeave={() => setShowQuietDeletePreview(false)}
                  onFocus={() => setShowQuietDeletePreview(true)}
                  onBlur={() => setShowQuietDeletePreview(false)}
                  title="Detect quiet sections in the loop and destructively remove them."
                >
                  Delete Quiet
                </button>
                <AsyncActionButton
                  className="deck__action"
                  disabled={!deck.buffer}
                  idleLabel="Rearrange Loop"
                  busyLabel="Rearranging..."
                  onAction={() => onRearrangeLoop(deck.id)}
                />
              </div>
            </div>
          </div>
          <div
            className={`deck__fx-unit deck__fx-unit--stretch deck__fx-unit--span-2 ${fxPanelOpen.stretch ? "" : "is-collapsed"}`.trim()}
          >
            <button
              type="button"
              className="deck__fx-unit-toggle"
              aria-expanded={fxPanelOpen.stretch}
              onClick={() => toggleFxPanel("stretch")}
            >
              {renderFxToggleLabel("stretch", "Stretch")}
            </button>
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
              <div className="deck__fx-controls-grid deck__fx-controls-grid--cols-4">
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
            <div className="deck__fx-actions deck__fx-footer">
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
  );
};

export default DeckCardFxRack;
