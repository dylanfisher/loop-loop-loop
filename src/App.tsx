import { useCallback, useEffect, useRef, useState } from "react";
import DeckStack from "./components/DeckStack";
import ClipRecorder from "./components/ClipRecorder";
import WelcomePanel from "./components/WelcomePanel";
import AsyncActionButton from "./components/AsyncActionButton";
import Knob from "./components/Knob";
import useDecks from "./hooks/useDecks";
import useAudioEngine from "./hooks/useAudioEngine";
import type { ClipItem } from "./types/clip";
import type { DeckState } from "./types/deck";
import type {
  ClipSession,
  ClipSettings,
  DeckSession,
  SessionFileState,
  SessionMeta,
  SessionState,
} from "./types/session";
import { encodeWav } from "./utils/audio";
import {
  ensurePitchShiftWorklet,
} from "./audio/pitchShift";
import { createPaulStretchNode, ensurePaulStretchWorklet } from "./audio/paulStretch";
import { applyPostEqEffectsOffline } from "./audio/effects/postEqPipeline";
import { applyPitchShiftOffline } from "./audio/effects/pitchShift";
import { applyDjFilterOffline } from "./audio/effects/djFilter";
import { applyEq3Offline } from "./audio/effects/eq3";
import { applyBalanceOffline } from "./audio/effects/balance";
import { applyGainOffline } from "./audio/effects/gain";
import { applyMasterProtectOffline } from "./audio/effects/masterProtect";
import PerfOverlay from "./components/PerfOverlay";
import {
  AUTO_SESSION_ID,
  createSessionBlobId,
  createSessionId,
  listSessionMetas,
  loadSessionState,
  saveSessionState,
} from "./utils/sessionStore";
import { createZip, readZip } from "./utils/zip";
import { encodeWavOffThread } from "./utils/wavWorkerClient";
import {
  buildFxPanelPatch,
  loadFxPanelPatch,
  saveFxPanelPatch,
} from "./utils/fxPanelState";
import {
  applyStretchCalibration,
  estimateStretchRenderSeconds,
  formatStretchEstimateLabel,
  loadStretchCalibrationState,
  saveStretchCalibrationState,
  updateStretchCalibrationState,
} from "./utils/stretchEstimate";
import {
  deriveRearrangedRegionIds,
  deriveRearrangedRegions,
  rearrangeBufferSegment,
} from "./utils/rearranger";

type PerformanceMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
};

const CLIP_AUTOMATION_SAMPLE_RATE = 30;
const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const isTextInputTarget = (target: EventTarget | null) => {
  const node = target as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable
  );
};

const trimBufferLeadingSamples = (
  context: BaseAudioContext,
  buffer: AudioBuffer,
  startSamples: number,
  targetLength: number
) => {
  const safeStart = Math.max(0, Math.min(startSamples, buffer.length - 1));
  const safeLength = Math.max(
    1,
    Math.min(targetLength, buffer.length - safeStart)
  );
  const trimmed = context.createBuffer(
    buffer.numberOfChannels,
    safeLength,
    buffer.sampleRate
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    trimmed
      .getChannelData(channel)
      .set(source.subarray(safeStart, safeStart + safeLength));
  }
  return trimmed;
};

const findLeadingSilenceSamples = (
  buffer: AudioBuffer,
  maxSamples: number,
  threshold: number
) => {
  const limit = Math.min(buffer.length, Math.max(0, maxSamples));
  for (let i = 0; i < limit; i += 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[i]) >= threshold) {
        return i;
      }
    }
  }
  return limit;
};

const findTrailingNonSilenceSample = (buffer: AudioBuffer, threshold: number) => {
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[i]) >= threshold) {
        return i;
      }
    }
  }
  return -1;
};

const approxEqual = (value: number, target: number, epsilon = 1e-4) =>
  Math.abs(value - target) <= epsilon;

const sliceBufferSegment = (
  buffer: AudioBuffer,
  startSeconds: number,
  durationSeconds: number
) => {
  const sampleRate = buffer.sampleRate;
  const clampedStartSeconds = Math.max(0, startSeconds);
  const startSample = Math.max(
    0,
    Math.min(buffer.length - 1, Math.round(clampedStartSeconds * sampleRate))
  );
  const endSample = Math.max(
    startSample + 1,
    Math.min(
      buffer.length,
      Math.round((clampedStartSeconds + Math.max(0.001, durationSeconds)) * sampleRate)
    )
  );
  const length = Math.max(1, endSample - startSample);
  const sliced = new AudioBuffer({
    length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    sliced
      .getChannelData(channel)
      .set(source.subarray(startSample, startSample + length));
  }
  return sliced;
};

const computeRms = (
  buffer: AudioBuffer,
  startSample: number,
  length: number
) => {
  const safeStart = Math.max(0, Math.min(startSample, buffer.length - 1));
  const safeLength = Math.max(
    1,
    Math.min(length, buffer.length - safeStart)
  );
  let sum = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < safeLength; i += 1) {
      const sample = data[safeStart + i] ?? 0;
      sum += sample * sample;
    }
    count += safeLength;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
};

const applyBufferGain = (buffer: AudioBuffer, gain: number) => {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] *= gain;
    }
  }
};

