import { useCallback, useEffect, useRef, useState } from "react";
import DeckStack from "./components/DeckStack";
import ClipRecorder from "./components/ClipRecorder";
import WelcomePanel from "./components/WelcomePanel";
import AppHeader from "./components/AppHeader";
import KeyboardShortcutsDialog from "./components/KeyboardShortcutsDialog";
import AudioUnlockOverlay from "./components/AudioUnlockOverlay";
import useDecks from "./hooks/useDecks";
import useAudioEngine from "./hooks/useAudioEngine";
import useSessionManager from "./hooks/useSessionManager";
import useGlobalKeyboardShortcuts from "./hooks/useGlobalKeyboardShortcuts";
import useFocusedDeckActions from "./hooks/useFocusedDeckActions";
import useClipLibrary from "./hooks/useClipLibrary";
import useDeckLoopTools from "./hooks/useDeckLoopTools";
import useDeckStackProps from "./hooks/useDeckStackProps";
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
  const deckStackProps = useDeckStackProps({
    decks,
    deckLayoutMode,
    zipDragOver,
    activeDeckId,
    scrollToDeckId,
    setScrollToDeckId,
    handleDeckActivate,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    stopDeck,
    setDeckGain,
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckDelaySliceSync,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckBalance,
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
    handleDeleteRearrangerSlice,
    handleAutoSliceRearranger,
    handleTrimQuietRearranger,
    handleRearrangeLoop,
    setDeckFxPanelOpen,
    setDeckFxPanelsOpen,
    resetDeckFx,
    handleStretchLoop,
    stretchEstimateByDeckId,
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
    setFileInputRef,
    handleSaveLoopClip,
    handleCropLoop,
    handleDuplicateLoop,
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
      <AppHeader
        debugPerf={debugPerf}
        perfStats={perfStats}
        sessionName={sessionName}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAddDeck={() => addDeck()}
        onNewSession={handleNewSession}
        onGlobalPlaybackToggle={handleGlobalPlaybackToggle}
        hasActivePlayback={hasActivePlayback}
        recording={recording}
        onRecordToggle={handleRecordToggle}
        showSessionPanel={showSessionPanel}
        onToggleSessionPanel={() => setShowSessionPanel((prev) => !prev)}
        deckLayoutMode={deckLayoutMode}
        onToggleDeckLayout={() =>
          setDeckLayoutMode((prev) => (prev === "single" ? "two" : "single"))
        }
        masterGain={masterGain}
        onMasterGainChange={setMasterGainValue}
        onOpenKeyboardShortcuts={() => {
          setShowKeyboardShortcuts(true);
          setShowWelcomePanelOverride(true);
        }}
        showKeyboardShortcuts={showKeyboardShortcuts}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
        importInputRef={importInputRef}
        onImportChange={handleImportChange}
        sessionBusy={sessionBusy}
        onSaveSession={handleSaveSession}
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectedSessionIdChange={setSelectedSessionId}
        onLoadSession={handleLoadSession}
        onExportSession={handleExportSession}
        onImportClick={handleImportClick}
        exportMinutes={exportMinutes}
        exportSeconds={exportSeconds}
        onExportMinutesChange={handleExportMinutesChange}
        onExportSecondsChange={handleExportSecondsChange}
        onExportMix={exportMixdown}
        exporting={exporting}
        exportEstimateLabel={exportEstimateLabel}
        onSessionNameChange={setSessionName}
      />

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
        <DeckStack {...deckStackProps} />
      </main>
      <KeyboardShortcutsDialog
        open={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />
      <AudioUnlockOverlay
        open={audioContextState !== "running" && !import.meta.env.DEV}
        audioUnlockError={audioUnlockError}
        onEnableAudio={() => void handleEnableAudio()}
      />
    </div>
  );
};

export default App;
