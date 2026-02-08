import type { ChangeEvent, RefObject } from "react";
import AsyncActionButton from "./AsyncActionButton";
import Knob from "./Knob";

type SessionOption = {
  id: string;
  name: string;
};

type PerfStats = {
  fps: number;
  frameMs: number;
  heapUsedMB: number | null;
  heapLimitMB: number | null;
};

type AppHeaderProps = {
  debugPerf: boolean;
  perfStats: PerfStats;
  sessionName: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddDeck: () => void;
  onNewSession: () => void;
  onGlobalPlaybackToggle: () => void;
  hasActivePlayback: boolean;
  recording: boolean;
  savingRecording: boolean;
  onRecordToggle: () => void;
  showSessionPanel: boolean;
  onToggleSessionPanel: () => void;
  deckLayoutMode: "single" | "two";
  onToggleDeckLayout: () => void;
  masterGain: number;
  onMasterGainChange: (value: number) => void;
  onOpenKeyboardShortcuts: () => void;
  showKeyboardShortcuts: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  importInputRef: RefObject<HTMLInputElement>;
  onImportChange: (event: ChangeEvent<HTMLInputElement>) => void;
  sessionBusy: boolean;
  onSaveSession: () => void;
  sessions: SessionOption[];
  selectedSessionId: string | null;
  onSelectedSessionIdChange: (value: string | null) => void;
  onLoadSession: () => void;
  onExportSession: () => void;
  onImportClick: () => void;
  exportMinutes: number;
  exportSeconds: number;
  onExportMinutesChange: (value: number) => void;
  onExportSecondsChange: (value: number) => void;
  onExportMix: () => Promise<void>;
  exporting: boolean;
  exportEstimateLabel: string | null;
  onSessionNameChange: (value: string) => void;
};