const formatEstimateDuration = (seconds: number) => {
  const safeSeconds = Math.max(1, Math.round(seconds));
  if (safeSeconds < 60) return `~${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `~${minutes}m ${remainingSeconds}s`;
};

const isSessionBrandNew = (session: {
  decks: Array<{ fileName?: string; wavBlobId?: string; wavFile?: string }>;
  clips: unknown[];
}) =>
  session.clips.length === 0 &&
  session.decks.every((deck) => !deck.wavBlobId && !deck.wavFile && !deck.fileName);

const App = () => {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [exportMinutes, setExportMinutes] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [exportEstimateLabel, setExportEstimateLabel] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [masterGain, setMasterGainValue] = useState(0.9);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [debugPerf, setDebugPerf] = useState(() => {
    if (!import.meta.env.DEV) return false;
    return localStorage.getItem("debugPerf") === "true";
  });
  const [sessionName, setSessionName] = useState("");
  const [welcomePanelDismissed, setWelcomePanelDismissed] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const statusTimeoutRef = useRef<number | null>(null);

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
  }, [sessionStatus]);
  useEffect(() => {
    saveStretchCalibrationState(stretchCalibration);
  }, [stretchCalibration]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const { getMasterStream, decodeFile, resumeContext, suspendContext, setMasterGain } =
    useAudioEngine();
  useEffect(() => {
    setMasterGain(masterGain);
  }, [masterGain, setMasterGain]);
  const clipIdRef = useRef(1);
  const clipNameRef = useRef(1);
  const clipsRef = useRef<ClipItem[]>([]);
  const clipBufferCacheRef = useRef<Map<number, { blob: Blob; buffer: AudioBuffer }>>(new Map());
  const autosaveTimeoutRef = useRef<number | null>(null);
  const rearrangeLoopTrackerRef = useRef<Map<number, { lastPosition: number; lastTriggerMs: number }>>(
    new Map()
  );
  const rearrangeBusyByDeckRef = useRef<Map<number, boolean>>(new Map());
  const skipNextAutosaveRef = useRef(0);
  const autosaveReadyRef = useRef(false);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const applySessionDataRef = useRef<
    ((session: SessionState, blobs: Map<string, Blob>) => Promise<void>) | null
  >(null);
  const {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    setFileInputRef,
    setDeckGain,
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckBalance,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckFractalMix,
    setDeckFractalStructure,
    setDeckFractalDepth,
    setDeckFractalDrift,
    setDeckFractalDecay,
    setDeckFractalTone,
    setDeckPitchShift,
    seekDeck,
    setDeckZoom,
    setDeckLoop,
    setDeckLoopBounds,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
    setDeckStretchRatio,
    setDeckStretchWindowSize,
    setDeckStretchStereoWidth,
    setDeckStretchPhaseRandomness,
    setDeckStretchTiltDb,
    setDeckStretchScatter,
    setDeckRearrangerSlices,
    setDeckRearrangerOffset,
    setDeckRearrangerChaos,
    setDeckRearrangerReverse,
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
    setAutomationDuration,
    getDeckPosition,
    getDeckPlaybackSnapshot,
    getSessionDecks,
    loadSessionDecks,
    resetDecks,
    undo,
    redo,
    canUndo,
    canRedo,
    loadDeckBuffer,
  } = useDecks();
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
  const showWelcomePanel = isCurrentProjectBrandNew && !welcomePanelDismissed;

  const hasActivePlayback = decks.some((deck) => deck.status === "playing");

  const shouldAnimatePerf = hasActivePlayback || recording;

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
    if (hasActivePlayback || recording) {
      void resumeContext();
      return;
    }
    void suspendContext();
  }, [hasActivePlayback, recording, resumeContext, suspendContext]);

  const buildClipSettings = useCallback(
    (deck: DeckState, loopDuration: number): ClipSettings => {
      const automation = automationState.get(deck.id);
      const toSnapshot = (
        track:
          | {
              samples: Float32Array;
              durationSec: number;
              active: boolean;
              currentValue: number;
            }
          | undefined,
        fallback: number
      ) => ({
        samples: Array.from(track?.samples ?? []),
        sampleRate: CLIP_AUTOMATION_SAMPLE_RATE,
        durationSec: track?.durationSec ?? 0,
        active: track?.active ?? false,
        currentValue: track?.currentValue ?? fallback,
      });

      return {
        gain: deck.gain,
        djFilter: deck.djFilter,
        filterResonance: deck.filterResonance,
        eqLowGain: deck.eqLowGain,
        eqMidGain: deck.eqMidGain,
        eqHighGain: deck.eqHighGain,
        balance: deck.balance,
        pitchShift: deck.pitchShift,
        tempoOffset: deck.tempoOffset,
        tempoPitchSync: deck.tempoPitchSync,
        stretchRatio: deck.stretchRatio,
        stretchWindowSize: deck.stretchWindowSize,
        stretchStereoWidth: deck.stretchStereoWidth,
        stretchPhaseRandomness: deck.stretchPhaseRandomness,
        stretchTiltDb: deck.stretchTiltDb,
        stretchScatter: deck.stretchScatter,
        delayTime: deck.delayTime,
        delayFeedback: deck.delayFeedback,
        delayMix: deck.delayMix,
        delayTone: deck.delayTone,
        delayPingPong: deck.delayPingPong,
        fractalMix: deck.fractalMix,
        fractalStructure: deck.fractalStructure,
        fractalDepth: deck.fractalDepth,
        fractalDrift: deck.fractalDrift,
        fractalDecay: deck.fractalDecay,
        fractalTone: deck.fractalTone,
        rearrangerSlices: deck.rearrangerSlices,
        rearrangerOffset: deck.rearrangerOffset,
        rearrangerChaos: deck.rearrangerChaos,
        rearrangerReverse: deck.rearrangerReverse,
        rearrangerAuto: deck.rearrangerAuto,
        rearrangerRegions: deck.rearrangerRegions,
        rearrangerRegionIds: deck.rearrangerRegionIds,
        rearrangerRegionsManual: deck.rearrangerRegionsManual ?? false,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: loopDuration,
        automation: {
          djFilter: toSnapshot(automation?.djFilter, deck.djFilter),
          resonance: toSnapshot(automation?.resonance, deck.filterResonance),
          eqLow: toSnapshot(automation?.eqLow, deck.eqLowGain),
          eqMid: toSnapshot(automation?.eqMid, deck.eqMidGain),
          eqHigh: toSnapshot(automation?.eqHigh, deck.eqHighGain),
          balance: toSnapshot(automation?.balance, deck.balance),
          pitch: toSnapshot(automation?.pitch, deck.pitchShift),
        },
      };
    },
    [automationState]
  );

  useEffect(() => {
    clipsRef.current = clips;
    const nextIds = new Set<number>();
    clips.forEach((clip) => {
      nextIds.add(clip.id);
      const cached = clipBufferCacheRef.current.get(clip.id);
      if (clip.buffer) {
        clipBufferCacheRef.current.set(clip.id, { blob: clip.blob, buffer: clip.buffer });
        return;
      }
      if (cached && cached.blob !== clip.blob) {
        clipBufferCacheRef.current.delete(clip.id);
      }
    });
    clipBufferCacheRef.current.forEach((_, id) => {
      if (!nextIds.has(id)) {
        clipBufferCacheRef.current.delete(id);
      }
    });
  }, [clips]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
    window.dispatchEvent(new Event("themechange"));
  }, [theme]);

  useEffect(() => {
    return () => {
      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
    };
  }, []);

  const refreshSessions = useCallback(async () => {
    const list = await listSessionMetas();
    setSessions(list);
    if (!selectedSessionId && list.length > 0) {
      setSelectedSessionId(list[0].id);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);


  const addClip = useCallback(
    (clip: Omit<ClipItem, "id" | "url" | "name"> & { name?: string }) => {
      const id = clipIdRef.current;
      clipIdRef.current += 1;
      const name = clip.name ?? `Clip ${clipNameRef.current}`;
      clipNameRef.current += 1;
      const url = URL.createObjectURL(clip.blob);
      if (clip.buffer) {
        clipBufferCacheRef.current.set(id, { blob: clip.blob, buffer: clip.buffer });
      }
      setClips((prev) => [
        {
          id,
          name,
          blob: clip.blob,
          url,
          durationSec: clip.durationSec,
          buffer: clip.buffer,
          gain: clip.gain,
          balance: clip.balance,
          pitchShift: clip.pitchShift,
          tempoOffset: clip.tempoOffset ?? 0,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? false,
        },
        ...prev,
      ]);
    },
    []
  );

  const updateClip = useCallback((id: number, updates: Partial<ClipItem>) => {
    if (updates.buffer && updates.blob) {
      clipBufferCacheRef.current.set(id, { blob: updates.blob, buffer: updates.buffer });
    } else if (updates.buffer) {
      const existing = clipsRef.current.find((clip) => clip.id === id);
      if (existing) {
        clipBufferCacheRef.current.set(id, { blob: existing.blob, buffer: updates.buffer });
      }
    } else if (updates.blob) {
      const cached = clipBufferCacheRef.current.get(id);
      if (cached && cached.blob !== updates.blob) {
        clipBufferCacheRef.current.delete(id);
      }
    }
    setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...updates } : clip)));
  }, []);

  const removeClip = useCallback((id: number) => {
    setClips((prev) => {
      const clip = prev.find((item) => item.id === id);
      if (clip) {
        URL.revokeObjectURL(clip.url);
      }
      clipBufferCacheRef.current.delete(id);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const renderLoopClip = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return null;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return null;
      const sliceDuration = Math.max(0.01, loopEnd - loopStart);
      const sliced = sliceBufferSegment(deck.buffer, loopStart, sliceDuration);
      const blob = encodeWav(sliced);
      const settings = buildClipSettings(deck, sliced.duration);
      return {
        blob,
        durationSec: sliced.duration,
        buffer: sliced,
        gain: 0.9,
        balance: 0,
        pitchShift: 0,
        tempoOffset: 0,
        settings,
        applyFxSettings: includeSettings,
        name: `${deck.fileName ? `${deck.fileName} ` : ""}Loop`,
      };
    },
    [buildClipSettings, decks]
  );

  const renderClipWithSettingsBaked = useCallback(
    async (buffer: AudioBuffer, settings: ClipSettings) => {
      const tempoRatio = Math.min(Math.max(1 + settings.tempoOffset / 100, 0.01), 16);
      const renderDuration = buffer.duration / Math.max(0.01, tempoRatio);
      const sampleRate = buffer.sampleRate;
      const pitchTrack = settings.automation?.pitch;
      const djFilterTrack = settings.automation?.djFilter;
      const resonanceTrack = settings.automation?.resonance;
      const eqLowTrack = settings.automation?.eqLow;
      const eqMidTrack = settings.automation?.eqMid;
      const eqHighTrack = settings.automation?.eqHigh;
      const balanceTrack = settings.automation?.balance;
      const pitchActive =
        Math.abs(settings.pitchShift) >= 0.001 || pitchTrack?.active === true;
      const fractalMix = Math.min(Math.max(settings.fractalMix ?? 0, 0), 1);
      const fractalStructure = Math.min(Math.max(settings.fractalStructure ?? 0.45, 0), 1);
      const fractalDepth = Math.min(Math.max(settings.fractalDepth ?? 0.35, 0), 1);
      const fractalDrift = Math.min(Math.max(settings.fractalDrift ?? 0.15, 0), 1);
      const fractalDecay = Math.min(Math.max(settings.fractalDecay ?? 0.2, 0), 0.985);
      const fractalTone = Math.min(Math.max(settings.fractalTone ?? 6000, 300), 14000);
      const delayTime = Math.min(Math.max(settings.delayTime ?? 0.35, 0.01), 1.5);
      const delayFeedback = Math.min(Math.max(settings.delayFeedback ?? 0.35, 0), 0.95);
      const delayMix = Math.min(Math.max(settings.delayMix ?? 0, 0), 1);
      const delayTone = Math.min(Math.max(settings.delayTone ?? 6000, 400), 12000);
      const delayPingPong = settings.delayPingPong ?? false;

      const needsPitch = pitchActive || pitchTrack?.active === true;
      const needsFilter =
        !approxEqual(settings.djFilter, 0) ||
        !approxEqual(settings.filterResonance, 0) ||
        djFilterTrack?.active === true ||
        resonanceTrack?.active === true;
      const needsEq =
        !approxEqual(settings.eqLowGain, 0) ||
        !approxEqual(settings.eqMidGain, 0) ||
        !approxEqual(settings.eqHighGain, 0) ||
        eqLowTrack?.active === true ||
        eqMidTrack?.active === true ||
        eqHighTrack?.active === true;
      const needsBalance = !approxEqual(settings.balance, 0) || balanceTrack?.active === true;
      const needsGain = !approxEqual(settings.gain, 0.9);
      const needsDelay = delayMix > 0.001;
      const needsFractal = fractalMix > 0.001;
      const needsRender =
        !approxEqual(tempoRatio, 1) ||
        needsPitch ||
        needsFilter ||
        needsEq ||
        needsBalance ||
        needsGain ||
        needsDelay ||
        needsFractal;
      if (!needsRender) return buffer;

      const toAutomation = (track?: ClipSettings["automation"][keyof ClipSettings["automation"]]) =>
        track
          ? {
              active: track.active,
              samples: Float32Array.from(track.samples),
              durationSec: track.durationSec,
            }
          : undefined;

      const targetSamples = Math.max(1, Math.ceil(renderDuration * sampleRate));
      const fftFrameSize = 1024;
      const osamp = 8;
      const latencySamples = pitchActive
        ? Math.round(fftFrameSize - fftFrameSize / osamp)
        : 0;
      const maxSilenceTrimSamples = Math.ceil(0.03 * sampleRate);
      const extraSamples = latencySamples + maxSilenceTrimSamples;
      const length = Math.max(1, targetSamples + extraSamples);
      const offline = new OfflineAudioContext(
        buffer.numberOfChannels,
        length,
        sampleRate
      );
      if (needsPitch) {
        try {
          await ensurePitchShiftWorklet(offline);
        } catch (error) {
          console.warn("Pitch shift worklet unavailable for clip bake", error);
        }
      }
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = tempoRatio;

      let chain: AudioNode = source;
      chain = applyBalanceOffline(offline, chain, {
        balance: settings.balance,
        renderDuration,
        automation: toAutomation(balanceTrack),
      });
      chain = applyPitchShiftOffline(offline, chain, {
        pitch: settings.pitchShift,
        renderDuration,
        automation: toAutomation(pitchTrack),
      });
      chain = applyDjFilterOffline(offline, chain, {
        djFilter: settings.djFilter,
        resonance: settings.filterResonance,
        renderDuration,
        djAutomation: toAutomation(djFilterTrack),
        resonanceAutomation: toAutomation(resonanceTrack),
      });
      chain = applyEq3Offline(offline, chain, {
        low: settings.eqLowGain,
        mid: settings.eqMidGain,
        high: settings.eqHighGain,
        renderDuration,
        lowAutomation: toAutomation(eqLowTrack),
        midAutomation: toAutomation(eqMidTrack),
        highAutomation: toAutomation(eqHighTrack),
      });
      chain = applyPostEqEffectsOffline(
        offline,
        chain,
        {
          fractal: {
            mix: fractalMix,
            structure: fractalStructure,
            depth: fractalDepth,
            drift: fractalDrift,
            decay: fractalDecay,
            tone: fractalTone,
          },
          delay: {
            time: delayTime,
            feedback: delayFeedback,
            mix: delayMix,
            tone: delayTone,
            pingPong: delayPingPong,
          },
        },
        "saveLoop"
      );
      chain = applyGainOffline(offline, chain, { gain: settings.gain, bypassAt: 0.9 });
      chain.connect(offline.destination);
      source.start(0, 0, renderDuration);
      const rendered = await offline.startRendering();
      const silenceTrimSamples = findLeadingSilenceSamples(
        rendered,
        maxSilenceTrimSamples,
        1e-4
      );
      const totalTrim = Math.min(latencySamples + silenceTrimSamples, extraSamples);
      return trimBufferLeadingSamples(
        offline,
        rendered,
        totalTrim,
        targetSamples
      );
    },
    []
  );

  const handleLoadClipToDeck = useCallback(
    async (deckId: number, clip: ClipItem) => {
      const applyFxSettings = Boolean(clip.settings && clip.applyFxSettings);
      const makeClipFile = (blob: Blob, ext: string, fallbackType: string) =>
        new File([blob], `${clip.name}.${ext}`, {
          type: blob.type || fallbackType,
        });
      if (clip.settings && !applyFxSettings) {
        try {
          const cached = clipBufferCacheRef.current.get(clip.id);
          const sourceBuffer = (() => {
            if (clip.buffer) return clip.buffer;
            if (cached && cached.blob === clip.blob) return cached.buffer;
            return null;
          })();
          const rawBuffer =
            sourceBuffer ??
            (await decodeFile(makeClipFile(clip.blob, "wav", "audio/wav")));
          const baked = await renderClipWithSettingsBaked(rawBuffer, clip.settings);
          const bakedBlob = encodeWav(baked);
          await handleFileSelected(
            deckId,
            makeClipFile(bakedBlob, "wav", "audio/wav"),
            {
              gain: clip.gain,
              balance: clip.balance,
              pitchShift: clip.pitchShift,
              tempoOffset: clip.tempoOffset ?? 0,
            }
          );
          return;
        } catch (error) {
          console.warn("Failed to bake clip with settings; loading raw clip", error);
        }
      }
      await handleFileSelected(
        deckId,
        makeClipFile(clip.blob, "webm", "audio/webm"),
        {
          gain: applyFxSettings ? clip.settings?.gain : clip.gain,
          balance: applyFxSettings ? clip.settings?.balance : clip.balance,
          pitchShift: applyFxSettings ? clip.settings?.pitchShift : clip.pitchShift,
          tempoOffset: applyFxSettings
            ? clip.settings?.tempoOffset
            : clip.tempoOffset ?? 0,
          settings: applyFxSettings ? clip.settings : undefined,
        }
      );
    },
    [decodeFile, handleFileSelected, renderClipWithSettingsBaked]
  );

  const handleSaveLoopClip = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const clip = await renderLoopClip(deckId, includeSettings);
      if (!clip) return;
      addClip(clip);
    },
    [addClip, renderLoopClip]
  );

  const handleCropLoop = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck) return;
      const clip = await renderLoopClip(deckId, true);
      if (!clip) return;
      const wasPlaying = deck.status === "playing";
      loadDeckBuffer(deckId, clip.buffer, {
        name: `${deck.fileName ?? "Loop"} Crop`,
        autoplay: wasPlaying,
        preserveFxState: true,
      });
    },
    [decks, loadDeckBuffer, renderLoopClip]
  );

  const exportMixdown = useCallback(async () => {
    if (exporting) return;
    const activeDecks = decks.filter((deck) => deck.buffer);
    if (activeDecks.length === 0) {
      setSessionStatus("Load at least one deck before exporting.");
      return;
    }
    setExportEstimateLabel(
      `Approx export: ${formatEstimateDuration(Math.max(1, exportMinutes) * 30)}`
    );
    setExporting(true);
    const durationSec = Math.max(1, exportMinutes) * 60;
    const sampleRate = activeDecks[0].buffer?.sampleRate ?? 44100;
    const length = Math.max(1, Math.ceil(durationSec * sampleRate));
    const offline = new OfflineAudioContext(2, length, sampleRate);
    try {
      await ensurePitchShiftWorklet(offline);
    } catch (error) {
      console.warn("Pitch shift worklet unavailable for export", error);
    }
    const masterMix = offline.createGain();
    const masterGain = offline.createGain();
    masterGain.gain.value = 0.9;
    masterMix.connect(masterGain);
    masterGain.connect(offline.destination);

    activeDecks.forEach((deck) => {
      if (!deck.buffer) return;
      const source = offline.createBufferSource();
      source.buffer = deck.buffer;
      const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
      source.playbackRate.value = tempoRatio;
      const pitchValue = (automationState.get(deck.id)?.pitch?.active
        ? automationState.get(deck.id)?.pitch?.currentValue
        : deck.pitchShift) ?? deck.pitchShift;
      const delayTime = Math.min(Math.max(deck.delayTime ?? 0.35, 0.01), 1.5);
      const delayFeedback = Math.min(Math.max(deck.delayFeedback ?? 0.35, 0), 0.95);
      const delayMix = Math.min(Math.max(deck.delayMix ?? 0, 0), 1);
      const delayTone = Math.min(Math.max(deck.delayTone ?? 6000, 400), 12000);
      const delayPingPong = deck.delayPingPong ?? false;
      const fractalMix = Math.min(Math.max(deck.fractalMix ?? 0, 0), 1);
      const fractalStructure = Math.min(Math.max(deck.fractalStructure ?? 0.45, 0), 1);
      const fractalDepth = Math.min(Math.max(deck.fractalDepth ?? 0.35, 0), 1);
      const fractalDrift = Math.min(Math.max(deck.fractalDrift ?? 0.15, 0), 1);
      const fractalDecay = Math.min(Math.max(deck.fractalDecay ?? 0.2, 0), 0.985);
      const fractalTone = Math.min(Math.max(deck.fractalTone ?? 6000, 300), 14000);


      const automation = automationState.get(deck.id);
      const djFilterTrack = automation?.djFilter;
      const resonanceTrack = automation?.resonance;
      const eqLowTrack = automation?.eqLow;
      const eqMidTrack = automation?.eqMid;
      const eqHighTrack = automation?.eqHigh;
      const balanceTrack = automation?.balance;
      const pitchTrack = automation?.pitch;

      const djFilterValue = djFilterTrack?.active ? djFilterTrack.currentValue : deck.djFilter;
      const resonanceValue = resonanceTrack?.active
        ? resonanceTrack.currentValue
        : deck.filterResonance;
      const eqLowValue = eqLowTrack?.active ? eqLowTrack.currentValue : deck.eqLowGain;
      const eqMidValue = eqMidTrack?.active ? eqMidTrack.currentValue : deck.eqMidGain;
      const eqHighValue = eqHighTrack?.active ? eqHighTrack.currentValue : deck.eqHighGain;
      const balanceValue = balanceTrack?.active ? balanceTrack.currentValue : deck.balance;

      let preEq: AudioNode = applyBalanceOffline(offline, source, {
        balance: balanceValue,
        renderDuration: durationSec,
        automation: balanceTrack
          ? {
              active: balanceTrack.active,
              samples: balanceTrack.samples,
              durationSec: balanceTrack.durationSec,
            }
          : undefined,
      });
      preEq = applyPitchShiftOffline(offline, preEq, {
        pitch: pitchValue,
        renderDuration: durationSec,
        automation: pitchTrack
          ? {
              active: pitchTrack.active,
              samples: pitchTrack.samples,
              durationSec: pitchTrack.durationSec,
            }
          : undefined,
      });
      const postFilter = applyDjFilterOffline(offline, preEq, {
        djFilter: djFilterValue,
        resonance: resonanceValue,
        renderDuration: durationSec,
        djAutomation: djFilterTrack
          ? {
              active: djFilterTrack.active,
              samples: djFilterTrack.samples,
              durationSec: djFilterTrack.durationSec,
            }
          : undefined,
        resonanceAutomation: resonanceTrack
          ? {
              active: resonanceTrack.active,
              samples: resonanceTrack.samples,
              durationSec: resonanceTrack.durationSec,
            }
          : undefined,
      });
      let postEq: AudioNode = applyEq3Offline(offline, postFilter, {
        low: eqLowValue,
        mid: eqMidValue,
        high: eqHighValue,
        renderDuration: durationSec,
        lowAutomation: eqLowTrack
          ? {
              active: eqLowTrack.active,
              samples: eqLowTrack.samples,
              durationSec: eqLowTrack.durationSec,
            }
          : undefined,
        midAutomation: eqMidTrack
          ? {
              active: eqMidTrack.active,
              samples: eqMidTrack.samples,
              durationSec: eqMidTrack.durationSec,
            }
          : undefined,
        highAutomation: eqHighTrack
          ? {
              active: eqHighTrack.active,
              samples: eqHighTrack.samples,
              durationSec: eqHighTrack.durationSec,
            }
          : undefined,
      });
      postEq = applyPostEqEffectsOffline(
        offline,
        postEq,
        {
          fractal: {
            mix: fractalMix,
            structure: fractalStructure,
            depth: fractalDepth,
            drift: fractalDrift,
            decay: fractalDecay,
            tone: fractalTone,
          },
          delay: {
            time: delayTime,
            feedback: delayFeedback,
            mix: delayMix,
            tone: delayTone,
            pingPong: delayPingPong,
          },
        },
        "exportMix"
      );
      const postGain = applyGainOffline(offline, postEq, { gain: deck.gain, bypassAt: 0.9 });
      const protectedOut = applyMasterProtectOffline(offline, postGain, { enabled: true });
      protectedOut.connect(masterMix);

      const loopStart = deck.loopStartSeconds ?? 0;
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? deck.loopEndSeconds
          : deck.buffer.duration;
      if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
        source.loop = true;
        source.loopStart = Math.max(0, loopStart);
        source.loopEnd = Math.min(loopEnd, deck.buffer.duration);
      }
      source.start(0, Math.max(0, loopStart));
    });

    try {
      const rendered = await offline.startRendering();
      const blob = encodeWav(rendered);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `loop-loop-loop-export-${Date.now()}.wav`;
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
    exporting,
  ]);

  const handleExportMinutesChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(Math.round(value), 1), 60);
    setExportMinutes(clamped);
  }, []);

  const handleRecordToggle = useCallback(() => {
    if (recording) {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      return;
    }
    const stream = getMasterStream();
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recordChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(recordChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      const file = new File([blob], "loop-loop-loop-recording.webm", {
        type: blob.type || "audio/webm",
      });
      recordChunksRef.current = [];
      recorderRef.current = null;
      void decodeFile(file)
        .then((buffer) => {
          const wavBlob = encodeWav(buffer);
          const url = URL.createObjectURL(wavBlob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `loop-loop-loop-recording-${Date.now()}.wav`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        })
        .catch((error) => {
          console.error("Failed to convert recording to wav", error);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `loop-loop-loop-recording-${Date.now()}.webm`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        })
        .finally(() => {
          setRecording(false);
        });
    };
    recorder.start(250);
    setRecording(true);
  }, [decodeFile, getMasterStream, recording]);

  const handleStretchLoop = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const startedAtMs = performance.now();
      let renderCompleted = false;
      let baseEstimateSeconds = 0;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, deck.buffer.duration)
          : deck.buffer.duration;
      if (loopEnd <= loopStart + 0.01) return;
      const ratio = Math.min(Math.max(deck.stretchRatio ?? 2, 1), 16);
      const windowSize = Math.min(
        Math.max(deck.stretchWindowSize ?? 16384, 2048),
        16384
      );
      const loopSamples = Math.max(1, Math.floor((loopEnd - loopStart) * deck.buffer.sampleRate));
      const maxWindow = Math.max(
        1024,
        Math.pow(2, Math.floor(Math.log2(Math.max(1, Math.floor(loopSamples / 2)))))
      );
      const effectiveWindowSize = Math.min(windowSize, maxWindow);
      baseEstimateSeconds = estimateStretchRenderSeconds({
        loopDurationSec: loopEnd - loopStart,
        stretchRatio: ratio,
        windowSize: effectiveWindowSize,
      });
      const calibratedEstimateSeconds = applyStretchCalibration(
        baseEstimateSeconds,
        stretchCalibration
      );
      setStretchEstimateByDeckId((prev) => ({
        ...prev,
        [deckId]: formatStretchEstimateLabel(
          calibratedEstimateSeconds,
          stretchCalibration.sampleCount
        ),
      }));
      try {
        const stereoWidth = Math.min(Math.max(deck.stretchStereoWidth ?? 1, 0), 2);
        const phaseRandomness = Math.min(
          Math.max(deck.stretchPhaseRandomness ?? 1, 0),
          1
        );
        const tiltDb = Math.min(Math.max(deck.stretchTiltDb ?? 0, -18), 18);
        const scatter = Math.min(Math.max(deck.stretchScatter ?? 1, 1), 16);
        const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
        const sliceDuration = Math.max(0.01, loopEnd - loopStart);
        // Duration to pull from the buffer in source-time so the rendered input is sliceDuration.
        const inputDurationSource = sliceDuration * tempoRatio;
        const sampleRate = deck.buffer.sampleRate;
        const hopOut = effectiveWindowSize / 2;
        const inputSamples = Math.max(
          1,
          Math.ceil(sliceDuration * sampleRate * Math.max(1, scatter))
        );
        const effectiveRatio = Math.min(ratio * scatter, 128);
        const outputSamples = Math.max(
          1,
          Math.ceil(sliceDuration * effectiveRatio * sampleRate)
        );
        const maxSilenceTrimSamples = Math.ceil(0.05 * sampleRate);
        const length = Math.max(1, outputSamples + maxSilenceTrimSamples + hopOut);
        const offline = new OfflineAudioContext(
          deck.buffer.numberOfChannels,
          length,
          sampleRate
        );
        try {
          await ensurePaulStretchWorklet(offline);
        } catch (error) {
          console.warn("Paulstretch worklet unavailable", error);
          return;
        }
        const stretchNode = createPaulStretchNode(offline, {
          ratio,
          winSize: effectiveWindowSize,
          inputSamples,
          outputSamples,
          stereoWidth,
          phaseRandomness,
          tilt: tiltDb,
          scatter,
        });
        stretchNode.port.onmessage = null;
        const source = offline.createBufferSource();
        const keepAlive = offline.createConstantSource();
        keepAlive.offset.value = 1e-6;
        source.buffer = deck.buffer;
        source.playbackRate.value = tempoRatio;

      const automation = automationState.get(deckId);
      const djFilterTrack = automation?.djFilter;
      const resonanceTrack = automation?.resonance;
      const eqLowTrack = automation?.eqLow;
      const eqMidTrack = automation?.eqMid;
      const eqHighTrack = automation?.eqHigh;
      const balanceTrack = automation?.balance;
      const pitchTrack = automation?.pitch;

      const djFilterValue = djFilterTrack?.active ? djFilterTrack.currentValue : deck.djFilter;
      const resonanceValue = resonanceTrack?.active
        ? resonanceTrack.currentValue
        : deck.filterResonance;
      const eqLowValue = eqLowTrack?.active ? eqLowTrack.currentValue : deck.eqLowGain;
      const eqMidValue = eqMidTrack?.active ? eqMidTrack.currentValue : deck.eqMidGain;
      const eqHighValue = eqHighTrack?.active ? eqHighTrack.currentValue : deck.eqHighGain;
      const balanceValue = balanceTrack?.active ? balanceTrack.currentValue : deck.balance;
      const pitchValue = pitchTrack?.active ? pitchTrack.currentValue : deck.pitchShift;

      const needsPitch = Math.abs(pitchValue) >= 0.001 || pitchTrack?.active === true;
      const needsFilter =
        Math.abs(djFilterValue) >= 0.001 ||
        !approxEqual(resonanceValue, 0) ||
        djFilterTrack?.active === true ||
        resonanceTrack?.active === true;
      const needsEq =
        !approxEqual(eqLowValue, 0) ||
        !approxEqual(eqMidValue, 0) ||
        !approxEqual(eqHighValue, 0) ||
        eqLowTrack?.active === true ||
        eqMidTrack?.active === true ||
        eqHighTrack?.active === true;
      const needsGain = !approxEqual(deck.gain, 0.9);

      if (needsPitch) {
        try {
          await ensurePitchShiftWorklet(offline);
        } catch (error) {
          console.warn("Pitch shift worklet unavailable for stretch render", error);
        }
      }

      const limiterNeeded = needsGain || needsEq || needsFilter || needsPitch;

      const renderDuration = sliceDuration;
      let chain: AudioNode = source;
      chain = applyBalanceOffline(offline, chain, {
        balance: balanceValue,
        renderDuration,
        automation: balanceTrack
          ? {
              active: balanceTrack.active,
              samples: balanceTrack.samples,
              durationSec: balanceTrack.durationSec,
            }
          : undefined,
      });
      chain = applyPitchShiftOffline(offline, chain, {
        pitch: pitchValue,
        renderDuration,
        automation: pitchTrack
          ? {
              active: pitchTrack.active,
              samples: pitchTrack.samples,
              durationSec: pitchTrack.durationSec,
            }
          : undefined,
      });
      chain = applyDjFilterOffline(offline, chain, {
        djFilter: djFilterValue,
        resonance: resonanceValue,
        renderDuration,
        djAutomation: djFilterTrack
          ? {
              active: djFilterTrack.active,
              samples: djFilterTrack.samples,
              durationSec: djFilterTrack.durationSec,
            }
          : undefined,
        resonanceAutomation: resonanceTrack
          ? {
              active: resonanceTrack.active,
              samples: resonanceTrack.samples,
              durationSec: resonanceTrack.durationSec,
            }
          : undefined,
      });
      chain = applyEq3Offline(offline, chain, {
        low: eqLowValue,
        mid: eqMidValue,
        high: eqHighValue,
        renderDuration,
        lowAutomation: eqLowTrack
          ? {
              active: eqLowTrack.active,
              samples: eqLowTrack.samples,
              durationSec: eqLowTrack.durationSec,
            }
          : undefined,
        midAutomation: eqMidTrack
          ? {
              active: eqMidTrack.active,
              samples: eqMidTrack.samples,
              durationSec: eqMidTrack.durationSec,
            }
          : undefined,
        highAutomation: eqHighTrack
          ? {
              active: eqHighTrack.active,
              samples: eqHighTrack.samples,
              durationSec: eqHighTrack.durationSec,
            }
          : undefined,
      });
      chain = applyGainOffline(offline, chain, { gain: deck.gain, bypassAt: 0.9 });
      chain = applyMasterProtectOffline(offline, chain, { enabled: limiterNeeded });
      chain.connect(stretchNode, 0, 0);
      keepAlive.connect(stretchNode, 0, 1);
      let stretchChain: AudioNode = stretchNode;
      if (stereoWidth !== 1 && deck.buffer.numberOfChannels > 1) {
        const splitter = offline.createChannelSplitter(2);
        const merger = offline.createChannelMerger(2);
        const midL = offline.createGain();
        const midR = offline.createGain();
        const sideL = offline.createGain();
        const sideR = offline.createGain();
        const midSum = offline.createGain();
        const sideSum = offline.createGain();
        const left = offline.createGain();
        const right = offline.createGain();
        const sideToRight = offline.createGain();

        midL.gain.value = 0.5;
        midR.gain.value = 0.5;
        sideL.gain.value = 0.5;
        sideR.gain.value = -0.5;
        sideSum.gain.value = stereoWidth;
        sideToRight.gain.value = -1;

        stretchChain.connect(splitter);
        splitter.connect(midL, 0);
        splitter.connect(midR, 1);
        midL.connect(midSum);
        midR.connect(midSum);

        splitter.connect(sideL, 0);
        splitter.connect(sideR, 1);
        sideL.connect(sideSum);
        sideR.connect(sideSum);

        midSum.connect(left);
        sideSum.connect(left);
        midSum.connect(right);
        sideSum.connect(sideToRight);
        sideToRight.connect(right);

        left.connect(merger, 0, 0);
        right.connect(merger, 0, 1);
        stretchChain = merger;
      }
      stretchChain.connect(offline.destination);

      if (scatter > 1) {
        source.loop = true;
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;
        source.start(0, loopStart);
      } else {
        source.start(0, loopStart, inputDurationSource);
      }
      keepAlive.start(0);
      keepAlive.stop(length / sampleRate);

      const rendered = await offline.startRendering();
      findTrailingNonSilenceSample(rendered, 1e-4);
      const silenceTrimSamples = findLeadingSilenceSamples(
        rendered,
        maxSilenceTrimSamples,
        1e-4
      );
      const totalTrim = Math.min(silenceTrimSamples, maxSilenceTrimSamples + hopOut);
      const trimmed = trimBufferLeadingSamples(
        offline,
        rendered,
        totalTrim,
        outputSamples
      );
      const sourceStartSample = Math.floor(loopStart * sampleRate);
      const sourceLengthSamples = Math.max(
        1,
        Math.floor(sliceDuration * sampleRate)
      );
      const sourceRms = computeRms(deck.buffer, sourceStartSample, sourceLengthSamples);
      const stretchedRms = computeRms(trimmed, 0, trimmed.length);
      if (sourceRms > 0 && stretchedRms > 0) {
        const gain = Math.min(4, Math.max(0.25, sourceRms / stretchedRms));
        applyBufferGain(trimmed, gain);
      }
        const name = `${deck.fileName ?? "Loop"} Stretch ${ratio.toFixed(1)}x`;
        const wasPlaying = deck.status === "playing";
        loadDeckBuffer(deckId, trimmed, { name, autoplay: wasPlaying });
        renderCompleted = true;
      } finally {
        setStretchEstimateByDeckId((prev) => {
          if (!(deckId in prev)) return prev;
          const next = { ...prev };
          delete next[deckId];
          return next;
        });
        if (renderCompleted && baseEstimateSeconds > 0) {
          const actualSeconds = Math.max(0.001, (performance.now() - startedAtMs) / 1000);
          setStretchCalibration((prev) =>
            updateStretchCalibrationState(prev, baseEstimateSeconds, actualSeconds)
          );
        }
      }
    },
    [
      automationState,
      decks,
      loadDeckBuffer,
      stretchCalibration,
    ]
  );

  const handleRearrangeLoop = useCallback(
    (deckId: number, options?: { transient?: boolean }) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      if ((deck.rearrangerSlices ?? 0) <= 1) return;
      if (rearrangeBusyByDeckRef.current.get(deckId)) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return;

      rearrangeBusyByDeckRef.current.set(deckId, true);
      try {
        const chaosSeed = Math.random() * 1_000_000_000;
        const loopDuration = loopEnd - loopStart;
        const sampleRate = deck.buffer.sampleRate;
        const startSample = Math.max(
          0,
          Math.min(deck.buffer.length - 1, Math.round(loopStart * sampleRate))
        );
        const endSample = Math.max(
          startSample + 1,
          Math.min(deck.buffer.length, Math.round((loopStart + loopDuration) * sampleRate))
        );
        const segmentSamples = Math.max(1, endSample - startSample);
        const rearranged = rearrangeBufferSegment(deck.buffer, loopStart, loopDuration, {
          slices: deck.rearrangerSlices,
          offset: deck.rearrangerOffset,
          chaos: deck.rearrangerChaos,
          reverse: deck.rearrangerReverse,
          regions: deck.rearrangerRegions,
        }, { chaosSeed });
        const nextRegions = deriveRearrangedRegions({
          slices: deck.rearrangerSlices,
          offset: deck.rearrangerOffset,
          chaos: deck.rearrangerChaos,
          reverse: deck.rearrangerReverse,
          regions: deck.rearrangerRegions,
        }, { chaosSeed, segmentSamples });
        const nextRegionIds = deriveRearrangedRegionIds(
          {
            slices: deck.rearrangerSlices,
            offset: deck.rearrangerOffset,
            chaos: deck.rearrangerChaos,
            reverse: deck.rearrangerReverse,
            regions: deck.rearrangerRegions,
          },
          deck.rearrangerRegionIds,
          { chaosSeed }
        );
        const name = `${deck.fileName ?? "Loop"} Rearranged`;
        const wasPlaying = deck.status === "playing";
        if (options?.transient) {
          skipNextAutosaveRef.current += 1;
        }
        loadDeckBuffer(deckId, rearranged, {
          name,
          autoplay: wasPlaying,
          recordHistory: !options?.transient,
          preserveNodes: options?.transient,
          preserveFxState: options?.transient,
          rearrangerRegions: nextRegions,
          rearrangerRegionIds: nextRegionIds,
        });
      } finally {
        rearrangeBusyByDeckRef.current.set(deckId, false);
      }
    },
    [decks, loadDeckBuffer]
  );

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const tracker = rearrangeLoopTrackerRef.current;
      const busyByDeck = rearrangeBusyByDeckRef.current;
      const activeDecks = new Set(decks.map((deck) => deck.id));
      tracker.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          tracker.delete(deckId);
        }
      });
      busyByDeck.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          busyByDeck.delete(deckId);
        }
      });

      decks.forEach((deck) => {
        const snapshot = getDeckPlaybackSnapshot(deck.id);
        const currentPosition = snapshot?.position ?? deck.offsetSeconds ?? 0;
        const state = tracker.get(deck.id) ?? {
          lastPosition: currentPosition,
          lastTriggerMs: 0,
        };

        if (
          !deck.rearrangerAuto ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled
        ) {
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
        if (loopLength < 0.08) {
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const triggerWindow = Math.min(0.12, loopLength * 0.25);
        const wrapped =
          state.lastPosition > currentPosition + 0.03 &&
          state.lastPosition > snapshot.loopStart + triggerWindow &&
          currentPosition <= snapshot.loopStart + triggerWindow;
        const cooldownMs = Math.max(120, Math.min(1000, loopLength * 500));

        if (wrapped && now - state.lastTriggerMs > cooldownMs) {
          handleRearrangeLoop(deck.id, { transient: true });
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: now,
          });
          return;
        }

        tracker.set(deck.id, {
          lastPosition: currentPosition,
          lastTriggerMs: state.lastTriggerMs,
        });
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [decks, getDeckPlaybackSnapshot, handleRearrangeLoop]);

  const encodeDecksForSession = useCallback(async () => {
    const sessionDecks = getSessionDecks();
    const blobs = new Map<string, Blob>();
    const decksWithBlobs = await Promise.all(
      sessionDecks.map(async (deckSession) => {
        const deck = decks.find((item) => item.id === deckSession.id);
        if (!deck?.buffer) {
          return deckSession;
        }
        const wav = await encodeWavOffThread(deck.buffer);
        const blobId = createSessionBlobId("deck");
        blobs.set(blobId, wav);
        return { ...deckSession, wavBlobId: blobId };
      })
    );

    return { decks: decksWithBlobs, blobs };
  }, [decks, getSessionDecks]);

  const encodeClipsForSession = useCallback(
    async (existingBlobs: Map<string, Blob>) => {
      const nextBlobs = new Map(existingBlobs);
      const clipSessions: ClipSession[] = [];

      for (const clip of clips) {
        let buffer = clip.buffer;
        if (!buffer) {
          const cached = clipBufferCacheRef.current.get(clip.id);
          if (cached && cached.blob === clip.blob) {
            buffer = cached.buffer;
          } else {
            const file = new File([clip.blob], `${clip.name}.webm`, {
              type: clip.blob.type || "audio/webm",
            });
            buffer = await decodeFile(file);
            clipBufferCacheRef.current.set(clip.id, { blob: clip.blob, buffer });
          }
        }
        const wav = await encodeWavOffThread(buffer);
        const blobId = createSessionBlobId("clip");
        nextBlobs.set(blobId, wav);
        clipSessions.push({
          id: clip.id,
          name: clip.name,
          durationSec: clip.durationSec ?? buffer.duration,
          gain: clip.gain,
          balance: clip.balance,
          pitchShift: clip.pitchShift,
          tempoOffset: clip.tempoOffset ?? 0,
          wavBlobId: blobId,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? false,
        });
      }

      return { clipSessions, blobs: nextBlobs };
    },
    [clips, decodeFile]
  );

  const encodeForExport = useCallback(async () => {
    const { decks: sessionDecks, blobs: deckBlobs } = await encodeDecksForSession();
    const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
    const nextName = sessionName.trim() || `Session ${new Date().toLocaleString()}`;
    const sessionFile: SessionFileState = {
      version: 1,
      name: nextName,
      savedAt: Date.now(),
      masterGain,
      welcomePanelDismissed,
      decks: sessionDecks.map((deck) => {
        const { wavBlobId: _wavBlobId, ...rest } = deck;
        return {
          ...rest,
          wavFile: _wavBlobId ? `audio/deck-${deck.id}.wav` : undefined,
        };
      }),
      clips: clipSessions.map((clip) => {
        const { wavBlobId: _wavBlobId, ...rest } = clip;
        return {
          ...rest,
          wavFile: `audio/clip-${clip.id}.wav`,
        };
      }),
    };

    const fileEntries: Array<{ path: string; data: Uint8Array }> = [];
    fileEntries.push({
      path: "session.json",
      data: new TextEncoder().encode(JSON.stringify(sessionFile)),
    });

    for (const deck of sessionDecks) {
      if (!deck.wavBlobId) continue;
      const wavFile = `audio/deck-${deck.id}.wav`;
      const blob = blobs.get(deck.wavBlobId);
      if (!blob) continue;
      fileEntries.push({
        path: wavFile,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    for (const clip of clipSessions) {
      const wavFile = `audio/clip-${clip.id}.wav`;
      const blob = blobs.get(clip.wavBlobId);
      if (!blob) continue;
      fileEntries.push({
        path: wavFile,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    return { sessionFile, entries: fileEntries };
  }, [encodeClipsForSession, encodeDecksForSession, masterGain, sessionName, welcomePanelDismissed]);

  const handleExportSession = useCallback(async () => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const { sessionFile, entries } = await encodeForExport();
      const zip = createZip(entries);
      const url = URL.createObjectURL(zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sessionFile.name.replace(/[^\w-]+/g, "-") || "session"}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSessionStatus(`Exported "${sessionFile.name}".`);
    } catch (error) {
      console.error("Failed to export session", error);
      setSessionStatus("Session export failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [encodeForExport, sessionBusy]);

  const importSessionFiles = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const files = readZip(buffer);
      const sessionEntry = files.get("session.json");
      if (!sessionEntry) {
        throw new Error("Missing session.json");
      }
      const sessionFile = JSON.parse(new TextDecoder().decode(sessionEntry)) as SessionFileState;
      if (sessionFile.version !== 1) {
        throw new Error("Unsupported session version");
      }
      const buffers = new Map<number, AudioBuffer | null>();
      const toArrayBuffer = (data: Uint8Array) => data.slice().buffer as ArrayBuffer;
      for (const deck of sessionFile.decks) {
        if (!deck.wavFile) {
          buffers.set(deck.id, null);
          continue;
        }
        const data = files.get(deck.wavFile);
        if (!data) {
          buffers.set(deck.id, null);
          continue;
        }
        const blob = new Blob([toArrayBuffer(data)], { type: "audio/wav" });
        const wavFile = new File([blob], deck.fileName ?? `Deck ${deck.id}.wav`, {
          type: "audio/wav",
        });
        const audioBuffer = await decodeFile(wavFile);
        buffers.set(deck.id, audioBuffer);
      }

      const sessionDecks: DeckSession[] = sessionFile.decks.map((deck) => ({
        ...deck,
        wavBlobId: undefined,
      }));

      loadSessionDecks(sessionDecks, buffers);

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
      const nextClips: ClipItem[] = [];
      let maxClipId = 0;
      for (const clip of sessionFile.clips) {
        const data = files.get(clip.wavFile);
        if (!data) continue;
        const blob = new Blob([toArrayBuffer(data)], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        nextClips.push({
          id: clip.id,
          name: clip.name,
          blob,
          url,
          durationSec: clip.durationSec,
          gain: clip.gain,
          balance: clip.balance ?? 0,
          pitchShift: clip.pitchShift ?? 0,
          tempoOffset: clip.tempoOffset ?? 0,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? Boolean(clip.settings),
        });
        maxClipId = Math.max(maxClipId, clip.id);
      }
      setClips(nextClips);
      clipIdRef.current = Math.max(1, maxClipId + 1);
      clipNameRef.current = Math.max(1, maxClipId + 1);
      setMasterGainValue(sessionFile.masterGain ?? 0.9);
      setSessionName(sessionFile.name);
      setWelcomePanelDismissed(
        sessionFile.welcomePanelDismissed ?? !isSessionBrandNew({
          decks: sessionDecks,
          clips: sessionFile.clips,
        })
      );
      setSessionStatus(`Imported "${sessionFile.name}".`);
    },
    [decodeFile, loadSessionDecks]
  );

  const handleSaveSession = useCallback(async () => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const { decks: sessionDecks, blobs: deckBlobs } = await encodeDecksForSession();
      const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
      const nextName = sessionName.trim() || `Session ${new Date().toLocaleString()}`;
      const id = createSessionId();
      const session: SessionState = {
        version: 1,
        id,
        name: nextName,
        savedAt: Date.now(),
        masterGain,
        welcomePanelDismissed,
        decks: sessionDecks,
        clips: clipSessions,
      };
      await saveSessionState(session, blobs);
      await refreshSessions();
      setSelectedSessionId(id);
      setSessionName(nextName);
      setSessionStatus(`Saved "${nextName}".`);
    } catch (error) {
      console.error("Failed to save session", error);
      setSessionStatus("Session save failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [
    encodeClipsForSession,
    encodeDecksForSession,
    refreshSessions,
    masterGain,
    sessionBusy,
    sessionName,
    welcomePanelDismissed,
  ]);

  useEffect(() => {
    if (!autosaveReady) return;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }
    if (skipNextAutosaveRef.current > 0) {
      skipNextAutosaveRef.current -= 1;
      return;
    }
    autosaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const { decks: sessionDecks, blobs: deckBlobs } = await encodeDecksForSession();
        const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
        const session: SessionState = {
          version: 1,
          id: AUTO_SESSION_ID,
          name: sessionName.trim() || "Untitled",
          savedAt: Date.now(),
          masterGain,
          welcomePanelDismissed,
          decks: sessionDecks,
          clips: clipSessions,
        };
        await saveSessionState(session, blobs);
      } catch (error) {
        console.error("Autosave failed", error);
      }
    }, 1200);
    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [
    autosaveReady,
    clips,
    decks,
    encodeClipsForSession,
    encodeDecksForSession,
    masterGain,
    sessionName,
    welcomePanelDismissed,
  ]);

  const decodeSessionDecks = useCallback(
    async (sessionDecks: DeckSession[], blobs: Map<string, Blob>) => {
      const buffers = new Map<number, AudioBuffer | null>();
      for (const deck of sessionDecks) {
        if (!deck.wavBlobId) {
          buffers.set(deck.id, null);
          continue;
        }
        const blob = blobs.get(deck.wavBlobId);
        if (!blob) {
          buffers.set(deck.id, null);
          continue;
        }
        const file = new File([blob], deck.fileName ?? `Deck ${deck.id}.wav`, {
          type: blob.type || "audio/wav",
        });
        const buffer = await decodeFile(file);
        buffers.set(deck.id, buffer);
      }
      return buffers;
    },
    [decodeFile]
  );

  const applySessionData = useCallback(
    async (session: SessionState, blobs: Map<string, Blob>) => {
      const buffers = await decodeSessionDecks(session.decks, blobs);
      loadSessionDecks(session.decks, buffers);

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
      const nextClips: ClipItem[] = [];
      let maxClipId = 0;
      for (const clip of session.clips) {
        const blob = blobs.get(clip.wavBlobId);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        nextClips.push({
          id: clip.id,
          name: clip.name,
          blob,
          url,
          durationSec: clip.durationSec,
          gain: clip.gain,
          balance: clip.balance ?? 0,
          pitchShift: clip.pitchShift ?? 0,
          tempoOffset: clip.tempoOffset ?? 0,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? Boolean(clip.settings),
        });
        maxClipId = Math.max(maxClipId, clip.id);
      }
      setClips(nextClips);
      clipIdRef.current = Math.max(1, maxClipId + 1);
      clipNameRef.current = Math.max(1, maxClipId + 1);
      setMasterGainValue(session.masterGain ?? 0.9);
      setSessionName(session.name);
      setWelcomePanelDismissed(
        session.welcomePanelDismissed ?? !isSessionBrandNew(session)
      );
    },
    [decodeSessionDecks, loadSessionDecks]
  );

  applySessionDataRef.current = applySessionData;

  useEffect(() => {
    const loadAutosave = async () => {
      const fxPanelPatch = loadFxPanelPatch();
      const loaded = await loadSessionState(AUTO_SESSION_ID);
      if (!loaded) {
        applyDeckFxPanelStatePatch(fxPanelPatch);
        autosaveReadyRef.current = true;
        setAutosaveReady(true);
        return;
      }
      await applySessionDataRef.current?.(loaded.session, loaded.blobs);
      applyDeckFxPanelStatePatch(fxPanelPatch);
      autosaveReadyRef.current = true;
      setAutosaveReady(true);
    };
    void loadAutosave();
  }, [applyDeckFxPanelStatePatch]);

  useEffect(() => {
    if (!autosaveReady) return;
    saveFxPanelPatch(buildFxPanelPatch(decks));
  }, [autosaveReady, decks]);

  const handleLoadSession = useCallback(async () => {
    if (sessionBusy) return;
    if (!selectedSessionId) {
      setSessionStatus("Select a session to load.");
      return;
    }
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const loaded = await loadSessionState(selectedSessionId);
      if (!loaded) {
        setSessionStatus("Session not found.");
        return;
      }

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));

      const { session, blobs } = loaded;
      await applySessionData(session, blobs);
      setSessionStatus(`Loaded "${session.name}".`);
    } catch (error) {
      console.error("Failed to load session", error);
      setSessionStatus("Session load failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [applySessionData, selectedSessionId, sessionBusy]);

  const handleNewSession = useCallback(() => {
    if (!window.confirm("Start a new session? This will clear the current session.")) {
      return;
    }
    resetDecks();
    clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
    setClips([]);
    clipIdRef.current = 1;
    clipNameRef.current = 1;
    setMasterGainValue(0.9);
    setSessionName("");
    setWelcomePanelDismissed(false);
    setSelectedSessionId(null);
    setSessionStatus(null);
  }, [resetDecks]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (sessionBusy) return;
      setSessionBusy(true);
      setSessionStatus(null);
      try {
        await importSessionFiles(file);
      } catch (error) {
        console.error("Failed to import session", error);
        setSessionStatus("Session import failed.");
      } finally {
        setSessionBusy(false);
      }
    },
    [importSessionFiles, sessionBusy]
  );

  const handleDeckActivate = useCallback((deckId: number) => {
    setActiveDeckId(deckId);
  }, []);

  const handleGlobalPlaybackToggle = useCallback(() => {
    if (hasActivePlayback) {
      decks.forEach((deck) => {
        if (deck.status === "playing") {
          pauseDeck(deck);
        }
      });
      return;
    }
    decks.forEach((deck) => {
      if (deck.status === "ready" || deck.status === "paused") {
        void playDeck(deck);
      }
    });
  }, [decks, hasActivePlayback, pauseDeck, playDeck]);

  const getActiveDeck = useCallback(
    () => (activeDeckId === null ? null : decks.find((deck) => deck.id === activeDeckId) ?? null),
    [activeDeckId, decks]
  );

  const handleFocusedDeckPlaybackToggle = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck || !deck.buffer) return;
    if (deck.status === "playing") {
      pauseDeck(deck);
      return;
    }
    if (deck.status === "ready" || deck.status === "paused") {
      void playDeck(deck);
    }
  }, [getActiveDeck, pauseDeck, playDeck]);

  const handleFocusedDeckRearrangerPanelToggle = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck) return;
    setDeckFxPanelOpen(deck.id, "rearranger", !deck.fxPanelOpen.rearranger);
  }, [getActiveDeck, setDeckFxPanelOpen]);

  const handleFocusedDeckLoopToggle = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck) return;
    setDeckLoop(deck.id, !deck.loopEnabled);
  }, [getActiveDeck, setDeckLoop]);

  const handleFocusedDeckLoopReset = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck || !deck.buffer) return;
    const duration = deck.duration ?? deck.buffer.duration;
    setDeckLoopBounds(deck.id, 0, duration);
  }, [getActiveDeck, setDeckLoopBounds]);

  const handleFocusedDeckZoom = useCallback(
    (direction: "in" | "out") => {
      const deck = getActiveDeck();
      if (!deck) return;
      const nearestIndex = ZOOM_STEPS.reduce((best, step, index) => {
        const bestDiff = Math.abs(ZOOM_STEPS[best] - deck.zoom);
        const nextDiff = Math.abs(step - deck.zoom);
        return nextDiff < bestDiff ? index : best;
      }, 0);
      const nextIndex =
        direction === "in"
          ? Math.min(ZOOM_STEPS.length - 1, nearestIndex + 1)
          : Math.max(0, nearestIndex - 1);
      setDeckZoom(deck.id, ZOOM_STEPS[nextIndex]);
    },
    [getActiveDeck, setDeckZoom]
  );

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key;
      const lower = key.toLowerCase();
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;

      if (hasPrimaryModifier) {
        if (lower === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
        if (lower === "s") {
          event.preventDefault();
          void handleSaveSession();
          return;
        }
        if (lower === "o") {
          event.preventDefault();
          void handleLoadSession();
        }
        return;
      }

      if (isTextInputTarget(event.target)) return;

      if (key === "?" && !event.altKey) {
        event.preventDefault();
        setShowKeyboardShortcuts((prev) => !prev);
        return;
      }

      if (event.altKey) return;

      if (key === " " || event.code === "Space") {
        event.preventDefault();
        if (event.shiftKey) {
          handleGlobalPlaybackToggle();
        } else {
          handleFocusedDeckPlaybackToggle();
        }
        return;
      }

      if (event.shiftKey) {
        if (lower === "l") {
          event.preventDefault();
          handleFocusedDeckLoopReset();
        }
        return;
      }

      if (lower === "r") {
        event.preventDefault();
        handleFocusedDeckRearrangerPanelToggle();
        return;
      }
      if (lower === "l") {
        event.preventDefault();
        handleFocusedDeckLoopToggle();
        return;
      }
      if (key === "=") {
        event.preventDefault();
        handleFocusedDeckZoom("out");
        return;
      }
      if (key === "-") {
        event.preventDefault();
        handleFocusedDeckZoom("in");
        return;
      }
      if (lower === "a") {
        event.preventDefault();
        addDeck();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    addDeck,
    handleGlobalPlaybackToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckZoom,
    handleLoadSession,
    handleSaveSession,
    redo,
    undo,
  ]);

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
    <div className="app">
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
              title="Undo"
              aria-label="Undo"
            >
              ←
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo"
              aria-label="Redo"
            >
              →
            </button>
            <button type="button" onClick={addDeck}>
              Add Deck
            </button>
            <button type="button" onClick={handleNewSession}>
              New
            </button>
            <button type="button" onClick={handleGlobalPlaybackToggle}>
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
          <details className="session-bar__details">
            <summary>Restore + Export</summary>
            <div className="session-bar__details-body">
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
                <button type="button" onClick={handleSaveSession} disabled={sessionBusy}>
                  Save Session
                </button>
              </div>
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
                >
                  Load Session
                </button>
              </div>
              <div className="session-bar__group session-bar__group--mix">
                <div className="transport__export">
                  <label>
                    Minutes
                    <input
                      type="number"
                      min="1"
                      max="60"
                      step="1"
                      value={exportMinutes}
                      onChange={(event) =>
                        handleExportMinutesChange(Number(event.target.value))
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
              <div className="session-bar__group session-bar__group--export">
                <button type="button" onClick={handleExportSession} disabled={sessionBusy}>
                  Export Zip
                </button>
                <button type="button" onClick={handleImportClick} disabled={sessionBusy}>
                  Import Zip
                </button>
              </div>
            </div>
          </details>
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
            onClick={() => setShowKeyboardShortcuts((prev) => !prev)}
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
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            onChange={handleImportChange}
            className="session-bar__input"
          />
        </div>
      </header>

      <main className="app__main">
        {showWelcomePanel ? (
          <WelcomePanel onClose={() => setWelcomePanelDismissed(true)} />
        ) : null}
        <ClipRecorder
          decks={decks}
          clips={clips}
          onLoadClip={handleLoadClipToDeck}
          onAddClip={addClip}
          onUpdateClip={updateClip}
          onRemoveClip={removeClip}
        />
        <DeckStack
          decks={decks}
          activeDeckId={activeDeckId}
          onDeckActivate={handleDeckActivate}
          onRemoveDeck={removeDeck}
          onLoadClick={handleLoadClick}
          onFileSelected={handleFileSelected}
          onPlay={playDeck}
          onPause={pauseDeck}
          onGainChange={setDeckGain}
          onFilterChange={setDeckFilter}
          onResonanceChange={setDeckResonance}
          onEqLowChange={setDeckEqLow}
          onEqMidChange={setDeckEqMid}
          onEqHighChange={setDeckEqHigh}
          onDelayTimeChange={setDeckDelayTime}
          onDelayFeedbackChange={setDeckDelayFeedback}
          onDelayMixChange={setDeckDelayMix}
          onDelayToneChange={setDeckDelayTone}
          onDelayPingPongChange={setDeckDelayPingPong}
          onFractalMixChange={setDeckFractalMix}
          onFractalStructureChange={setDeckFractalStructure}
          onFractalDepthChange={setDeckFractalDepth}
          onFractalDriftChange={setDeckFractalDrift}
          onFractalDecayChange={setDeckFractalDecay}
          onFractalToneChange={setDeckFractalTone}
          onBalanceChange={setDeckBalance}
          onPitchShiftChange={setDeckPitchShift}
          onSeek={seekDeck}
          onZoomChange={setDeckZoom}
          onLoopChange={setDeckLoop}
          onLoopBoundsChange={setDeckLoopBounds}
          onTempoOffsetChange={setDeckTempoOffset}
          onTempoPitchSyncChange={setDeckTempoPitchSync}
          onStretchRatioChange={setDeckStretchRatio}
          onStretchWindowSizeChange={setDeckStretchWindowSize}
          onStretchStereoWidthChange={setDeckStretchStereoWidth}
          onStretchPhaseRandomnessChange={setDeckStretchPhaseRandomness}
          onStretchTiltDbChange={setDeckStretchTiltDb}
          onStretchScatterChange={setDeckStretchScatter}
          onRearrangerSlicesChange={setDeckRearrangerSlices}
          onRearrangerOffsetChange={setDeckRearrangerOffset}
          onRearrangerChaosChange={setDeckRearrangerChaos}
          onRearrangerReverseChange={setDeckRearrangerReverse}
          onRearrangerAutoChange={setDeckRearrangerAuto}
          onRearrangerRegionsChange={setDeckRearrangerRegions}
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
          onAutomationDurationChange={setAutomationDuration}
          getDeckPosition={getDeckPosition}
          getDeckPlaybackSnapshot={getDeckPlaybackSnapshot}
          setFileInputRef={setFileInputRef}
          onSaveLoopClip={handleSaveLoopClip}
          onCropLoop={handleCropLoop}
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
    </div>
  );
};

export default App;
