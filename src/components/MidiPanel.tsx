import { useMemo, useState } from "react";
import { MIDI_ACTIONS, type MidiActionId, type MidiBinding, type MidiLearnMode } from "../types/midi";

type MidiInputSummary = {
  id: string;
  name: string;
  state: "connected" | "disconnected";
};

type MidiOutputSummary = {
  id: string;
  name: string;
  state: "connected" | "disconnected";
};

type MidiPanelProps = {
  supported: boolean;
  accessGranted: boolean;
  accessError: string | null;
  onRequestAccess: () => void;
  inputs: MidiInputSummary[];
  outputs: MidiOutputSummary[];
  selectedInputId: string | null;
  onSelectedInputIdChange: (id: string | null) => void;
  selectedOutputId: string | null;
  onSelectedOutputIdChange: (id: string | null) => void;
  focusedDeckLabel: string;
  mappings: MidiBinding[];
  learnTarget: { actionId: MidiActionId; mode: MidiLearnMode } | null;
  onBeginLearn: (actionId: MidiActionId, mode: MidiLearnMode) => void;
  onCancelLearn: () => void;
  onRemoveMapping: (id: string) => void;
  onClearMappings: () => void;
  showTwisterMode: boolean;
  twisterModeEnabled: boolean;
  onToggleTwisterMode: () => void;
  learnModeEnabled: boolean;
  onToggleLearnMode: () => void;
};

const MidiPanel = ({
  supported,
  accessGranted,
  accessError,
  onRequestAccess,
  inputs,
  outputs,
  selectedInputId,
  onSelectedInputIdChange,
  selectedOutputId,
  onSelectedOutputIdChange,
  focusedDeckLabel,
  mappings,
  learnTarget,
  onBeginLearn,
  onCancelLearn,
  onRemoveMapping,
  onClearMappings,
  showTwisterMode,
  twisterModeEnabled,
  onToggleTwisterMode,
  learnModeEnabled,
  onToggleLearnMode,
}: MidiPanelProps) => {
  const [actionId, setActionId] = useState<MidiActionId>("deck.gain");
  const [mode, setMode] = useState<MidiLearnMode>("absolute");
  const [expanded, setExpanded] = useState(true);

  const selectedInputName = useMemo(
    () => inputs.find((input) => input.id === selectedInputId)?.name ?? "All Inputs",
    [inputs, selectedInputId]
  );
  const mappingsWithLabels = useMemo(
    () =>
      mappings.map((mapping) => ({
        ...mapping,
        actionLabel:
          MIDI_ACTIONS.find((action) => action.id === mapping.actionId)?.label ?? mapping.actionId,
      })),
    [mappings]
  );

  return (
    <section className="midi-panel" aria-label="MIDI controller mapping">
      <div className="midi-panel__header">
        <div className="midi-panel__meta">
          <strong>MIDI</strong>
          <span className="midi-panel__status">
            {supported ? (accessGranted ? "Ready" : "Disconnected") : "Not Supported"}
          </span>
          <span className="midi-panel__deck">Target: {focusedDeckLabel}</span>
        </div>
        <div className="midi-panel__actions">
          <button type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Hide Panel" : "Show Panel"}
          </button>
          <button
            type="button"
            className={learnModeEnabled ? "is-active" : undefined}
            onClick={onToggleLearnMode}
            title="Toggle MIDI click-to-map mode"
          >
            MIDI Learn {learnModeEnabled ? "On" : "Off"}
          </button>
          {showTwisterMode ? (
            <button
              type="button"
              className={twisterModeEnabled ? "is-active" : undefined}
              onClick={onToggleTwisterMode}
              title="Enable dynamic Twister mode (slots 1-15 = module controls, 16 = module select, right-side top/bottom buttons on page-16 mapping = prev/next deck)"
            >
              Twister Mode {twisterModeEnabled ? "On" : "Off"}
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? <div className="midi-panel__body">
        {!supported ? (
          <div className="midi-panel__message">
            Web MIDI is unavailable in this browser. Use Chrome/Edge on localhost or HTTPS.
          </div>
        ) : null}
        {supported && !accessGranted ? (
          <div className="midi-panel__connect">
            <button type="button" onClick={onRequestAccess}>
              Connect MIDI
            </button>
            <span className="midi-panel__message">
              Grant browser access to choose MIDI inputs, outputs, and mappings.
            </span>
          </div>
        ) : null}
        {accessError ? <div className="midi-panel__error">{accessError}</div> : null}
        {supported && accessGranted ? (
          <>
          <div className="midi-panel__row">
            <label>
              Input
              <select
                value={selectedInputId ?? ""}
                onChange={(event) => onSelectedInputIdChange(event.target.value || null)}
              >
                <option value="">All Inputs</option>
                {inputs.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.name} ({input.state})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Output
              <select
                value={selectedOutputId ?? ""}
                onChange={(event) => onSelectedOutputIdChange(event.target.value || null)}
              >
                <option value="">All Outputs</option>
                {outputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.name} ({output.state})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="midi-panel__row">
            <label>
              Action
              <select value={actionId} onChange={(event) => setActionId(event.target.value as MidiActionId)}>
                {MIDI_ACTIONS.map((action) => (
                  <option key={action.id} value={action.id}>
                    {action.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mode
              <select value={mode} onChange={(event) => setMode(event.target.value as MidiLearnMode)}>
                <option value="absolute">Absolute</option>
                <option value="relative">Relative</option>
              </select>
            </label>
            {learnTarget ? (
              <button type="button" onClick={onCancelLearn}>
                Cancel Learn
              </button>
            ) : (
              <button type="button" onClick={() => onBeginLearn(actionId, mode)}>
                Learn
              </button>
            )}
          </div>
          <div className="midi-panel__hint">
            {learnTarget
              ? `Learning ${MIDI_ACTIONS.find((action) => action.id === learnTarget.actionId)?.label ?? learnTarget.actionId} (${learnTarget.mode}) on ${selectedInputName}. Move a control now.`
              : learnModeEnabled
                ? "Learn mode is on. Click any highlighted knob in the UI, then move a hardware control."
                : "Select action + mode, then click Learn and move a hardware control."}
          </div>
          <div className="midi-panel__mappings">
            <div className="midi-panel__mappings-title">
              Mappings ({mappings.length})
              <button type="button" onClick={onClearMappings} disabled={mappings.length === 0}>
                Clear
              </button>
            </div>
            {mappings.length === 0 ? (
              <div className="midi-panel__empty">No mappings yet.</div>
            ) : (
              <ul className="midi-panel__mapping-list">
                {mappingsWithLabels.map((mapping) => (
                  <li key={mapping.id} className="midi-panel__mapping">
                    <div className="midi-panel__mapping-copy">
                      <span className="midi-panel__mapping-action">{mapping.actionLabel}</span>
                      <span className="midi-panel__mapping-source">{mapping.inputName}</span>
                      <div className="midi-panel__mapping-meta">
                        <span>Ch {mapping.channel + 1}</span>
                        <span>
                          {mapping.messageType.toUpperCase()} {mapping.number}
                        </span>
                        <span>{mapping.mode}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => onRemoveMapping(mapping.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>
        ) : null}
      </div> : null}
    </section>
  );
};

export default MidiPanel;
