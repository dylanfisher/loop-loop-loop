import { useCallback, useEffect, useRef, useState } from "react";
import DeckStack from "./components/DeckStack";
import ClipRecorder from "./components/ClipRecorder";
import WelcomePanel from "./components/WelcomePanel";
import AsyncActionButton from "./components/AsyncActionButton";
import Knob from "./components/Knob";
import useDecks from "./hooks/useDecks";
import useAudioEngine from "./hooks/useAudioEngine";
import useSessionManager from "./hooks/useSessionManager";
import useGlobalKeyboardShortcuts from "./hooks/useGlobalKeyboardShortcuts";
import useFocusedDeckActions from "./hooks/useFocusedDeckActions";
import useClipLibrary from "./hooks/useClipLibrary";
import useDeckLoopTools from "./hooks/useDeckLoopTools";
import useRearrangerRuntime from "./hooks/useRearrangerRuntime";
import useRecordingManager from "./hooks/useRecordingManager";
import PerfOverlay from "./components/PerfOverlay";
import { renderMixdownBlob } from "./utils/exportMixdown";
import {
  loadStretchCalibrationState,
  saveStretchCalibrationState,
} from "./utils/stretchEstimate";
import { buildTimestampedAudioFilename, formatEstimateDuration } from "./utils/appHelpers";

type PerformanceMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
};

const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