const AppHeader = ({
  debugPerf,
  perfStats,
  sessionName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddDeck,
  onNewSession,
  onGlobalPlaybackToggle,
  hasActivePlayback,
  recording,
  savingRecording,
  onRecordToggle,
  showSessionPanel,
  onToggleSessionPanel,
  deckLayoutMode,
  onToggleDeckLayout,
  masterGain,
  onMasterGainChange,
  onOpenKeyboardShortcuts,
  showKeyboardShortcuts,
  theme,
  onToggleTheme,
  importInputRef,
  onImportChange,
  sessionBusy,
  onSaveSession,
  sessions,
  selectedSessionId,
  onSelectedSessionIdChange,
  onLoadSession,
  onExportSession,
  onImportClick,
  exportMinutes,
  exportSeconds,
  onExportMinutesChange,
  onExportSecondsChange,
  onExportMix,
  exporting,
  exportEstimateLabel,
  onSessionNameChange,
}: AppHeaderProps) => (
  <header className="app__header">
    <div className="app__header-row app__header-row--primary">
      <div className="app__brand">Loop Loop Loop</div>
      <div className="app__project">
        {sessionName.trim() ? `Project: ${sessionName}` : "Project: Untitled"}
      </div>
      {debugPerf ? (
        <div className="perf-panel" aria-live="polite">
          <span className="perf-panel__label">Perf</span>
          <span className="perf-panel__metric">{perfStats.fps} fps</span>
          <span className="perf-panel__metric">{perfStats.frameMs} ms</span>
          {perfStats.heapUsedMB !== null && perfStats.heapLimitMB !== null && (
            <span className="perf-panel__metric">
              heap {perfStats.heapUsedMB}/{perfStats.heapLimitMB} MB
            </span>
          )}
        </div>
      ) : null}
      <div className="app__header-actions">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd/Ctrl+Z)"
          aria-label="Undo"
        >
          ←
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd/Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          →
        </button>
        <button type="button" onClick={onAddDeck} title="Add deck (A)">
          Add Deck
        </button>
        <button type="button" onClick={onNewSession} title="New session">
          New
        </button>
        <button
          type="button"
          onClick={onGlobalPlaybackToggle}
          title="Global play/pause (Shift+Space)"
        >
          {hasActivePlayback ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="transport__record"
          data-active={recording ? "true" : "false"}
          onClick={onRecordToggle}
          disabled={savingRecording}
        >
          {savingRecording ? "Saving Recording..." : recording ? "Stop Recording" : "Record"}
          <span
            className="transport__record-indicator"
            aria-hidden={!recording}
            data-active={recording ? "true" : "false"}
          />
        </button>
      </div>
      <div className="app__header-right">
        <button
          type="button"
          className={showSessionPanel ? "is-active" : undefined}
          onClick={onToggleSessionPanel}
          aria-expanded={showSessionPanel}
          title="Show session restore and export controls"
        >
          Restore + Export
        </button>
        <button
          type="button"
          onClick={onToggleDeckLayout}
          title={
            deckLayoutMode === "single"
              ? "Switch deck layout to 2 columns."
              : "Switch deck layout to full single column."
          }
        >
          {deckLayoutMode === "single" ? "2 Col" : "1 Col"}
        </button>
        <div className="app__header-master" title="Master Gain">
          <Knob
            label="Master"
            min={0}
            max={1.5}
            step={0.01}
            value={masterGain}
            defaultValue={0.9}
            className="knob--compact knob--tiny knob--icon-only app__header-knob"
            labelTitle="Controls global output level after all decks. Affects monitoring and recording."
            onChange={onMasterGainChange}
          />
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onOpenKeyboardShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Toggle keyboard shortcuts"
          aria-pressed={showKeyboardShortcuts}
        >
          ?
        </button>
        <button
          type="button"
          className="icon-button app__theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
              <line x1="4.2" y1="4.2" x2="6.4" y2="6.4" />
              <line x1="17.6" y1="17.6" x2="19.8" y2="19.8" />
              <line x1="17.6" y1="6.4" x2="19.8" y2="4.2" />
              <line x1="4.2" y1="19.8" x2="6.4" y2="17.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z" />
            </svg>
          )}
        </button>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        onChange={onImportChange}
        className="session-bar__input"
      />
    </div>
    {showSessionPanel ? (
      <div className="app__header-row app__header-row--session">
        <div className="session-bar__panel">
          <div className="session-bar__details-body">
            <div className="session-bar__section">
              <div className="app__header-hint">
                Sessions save inside this browser. Export creates a shareable zip.
              </div>
              <label className="session-bar__field">
                <span>Session Name</span>
                <input
                  type="text"
                  value={sessionName}
                  onChange={(event) => onSessionNameChange(event.target.value)}
                  placeholder="Name this session"
                />
              </label>
              <div className="session-bar__group session-bar__group--save">
                <button
                  type="button"
                  onClick={onSaveSession}
                  disabled={sessionBusy}
                  title="Save session (Cmd/Ctrl+S)"
                >
                  Save Session
                </button>
              </div>
            </div>
            <div className="session-bar__section">
              <label className="session-bar__field">
                <span>Load Saved Session</span>
                <select
                  value={selectedSessionId ?? ""}
                  onChange={(event) => onSelectedSessionIdChange(event.target.value || null)}
                  disabled={sessions.length === 0}
                >
                  <option value="">Select a session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="session-bar__group session-bar__group--restore">
                <button
                  type="button"
                  onClick={onLoadSession}
                  disabled={sessionBusy || sessions.length === 0}
                  title="Open session (Cmd/Ctrl+O)"
                >
                  Load Session
                </button>
              </div>
            </div>
            <div className="session-bar__section">
              <div className="session-bar__group session-bar__group--export">
                <button type="button" onClick={onExportSession} disabled={sessionBusy}>
                  Export Zip
                </button>
                <button type="button" onClick={onImportClick} disabled={sessionBusy}>
                  Import Zip
                </button>
              </div>
            </div>
            <div className="session-bar__section">
              <div className="session-bar__group session-bar__group--mix">
                <div className="transport__export">
                  <label>
                    Minutes
                    <input
                      type="number"
                      min="0"
                      max="60"
                      step="1"
                      value={exportMinutes}
                      onChange={(event) => onExportMinutesChange(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    Seconds
                    <input
                      type="number"
                      min="0"
                      max="59"
                      step="1"
                      value={exportSeconds}
                      onChange={(event) => onExportSecondsChange(Number(event.target.value))}
                    />
                  </label>
                  <AsyncActionButton
                    onAction={onExportMix}
                    disabled={exporting}
                    busy={exporting}
                    idleLabel="Export Mix"
                    busyLabel="Exporting..."
                  />
                  {exportEstimateLabel ? (
                    <span className="transport__estimate">{exportEstimateLabel}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null}
  </header>
);

export default AppHeader;