const App = () => {
  const [exportMinutes, setExportMinutes] = useState(1);
  const [exportSeconds, setExportSeconds] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportEstimateLabel, setExportEstimateLabel] = useState<string | null>(null);
  const [masterGain, setMasterGainValue] = useState(0.9);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [debugPerf, setDebugPerf] = useState(() => {
    if (!import.meta.env.DEV) return false;
    return localStorage.getItem("debugPerf") === "true";
  });
  const [stretchEstimateByDeckId, setStretchEstimateByDeckId] = useState<Record<number, string>>(
    {}
  );
  const [stretchCalibration, setStretchCalibration] = useState(() =>
    loadStretchCalibrationState()
  );
  const [perfStats, setPerfStats] = useState<{
    fps: number;
    frameMs: number;
    heapUsedMB: number | null;
    heapLimitMB: number | null;
  }>({
    fps: 0,
    frameMs: 0,
    heapUsedMB: null,
    heapLimitMB: null,
  });
  const [activeDeckId, setActiveDeckId] = useState<number | null>(null);
  const [scrollToDeckId, setScrollToDeckId] = useState<number | null>(null);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [deckLayoutMode, setDeckLayoutMode] = useState<"single" | "two">("two");
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [showWelcomePanelOverride, setShowWelcomePanelOverride] = useState(false);
  const statusTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    saveStretchCalibrationState(stretchCalibration);
  }, [stretchCalibration]);
  const {
    getMasterStream,
    decodeFile,
    resumeContext,
    suspendContext,
    setMasterGain,
    getAudioContextState,
  } = useAudioEngine();
  useEffect(() => {
    setMasterGain(masterGain);
  }, [masterGain, setMasterGain]);
  const {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    stopDeck,
    setFileInputRef,
    setDeckGain,
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckBalance,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckDelaySliceSync,
    setDeckDelayTimeTransient,
    setDeckPlaybackRateTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
    setDeckPitchShift,
    seekDeck,
    setDeckZoom,
    setDeckLoop,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
    setDeckWidthOverride,
    setDeckStretchRatio,
    setDeckStretchWindowSize,
    setDeckStretchStereoWidth,
    setDeckStretchPhaseRandomness,
    setDeckStretchTiltDb,
    setDeckStretchScatter,
    setDeckRearrangerSlices,
    setDeckRearrangerSwapCount,
    setDeckRearrangerChaos,
    setDeckRearrangerReverse,
    setDeckRearrangerSensitivity,
    setDeckRearrangerQuietThreshold,
    setDeckRearrangerSliceFadeMs,
    setDeckRearrangerSliceDelaySec,
    setDeckRearrangerPingPong,
    setDeckRearrangerAuto,
    setDeckRearrangerRegions,
    setDeckFxPanelOpen,
    setDeckFxPanelsOpen,
    resetDeckFx,
    applyDeckFxPanelStatePatch,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
    applyAutomationPreset,
    adjustAutomationLength,
    adjustAutomationAmplitude,
    invertAutomation,
    setAutomationDuration,
    getDeckPosition,
    getDeckPlaybackSnapshot,
    getAudioCurrentTime,
    getSessionDecks,
    loadSessionDecks,
    resetDecks,
    undo,
    redo,
    canUndo,
    canRedo,
    loadDeckBuffer,
  } = useDecks();
  const {
    clips,
    setClips,
    clipsRef,
    clipIdRef,
    clipNameRef,
    addClip,
    updateClip,
    removeClip,
    handleLoadClipToDeck,
    handleSaveLoopClip,
    handleDuplicateLoop,
    handleCropLoop,
  } = useClipLibrary({
    decks,
    automationState,
    addDeck,
    handleFileSelected,
    loadDeckBuffer,
    setActiveDeckId,
    setScrollToDeckId,
  });
  const {
    sessionBusy,
    sessionStatus,
    setSessionStatus,
    sessionName,
    setSessionName,
    welcomePanelDismissed,
    setWelcomePanelDismissed,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    importInputRef,
    zipDragOver,
    markSkipNextAutosave,
    handleExportSession,
    handleSaveSession,
    handleLoadSession,
    handleNewSession,
    handleImportClick,
    handleImportChange,
    handleOpenDemoLoop,
    handleAppDragEnter,
    handleAppDragOver,
    handleAppDragLeave,
    handleAppDrop,
  } = useSessionManager({
    decks,
    clips,
    clipsRef,
    clipIdRef,
    clipNameRef,
    decodeFile,
    getSessionDecks,
    loadSessionDecks,
    resetDecks,
    masterGain,
    setMasterGainValue,
    applyDeckFxPanelStatePatch,
    setClips,
  });
  const { recording, handleRecordToggle } = useRecordingManager({
    decodeFile,
    getMasterStream,
    sessionName,
  });
  const {
    rearrangeBusyByDeckRef,
    handleStretchLoop,
    handleRearrangeLoop,
    handleDeleteRearrangerSlice,
    handleAutoSliceRearranger,
    handleTrimQuietRearranger,
  } = useDeckLoopTools({
    decks,
    automationState,
    loadDeckBuffer,
    getDeckPlaybackSnapshot,
    markSkipNextAutosave,
    setDeckRearrangerRegions,
    stretchCalibration,
    setStretchEstimateByDeckId,
    setStretchCalibration,
  });
  useEffect(() => {
    if (!sessionStatus) return undefined;
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setSessionStatus(null);
      statusTimeoutRef.current = null;
    }, 3000);
    return () => {
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, [sessionStatus, setSessionStatus]);
  useEffect(() => {
    if (decks.length === 0) {
      setActiveDeckId(null);
      return;
    }
    if (activeDeckId !== null && decks.some((deck) => deck.id === activeDeckId)) {
      return;
    }
    setActiveDeckId(decks[0].id);
  }, [activeDeckId, decks]);
  const isCurrentProjectBrandNew =
    clips.length === 0 &&
    decks.every((deck) => !deck.buffer && !deck.fileName);
  const showWelcomePanel =
    (isCurrentProjectBrandNew && !welcomePanelDismissed) || showWelcomePanelOverride;

  const hasActivePlayback = decks.some((deck) => deck.status === "playing");

  const shouldAnimatePerf = hasActivePlayback || recording;
  const [audioContextState, setAudioContextState] = useState<
    AudioContextState | "uninitialized"
  >(() => getAudioContextState());
  const [audioUnlockError, setAudioUnlockError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(audioContextState === "running");

  const refreshAudioState = useCallback(() => {
    const nextState = getAudioContextState();
    setAudioContextState(nextState);
    if (nextState === "running") {
      setAudioUnlocked(true);
      setAudioUnlockError(null);
    }
  }, [getAudioContextState]);

  const handleEnableAudio = useCallback(async () => {
    try {
      await resumeContext();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Audio resume failed", error);
      }
      setAudioUnlockError("Audio blocked by browser. Tap again or press any key.");
    }
    refreshAudioState();
  }, [refreshAudioState, resumeContext]);

  useEffect(() => {
    let disposed = false;
    const handleGesture = () => {
      if (disposed) return;
      if (getAudioContextState() === "running") return;
      void handleEnableAudio();
    };
    const options = { passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", handleGesture, options);
    window.addEventListener("keydown", handleGesture, options);
    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", handleGesture, options);
      window.removeEventListener("keydown", handleGesture, options);
    };
  }, [getAudioContextState, handleEnableAudio]);

  useEffect(() => {
    if (!shouldAnimatePerf) {
      return undefined;
    }
    let raf = 0;
    let intervalId = 0;
    let frames = 0;
    let lastReport = performance.now();
    const onFrame = () => {
      frames += 1;
      raf = requestAnimationFrame(onFrame);
    };
    raf = requestAnimationFrame(onFrame);
    intervalId = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastReport;
      if (elapsed <= 0) return;
      const fps = Math.round((frames * 1000) / elapsed);
      const frameMs = frames > 0 ? Math.round(elapsed / frames) : 0;
      frames = 0;
      lastReport = now;
      const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
      if (memory) {
        setPerfStats({
          fps,
          frameMs,
          heapUsedMB: Math.round(memory.usedJSHeapSize / 1048576),
          heapLimitMB: Math.round(memory.jsHeapSizeLimit / 1048576),
        });
      } else {
        setPerfStats({ fps, frameMs, heapUsedMB: null, heapLimitMB: null });
      }
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(intervalId);
    };
  }, [shouldAnimatePerf]);

  useEffect(() => {
    if (!audioUnlocked) return;
    if (hasActivePlayback || recording) {
      void resumeContext();
      return;
    }
    void suspendContext();
  }, [audioUnlocked, hasActivePlayback, recording, resumeContext, suspendContext]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
    window.dispatchEvent(new Event("themechange"));
  }, [theme]);

  const exportMixdown = useCallback(async () => {
    if (exporting) return;
    const exportDurationSec = Math.max(
      1,
      Math.round(exportMinutes) * 60 + Math.round(exportSeconds)
    );
    const activeDeckCount = decks.filter((deck) => deck.buffer).length;
    if (activeDeckCount === 0) {
      setSessionStatus("Load at least one deck before exporting.");
      return;
    }
    const estimateSeconds = 2 * (exportDurationSec / 60) * activeDeckCount;
    setExportEstimateLabel(
      `Approx export: ${formatEstimateDuration(estimateSeconds)}`
    );
    setExporting(true);
    try {
      const blob = await renderMixdownBlob({
        decks,
        automationState,
        durationSec: exportDurationSec,
        sessionName,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildTimestampedAudioFilename("loop-loop-loop-export", sessionName, "wav");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
      setExportEstimateLabel(null);
    }
  }, [
    automationState,
    decks,
    exportMinutes,
    exportSeconds,
    exporting,
    setSessionStatus,
    sessionName,
  ]);

  const handleExportMinutesChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(Math.round(value), 0), 60);
    setExportMinutes(clamped);
  }, []);

  const handleExportSecondsChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(Math.round(value), 0), 59);
    setExportSeconds(clamped);
  }, []);

  useRearrangerRuntime({
    decks,
    getDeckPlaybackSnapshot,
    getAudioCurrentTime,
    handleRearrangeLoop,
    rearrangeBusyByDeckRef,
    setDeckPlaybackRateTransient,
    setDeckDelayTimeTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
  });

  const handleDeckActivate = useCallback((deckId: number) => {
    setActiveDeckId(deckId);
  }, []);
  const {
    handleGlobalPlaybackToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckRemove,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    handleFocusedDeckZoom,
  } = useFocusedDeckActions({
    decks,
    activeDeckId,
    pauseDeck,
    playDeck,
    setDeckFxPanelOpen,
    setDeckLoop,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    removeDeck,
    handleCropLoop,
    handleDuplicateLoop,
    setDeckZoom,
    zoomSteps: ZOOM_STEPS,
  });

  useGlobalKeyboardShortcuts({
    addDeck,
    undo,
    redo,
    handleSaveSession,
    handleLoadSession,
    handleGlobalPlaybackToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckRemove,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckZoom,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    setShowKeyboardShortcuts,
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleDebugToggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setDebugPerf((prev) => {
        const next = !prev;
        localStorage.setItem("debugPerf", String(next));
        return next;
      });
    };
    window.addEventListener("keydown", handleDebugToggle);
    return () => window.removeEventListener("keydown", handleDebugToggle);
  }, []);

  return (
    <div
      className={`app ${zipDragOver ? "app--zip-drop-target" : ""}`.trim()}
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={(event) => void handleAppDrop(event)}
    >
      {zipDragOver ? (
        <div className="app__zip-drop-hint" aria-hidden="true">
          Drop session zip to import
        </div>
      ) : null}
      {import.meta.env.DEV && debugPerf ? <PerfOverlay /> : null}
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
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Cmd/Ctrl+Z)"
              aria-label="Undo"
            >
              ←
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Cmd/Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              →
            </button>
            <button type="button" onClick={() => addDeck()} title="Add deck (A)">
              Add Deck
            </button>
            <button type="button" onClick={handleNewSession} title="New session">
              New
            </button>
            <button
              type="button"
              onClick={handleGlobalPlaybackToggle}
              title="Global play/pause (Shift+Space)"
            >
              {hasActivePlayback ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="transport__record"
              data-active={recording ? "true" : "false"}
              onClick={handleRecordToggle}
            >
              {recording ? "Stop Recording" : "Record"}
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
              onClick={() => setShowSessionPanel((prev) => !prev)}
              aria-expanded={showSessionPanel}
              title="Show session restore and export controls"
            >
              Restore + Export
            </button>
            <button
              type="button"
              onClick={() =>
                setDeckLayoutMode((prev) => (prev === "single" ? "two" : "single"))
              }
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
                onChange={setMasterGainValue}
              />
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setShowKeyboardShortcuts(true);
                setShowWelcomePanelOverride(true);
              }}
              title="Keyboard shortcuts (?)"
              aria-label="Toggle keyboard shortcuts"
              aria-pressed={showKeyboardShortcuts}
            >
              ?
            </button>
            <button
              type="button"
              className="icon-button app__theme-toggle"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
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
            onChange={handleImportChange}
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
                      onChange={(event) => setSessionName(event.target.value)}
                      placeholder="Name this session"
                    />
                  </label>
                  <div className="session-bar__group session-bar__group--save">
                    <button
                      type="button"
                      onClick={handleSaveSession}
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
                      onChange={(event) => setSelectedSessionId(event.target.value || null)}
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
                      onClick={handleLoadSession}
                      disabled={sessionBusy || sessions.length === 0}
                      title="Open session (Cmd/Ctrl+O)"
                    >
                      Load Session
                    </button>
                  </div>
                </div>
                <div className="session-bar__section">
                  <div className="session-bar__group session-bar__group--export">
                    <button type="button" onClick={handleExportSession} disabled={sessionBusy}>
                      Export Zip
                    </button>
                    <button type="button" onClick={handleImportClick} disabled={sessionBusy}>
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
                          onChange={(event) =>
                            handleExportMinutesChange(Number(event.target.value))
                          }
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
                          onChange={(event) =>
                            handleExportSecondsChange(Number(event.target.value))
                          }
                        />
                      </label>
                      <AsyncActionButton
                        onAction={exportMixdown}
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

      <main className="app__main">
        {showWelcomePanel ? (
          <WelcomePanel
            onClose={() => {
              setWelcomePanelDismissed(true);
              setShowWelcomePanelOverride(false);
            }}
            onOpenDemoLoop={handleOpenDemoLoop}
          />
        ) : null}
        <ClipRecorder
          decks={decks}
          zipDragActive={zipDragOver}
          clips={clips}
          onLoadClip={handleLoadClipToDeck}
          onAddClip={addClip}
          onUpdateClip={updateClip}
          onRemoveClip={removeClip}
        />
        <DeckStack
          decks={decks}
          layoutMode={deckLayoutMode}
          zipDragActive={zipDragOver}
          activeDeckId={activeDeckId}
          scrollToDeckId={scrollToDeckId}
          onScrollComplete={(id) => {
            if (scrollToDeckId === id) {
              setScrollToDeckId(null);
            }
          }}
          onDeckActivate={handleDeckActivate}
          onRemoveDeck={removeDeck}
          onLoadClick={handleLoadClick}
          onFileSelected={handleFileSelected}
          onPlay={playDeck}
          onPause={pauseDeck}
          onStop={stopDeck}
          onGainChange={setDeckGain}
          onFilterChange={setDeckFilter}
          onResonanceChange={setDeckResonance}
          onEqLowChange={setDeckEqLow}
          onEqMidChange={setDeckEqMid}
          onEqHighChange={setDeckEqHigh}
          onEqModeChange={setDeckEqMode}
          onParametricEqBandsChange={setDeckParametricEqBands}
          onDelayTimeChange={setDeckDelayTime}
          onDelayFeedbackChange={setDeckDelayFeedback}
          onDelayMixChange={setDeckDelayMix}
          onDelayToneChange={setDeckDelayTone}
          onDelayPingPongChange={setDeckDelayPingPong}
          onDelaySaturationChange={setDeckDelaySaturation}
          onDelayDampingChange={setDeckDelayDamping}
          onDelaySafetyChange={setDeckDelaySafety}
          onDelaySliceSyncChange={setDeckDelaySliceSync}
          onVocoderMixChange={setDeckVocoderMix}
          onVocoderCarrierDeckIdChange={setDeckVocoderCarrierDeckId}
          onVocoderModulatorMonitorChange={setDeckVocoderModulatorMonitor}
          onVocoderModDriveChange={setDeckVocoderModDrive}
          onVocoderBandCountChange={setDeckVocoderBandCount}
          onVocoderAttackMsChange={setDeckVocoderAttackMs}
          onVocoderReleaseMsChange={setDeckVocoderReleaseMs}
          onVocoderPhaseRotateChange={setDeckVocoderNoiseMix}
          onVocoderGateThresholdChange={setDeckVocoderGateThreshold}
          onDisableDeckVocoder={(id) => {
            setDeckVocoderMix(id, 0);
            setDeckVocoderCarrierDeckId(id, null);
            setDeckVocoderModulatorMonitor(id, 0);
            setDeckVocoderModDrive(id, 2);
          }}
          onDisableDeckVocoders={(ids) => {
            ids.forEach((id) => {
              setDeckVocoderMix(id, 0);
              setDeckVocoderCarrierDeckId(id, null);
              setDeckVocoderModulatorMonitor(id, 0);
              setDeckVocoderModDrive(id, 2);
            });
          }}
          onBalanceChange={setDeckBalance}
          onPitchShiftChange={setDeckPitchShift}
          onSeek={seekDeck}
          onZoomChange={setDeckZoom}
          onLoopChange={setDeckLoop}
          onLoopBoundsChange={setDeckLoopBounds}
          onLoopBoundsChangeComplete={commitDeckLoopBoundsHistory}
          onTempoOffsetChange={setDeckTempoOffset}
          onTempoPitchSyncChange={setDeckTempoPitchSync}
          onDeckWidthOverrideChange={setDeckWidthOverride}
          onStretchRatioChange={setDeckStretchRatio}
          onStretchWindowSizeChange={setDeckStretchWindowSize}
          onStretchStereoWidthChange={setDeckStretchStereoWidth}
          onStretchPhaseRandomnessChange={setDeckStretchPhaseRandomness}
          onStretchTiltDbChange={setDeckStretchTiltDb}
          onStretchScatterChange={setDeckStretchScatter}
          onRearrangerSlicesChange={setDeckRearrangerSlices}
          onRearrangerSwapCountChange={setDeckRearrangerSwapCount}
          onRearrangerChaosChange={setDeckRearrangerChaos}
          onRearrangerReverseChange={setDeckRearrangerReverse}
          onRearrangerSensitivityChange={setDeckRearrangerSensitivity}
          onRearrangerQuietThresholdChange={setDeckRearrangerQuietThreshold}
          onRearrangerSliceFadeChange={setDeckRearrangerSliceFadeMs}
          onRearrangerSliceDelayChange={setDeckRearrangerSliceDelaySec}
          onRearrangerPingPongChange={setDeckRearrangerPingPong}
          onRearrangerAutoChange={setDeckRearrangerAuto}
          onRearrangerRegionsChange={setDeckRearrangerRegions}
          onRearrangerSliceDelete={handleDeleteRearrangerSlice}
          onRearrangerAutoSlice={handleAutoSliceRearranger}
          onRearrangerTrimQuiet={handleTrimQuietRearranger}
          onRearrangeLoop={handleRearrangeLoop}
          onFxPanelToggle={setDeckFxPanelOpen}
          onFxPanelsToggleAll={setDeckFxPanelsOpen}
          onFxResetAll={resetDeckFx}
          onStretchLoop={handleStretchLoop}
          stretchEstimateByDeckId={stretchEstimateByDeckId}
          automationState={automationState}
          onAutomationStart={startAutomationRecording}
          onAutomationStop={stopAutomationRecording}
          onAutomationValueChange={updateAutomationValue}
          getAutomationPlayhead={getAutomationPlayhead}
          onAutomationToggle={toggleAutomationActive}
          onAutomationReset={resetAutomationTrack}
          onAutomationPreset={applyAutomationPreset}
          onAutomationLengthScale={adjustAutomationLength}
          onAutomationAmplitudeScale={adjustAutomationAmplitude}
          onAutomationInvert={invertAutomation}
          onAutomationDurationChange={setAutomationDuration}
          getDeckPosition={getDeckPosition}
          getDeckPlaybackSnapshot={getDeckPlaybackSnapshot}
          setFileInputRef={setFileInputRef}
          onSaveLoopClip={handleSaveLoopClip}
          onCropLoop={handleCropLoop}
          onDuplicateLoop={handleDuplicateLoop}
        />
      </main>
      {showKeyboardShortcuts ? (
        <div className="app__shortcuts" role="dialog" aria-modal="false" aria-label="Keyboard shortcuts">
          <div className="app__shortcuts-card">
            <div className="app__shortcuts-header">
              <strong>Keyboard Shortcuts</strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowKeyboardShortcuts(false)}
                aria-label="Close keyboard shortcuts"
              >
                ×
              </button>
            </div>
            <ul className="app__shortcuts-list">
              <li><kbd>Space</kbd> Play/Pause active deck</li>
              <li><kbd>Shift</kbd> + <kbd>Space</kbd> Global Play/Pause</li>
              <li><kbd>R</kbd> Toggle Rearranger panel (active deck)</li>
              <li><kbd>L</kbd> Toggle loop (active deck)</li>
              <li><kbd>Shift</kbd> + <kbd>L</kbd> Reset loop to full file</li>
              <li><kbd>C</kbd> Crop active deck to loop</li>
              <li><kbd>D</kbd> Duplicate active deck</li>
              <li><kbd>Delete</kbd>/<kbd>Backspace</kbd> Remove active deck</li>
              <li><kbd>=</kbd> Zoom out waveform</li>
              <li><kbd>-</kbd> Zoom in waveform</li>
              <li><kbd>A</kbd> Add deck</li>
              <li><kbd>Cmd/Ctrl</kbd> + <kbd>Z</kbd> Undo</li>
              <li><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> Redo</li>
              <li><kbd>Cmd/Ctrl</kbd> + <kbd>S</kbd> Save session</li>
              <li><kbd>Cmd/Ctrl</kbd> + <kbd>O</kbd> Open session</li>
              <li><kbd>?</kbd> Toggle this panel</li>
            </ul>
          </div>
        </div>
      ) : null}
      {audioContextState !== "running" && !import.meta.env.DEV ? (
        <div className="audio-unlock" role="dialog" aria-modal="true" aria-label="Enable audio">
          <div className="audio-unlock__card">
            <div className="audio-unlock__glow" aria-hidden="true" />
            <div className="audio-unlock__badge">Audio Gate</div>
            <h2>Enable Audio Engine</h2>
            <p>
              Your browser requires a user gesture before audio can play. Tap below
              to unlock live playback, recording, and exports.
            </p>
            <button type="button" className="audio-unlock__action" onClick={handleEnableAudio}>
              Enable Audio
            </button>
            <div className="audio-unlock__hint">
              {audioUnlockError ?? "Tip: Spacebar works too."}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default App;
