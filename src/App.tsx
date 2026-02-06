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
  detectRearrangerRegionsFromBufferSegment,
  deriveRearrangedRegionIds,
  deriveRearrangedRegions,
  normalizeRearrangerRegionIds,
  normalizeRearrangerRegions,
  rearrangeBufferSegment,
} from "./utils/rearranger";

type PerformanceMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
};

const CLIP_AUTOMATION_SAMPLE_RATE = 30;
const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const MAX_EXPORT_AUTO_REARRANGE_CYCLES = 4096;
const hashStringToUint32 = (value: string) => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

const seededUnitFloat = (seed: number) => {
  let x = (seed >>> 0) || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 4294967296);
};
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

const removeBufferSegment = (
  buffer: AudioBuffer,
  startSample: number,
  endSample: number
) => {
  const safeStart = Math.max(0, Math.min(buffer.length, startSample));
  const safeEnd = Math.max(safeStart, Math.min(buffer.length, endSample));
  const removedLength = safeEnd - safeStart;
  if (removedLength <= 0) return null;
  const nextLength = Math.max(1, buffer.length - removedLength);
  const nextBuffer = new AudioBuffer({
    length: nextLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = nextBuffer.getChannelData(channel);
    target.set(source.subarray(0, safeStart), 0);
    target.set(source.subarray(safeEnd), safeStart);
  }
  return { buffer: nextBuffer, removedLength };
};

const removeBufferRanges = (
  buffer: AudioBuffer,
  ranges: Array<{ startSample: number; endSample: number }>
) => {
  if (ranges.length === 0) return null;
  const normalized: Array<{ startSample: number; endSample: number }> = [];
  const sorted = [...ranges]
    .map((range) => ({
      startSample: Math.max(0, Math.min(buffer.length, Math.round(range.startSample))),
      endSample: Math.max(0, Math.min(buffer.length, Math.round(range.endSample))),
    }))
    .filter((range) => range.endSample > range.startSample)
    .sort((a, b) => a.startSample - b.startSample);
  for (const range of sorted) {
    const last = normalized[normalized.length - 1];
    if (!last || range.startSample > last.endSample) {
      normalized.push(range);
      continue;
    }
    last.endSample = Math.max(last.endSample, range.endSample);
  }
  if (normalized.length === 0) return null;
  const removedLength = normalized.reduce(
    (sum, range) => sum + (range.endSample - range.startSample),
    0
  );
  if (removedLength <= 0 || removedLength >= buffer.length) return null;
  const nextLength = Math.max(1, buffer.length - removedLength);
  const nextBuffer = new AudioBuffer({
    length: nextLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = nextBuffer.getChannelData(channel);
    let writeHead = 0;
    let readHead = 0;
    for (const range of normalized) {
      if (range.startSample > readHead) {
        target.set(source.subarray(readHead, range.startSample), writeHead);
        writeHead += range.startSample - readHead;
      }
      readHead = range.endSample;
    }
    if (readHead < buffer.length) {
      target.set(source.subarray(readHead), writeHead);
    }
  }
  return { buffer: nextBuffer, removedLength, ranges: normalized };
};

const detectQuietRangesInSegment = (
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  quietThresholdControl = 0.3
) => {
  const segmentStart = Math.max(0, Math.min(buffer.length - 1, Math.round(startSample)));
  const segmentEnd = Math.max(segmentStart + 1, Math.min(buffer.length, Math.round(endSample)));
  const segmentLength = segmentEnd - segmentStart;
  if (segmentLength < 128) return [];
  const sampleRate = buffer.sampleRate;
  const frameSize = Math.max(32, Math.round(sampleRate * 0.012));
  const hopSize = Math.max(16, Math.floor(frameSize / 2));
  if (segmentLength <= frameSize + hopSize) return [];
  const frameCount = Math.floor((segmentLength - frameSize) / hopSize) + 1;
  const envelope = new Array<number>(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = segmentStart + frameIndex * hopSize;
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let offset = 0; offset < frameSize; offset += 1) {
        const sample = data[frameStart + offset] ?? 0;
        sum += sample * sample;
      }
    }
    const count = frameSize * buffer.numberOfChannels;
    envelope[frameIndex] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  const sorted = [...envelope].sort((a, b) => a - b);
  const p20 = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
  const p80 = sorted[Math.floor((sorted.length - 1) * 0.8)] ?? 0;
  const dynamic = Math.max(0, p80 - p20);
  const control = Math.min(Math.max(quietThresholdControl, 0), 1);
  const quietFactor = 0.03 + control * 0.17;
  const quietThreshold = p20 + dynamic * quietFactor;
  const minQuietSamples = Math.max(1, Math.round(sampleRate * 0.09));
  const keepGuardSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const ranges: Array<{ startSample: number; endSample: number }> = [];
  let runStart = -1;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const isQuiet = envelope[frameIndex] <= quietThreshold;
    if (isQuiet) {
      if (runStart < 0) runStart = frameIndex;
      continue;
    }
    if (runStart >= 0) {
      const start = segmentStart + runStart * hopSize + keepGuardSamples;
      const end = segmentStart + frameIndex * hopSize + frameSize - keepGuardSamples;
      if (end - start >= minQuietSamples) {
        ranges.push({ startSample: start, endSample: end });
      }
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    const start = segmentStart + runStart * hopSize + keepGuardSamples;
    const end = segmentEnd - keepGuardSamples;
    if (end - start >= minQuietSamples) {
      ranges.push({ startSample: start, endSample: end });
    }
  }
  const maxRemovalSamples = Math.floor(segmentLength * 0.7);
  let removed = 0;
  const capped: Array<{ startSample: number; endSample: number }> = [];
  for (const range of ranges) {
    const len = range.endSample - range.startSample;
    if (len <= 0) continue;
    if (removed + len <= maxRemovalSamples) {
      capped.push(range);
      removed += len;
      continue;
    }
    const remaining = maxRemovalSamples - removed;
    if (remaining >= minQuietSamples) {
      capped.push({
        startSample: range.startSample,
        endSample: range.startSample + remaining,
      });
    }
    break;
  }
  return capped;
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

const toProjectSlug = (name: string) => {
  const normalized = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "Untitled";
};

const buildTimestampedAudioFilename = (
  prefix: "loop-loop-loop-recording" | "loop-loop-loop-export",
  projectName: string,
  extension: "wav" | "webm"
) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const hours = now.getHours();
  const hour12 = hours % 12 || 12;
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const amPm = hours >= 12 ? "PM" : "AM";
  return `${prefix}_${toProjectSlug(projectName)}-${month}-${day}-${year}-${hour12}-${minute}-${second}-${amPm}.${extension}`;
};

const APPENDED_DECK_NAME_SUFFIXES = [
  / Rearranged$/,
  / Edited$/,
  / Trimmed$/,
  / Crop$/,
  / Stretch \d+(?:\.\d+)?x$/,
];

const stripAppendedDeckSuffixes = (name: string) => {
  let next = name.trim();
  let updated = true;
  while (updated && next) {
    updated = false;
    for (const pattern of APPENDED_DECK_NAME_SUFFIXES) {
      if (pattern.test(next)) {
        next = next.replace(pattern, "").trim();
        updated = true;
      }
    }
  }
  return next;
};

const buildDerivedDeckName = (fileName: string | undefined, suffix: string) => {
  const base = stripAppendedDeckSuffixes(fileName ?? "Loop") || "Loop";
  return `${base} ${suffix}`;
};

const inferAudioExtension = (mimeType: string | undefined, fallback = "wav") => {
  if (!mimeType) return fallback;
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4") || mimeType.includes("aac") || mimeType.includes("m4a")) return "m4a";
  return fallback;
};

const inferAudioMimeTypeFromPath = (path: string | undefined, fallback = "audio/wav") => {
  if (!path) return fallback;
  const lower = path.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return fallback;
};

const isSessionBrandNew = (session: {
  decks: Array<{ fileName?: string; wavBlobId?: string; wavFile?: string }>;
  clips: unknown[];
}) =>
  session.clips.length === 0 &&
  session.decks.every((deck) => !deck.wavBlobId && !deck.wavFile && !deck.fileName);

const App = () => {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [exportMinutes, setExportMinutes] = useState(1);
  const [exportSeconds, setExportSeconds] = useState(0);
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
  const [scrollToDeckId, setScrollToDeckId] = useState<number | null>(null);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [deckLayoutMode, setDeckLayoutMode] = useState<"single" | "two">("two");
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [showWelcomePanelOverride, setShowWelcomePanelOverride] = useState(false);
  const [zipDragOver, setZipDragOver] = useState(false);
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
  const clipIdRef = useRef(1);
  const clipNameRef = useRef(1);
  const clipsRef = useRef<ClipItem[]>([]);
  const clipBufferCacheRef = useRef<Map<number, { blob: Blob; buffer: AudioBuffer }>>(new Map());
  const autosaveTimeoutRef = useRef<number | null>(null);
  const skipInitialAutosaveHydrationRef = useRef(false);
  const zipDragDepthRef = useRef(0);
  const rearrangeLoopTrackerRef = useRef<Map<number, { lastPosition: number; lastTriggerMs: number }>>(
    new Map()
  );
  const delaySliceSyncTrackerRef = useRef<Map<number, number>>(new Map());
  const rearrangerPingPongStateRef = useRef<Map<number, { signature: string }>>(new Map());
  const pendingAutoRearrangeRef = useRef<
    Map<
      number,
      {
        sourceBuffer: AudioBuffer;
        signature: string;
        buffer: AudioBuffer;
        regions: number[];
        regionIds: number[];
      }
    >
  >(new Map());
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
    stopDeck,
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
    setDeckDelaySliceSync,
    setDeckDelayTimeTransient,
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
        delaySliceSync: deck.delaySliceSync,
        rearrangerSlices: deck.rearrangerSlices,
        rearrangerSwapCount: deck.rearrangerSwapCount,
        rearrangerChaos: deck.rearrangerChaos,
        rearrangerReverse: deck.rearrangerReverse,
        rearrangerSensitivity: deck.rearrangerSensitivity,
        rearrangerQuietThreshold: deck.rearrangerQuietThreshold,
        rearrangerSliceFadeMs: deck.rearrangerSliceFadeMs,
        rearrangerPingPong: deck.rearrangerPingPong,
        rearrangerAuto: deck.rearrangerAuto,
        rearrangerRegions: deck.rearrangerRegions,
        rearrangerRegionIds: deck.rearrangerRegionIds,
        rearrangerRegionsManual: deck.rearrangerRegionsManual ?? false,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: loopDuration,
        automation: {
          gain: toSnapshot(automation?.gain, deck.gain),
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
      const generatedName = `Clip ${clipNameRef.current}`;
      const name =
        clip.name === "(input)"
          ? `${generatedName} (input)`
          : clip.name ?? generatedName;
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
        name: buildDerivedDeckName(deck.fileName, "Loop"),
      };
    },
    [buildClipSettings, decks]
  );

  const handleLoadClipToDeck = useCallback(
    async (deckId: number, clip: ClipItem) => {
      const applyFxSettings = Boolean(clip.settings && clip.applyFxSettings);
      const makeClipFile = (blob: Blob, ext: string, fallbackType: string) =>
        new File([blob], `${clip.name}.${ext}`, {
          type: blob.type || fallbackType,
        });
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
    [handleFileSelected]
  );

  const handleSaveLoopClip = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const clip = await renderLoopClip(deckId, includeSettings);
      if (!clip) return;
      addClip(clip);
    },
    [addClip, renderLoopClip]
  );

  const handleDuplicateLoop = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const deck = decks.find((item) => item.id === deckId);
      const clip = await renderLoopClip(deckId, includeSettings);
      if (!clip) return;
      const newDeckId = addDeck({ afterId: deckId });
      setActiveDeckId(newDeckId);
      setScrollToDeckId(newDeckId);
      const name = deck
        ? buildDerivedDeckName(deck.fileName, "Duplicate")
        : clip.name;
      const file = new File([clip.blob], `${name}.wav`, {
        type: clip.blob.type || "audio/wav",
      });
      await handleFileSelected(newDeckId, file, {
        settings: includeSettings ? clip.settings : undefined,
      });
    },
    [addDeck, decks, handleFileSelected, renderLoopClip]
  );

  const handleCropLoop = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck) return;
      const clip = await renderLoopClip(deckId, true);
      if (!clip) return;
      const wasPlaying = deck.status === "playing";
      loadDeckBuffer(deckId, clip.buffer, {
        name: buildDerivedDeckName(deck.fileName, "Crop"),
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
    const exportDurationSec = Math.max(
      1,
      Math.round(exportMinutes) * 60 + Math.round(exportSeconds)
    );
    setExportEstimateLabel(
      `Approx export: ${formatEstimateDuration(exportDurationSec * 0.5)}`
    );
    setExporting(true);
    const durationSec = exportDurationSec;
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

    const scheduleRearrangerPingPongSpan = (
      panner: StereoPannerNode,
      startTime: number,
      spanDuration: number,
      regions: number[],
      amount: number
    ) => {
      if (spanDuration <= 0.000001) return;
      const sliceCount = Math.max(0, regions.length - 1);
      if (sliceCount <= 1) return;
      for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
        const normalizedStart = regions[sliceIndex] ?? 0;
        const eventTime = startTime + Math.max(0, normalizedStart) * spanDuration;
        if (eventTime > durationSec) break;
        const targetPan = (sliceIndex % 2 === 0 ? -1 : 1) * amount;
        panner.pan.setValueAtTime(targetPan, Math.max(0, eventTime));
      }
    };

    activeDecks.forEach((deck) => {
      if (!deck.buffer) return;
      const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
      const pitchValue = (automationState.get(deck.id)?.pitch?.active
        ? automationState.get(deck.id)?.pitch?.currentValue
        : deck.pitchShift) ?? deck.pitchShift;
      const delayTime = Math.min(Math.max(deck.delayTime ?? 0.35, 0.01), 1.5);
      const delayFeedback = Math.min(Math.max(deck.delayFeedback ?? 0.35, 0), 0.95);
      const delayMix = Math.min(Math.max(deck.delayMix ?? 0, 0), 1);
      const delayTone = Math.min(Math.max(deck.delayTone ?? 6000, 400), 12000);
      const delayPingPong = deck.delayPingPong ?? false;


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
      const loopStart = deck.loopStartSeconds ?? 0;
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? deck.loopEndSeconds
          : deck.buffer.duration;
      const pingPongAmount = Math.min(Math.max(deck.rearrangerPingPong ?? 0, 0), 1);

      const deckInput = offline.createGain();
      const balancedOut = applyBalanceOffline(offline, deckInput, {
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
      const rearrangerPanner = offline.createStereoPanner();
      balancedOut.connect(rearrangerPanner);
      rearrangerPanner.pan.setValueAtTime(0, 0);
      let preEq: AudioNode = rearrangerPanner;
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

      if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
        const hasAutoLoopRearrange =
          deck.rearrangerAuto && (deck.rearrangerSlices ?? 0) > 1;
        if (hasAutoLoopRearrange) {
          const startSample = Math.max(
            0,
            Math.min(deck.buffer.length - 1, Math.round(loopStart * deck.buffer.sampleRate))
          );
          const endSample = Math.max(
            startSample + 1,
            Math.min(deck.buffer.length, Math.round(loopEnd * deck.buffer.sampleRate))
          );
          const segmentSamples = Math.max(1, endSample - startSample);
          const loopSegment = trimBufferLeadingSamples(
            offline,
            deck.buffer,
            startSample,
            segmentSamples
          );
          const cycleDurationSec = Math.max(0.001, loopSegment.duration / tempoRatio);
          const estimatedCycles = Math.ceil(durationSec / cycleDurationSec);
          const cyclesToRender = Math.min(
            MAX_EXPORT_AUTO_REARRANGE_CYCLES,
            Math.max(1, estimatedCycles)
          );
          const deckSeedBase = hashStringToUint32(
            [
              sessionName,
              deck.id,
              deck.fileName ?? "",
              loopStart.toFixed(6),
              loopEnd.toFixed(6),
              tempoRatio.toFixed(6),
              deck.rearrangerSlices,
              deck.rearrangerSwapCount,
              deck.rearrangerChaos,
              deck.rearrangerReverse,
              deck.rearrangerSliceFadeMs,
              durationSec.toFixed(6),
            ].join("|")
          );
          let currentBuffer = loopSegment;
          let currentRegions = normalizeRearrangerRegions(
            deck.rearrangerRegions,
            deck.rearrangerSlices
          );
          let currentRegionIds = normalizeRearrangerRegionIds(
            deck.rearrangerRegionIds,
            deck.rearrangerSlices
          );
          let timelineSec = 0;

          for (let cycle = 0; cycle < cyclesToRender && timelineSec < durationSec; cycle += 1) {
            const cycleStartSec = timelineSec;
            const cycleDurationSec = Math.max(0.001, currentBuffer.duration / tempoRatio);
            if (pingPongAmount > 0.001) {
              scheduleRearrangerPingPongSpan(
                rearrangerPanner,
                cycleStartSec,
                cycleDurationSec,
                currentRegions,
                pingPongAmount
              );
            }
            const source = offline.createBufferSource();
            source.buffer = currentBuffer;
            source.playbackRate.value = tempoRatio;
            source.connect(deckInput);
            source.start(cycleStartSec, 0);
            timelineSec += cycleDurationSec;
            if (timelineSec >= durationSec) break;

            const cycleSeed = (deckSeedBase ^ Math.imul(cycle + 1, 2654435761)) >>> 0;
            const chaosSeed = seededUnitFloat(cycleSeed) * 1_000_000_000;
            const rearrangerParams = {
              slices: deck.rearrangerSlices,
              swapCount: deck.rearrangerSwapCount,
              chaos: deck.rearrangerChaos,
              reverse: deck.rearrangerReverse,
              regions: currentRegions,
              sliceFadeMs: deck.rearrangerSliceFadeMs,
            };
            const nextBuffer = rearrangeBufferSegment(
              currentBuffer,
              0,
              currentBuffer.duration,
              rearrangerParams,
              { chaosSeed }
            );
            currentRegions = deriveRearrangedRegions(rearrangerParams, {
              chaosSeed,
              segmentSamples: nextBuffer.length,
            });
            currentRegionIds = deriveRearrangedRegionIds(
              rearrangerParams,
              currentRegionIds,
              { chaosSeed }
            );
            currentBuffer = nextBuffer;
          }

          if (timelineSec < durationSec) {
            if (pingPongAmount > 0.001) {
              const cycleDurationSec = Math.max(0.001, currentBuffer.duration / tempoRatio);
              let pingPongTime = timelineSec;
              while (pingPongTime < durationSec) {
                scheduleRearrangerPingPongSpan(
                  rearrangerPanner,
                  pingPongTime,
                  cycleDurationSec,
                  currentRegions,
                  pingPongAmount
                );
                pingPongTime += cycleDurationSec;
              }
            }
            const tail = offline.createBufferSource();
            tail.buffer = currentBuffer;
            tail.playbackRate.value = tempoRatio;
            tail.loop = true;
            tail.loopStart = 0;
            tail.loopEnd = currentBuffer.duration;
            tail.connect(deckInput);
            tail.start(timelineSec, 0);
          }
          return;
        }
        if (pingPongAmount > 0.001 && (deck.rearrangerSlices ?? 0) > 1) {
          const cycleDurationSec = Math.max(0.001, (loopEnd - loopStart) / tempoRatio);
          const loopRegions = normalizeRearrangerRegions(
            deck.rearrangerRegions,
            deck.rearrangerSlices
          );
          let cycleStartSec = 0;
          while (cycleStartSec < durationSec) {
            scheduleRearrangerPingPongSpan(
              rearrangerPanner,
              cycleStartSec,
              cycleDurationSec,
              loopRegions,
              pingPongAmount
            );
            cycleStartSec += cycleDurationSec;
          }
        }
      }

      const source = offline.createBufferSource();
      source.buffer = deck.buffer;
      source.playbackRate.value = tempoRatio;
      source.connect(deckInput);
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
          link.download = buildTimestampedAudioFilename(
            "loop-loop-loop-recording",
            sessionName,
            "wav"
          );
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
          link.download = buildTimestampedAudioFilename(
            "loop-loop-loop-recording",
            sessionName,
            "webm"
          );
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
  }, [decodeFile, getMasterStream, recording, sessionName]);

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
        const name = buildDerivedDeckName(deck.fileName, `Stretch ${ratio.toFixed(1)}x`);
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
    (
      deckId: number,
      options?: {
        transient?: boolean;
        precomputed?: { buffer: AudioBuffer; regions: number[]; regionIds: number[] };
      }
    ) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      if ((deck.rearrangerSlices ?? 0) <= 1) return;
      if (rearrangeBusyByDeckRef.current.get(deckId)) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const playbackSnapshot = getDeckPlaybackSnapshot(deckId);
      const currentPosition = playbackSnapshot?.position ?? deck.offsetSeconds ?? 0;
      const nextOffsetSeconds = Math.min(Math.max(0, currentPosition), duration);
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return;

      rearrangeBusyByDeckRef.current.set(deckId, true);
      try {
        let rearranged: AudioBuffer;
        let nextRegions: number[];
        let nextRegionIds: number[];
        if (options?.precomputed) {
          rearranged = options.precomputed.buffer;
          nextRegions = options.precomputed.regions;
          nextRegionIds = options.precomputed.regionIds;
        } else {
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
          rearranged = rearrangeBufferSegment(deck.buffer, loopStart, loopDuration, {
            slices: deck.rearrangerSlices,
            swapCount: deck.rearrangerSwapCount,
            chaos: deck.rearrangerChaos,
            reverse: deck.rearrangerReverse,
            regions: deck.rearrangerRegions,
            sliceFadeMs: deck.rearrangerSliceFadeMs,
          }, { chaosSeed });
          nextRegions = deriveRearrangedRegions({
            slices: deck.rearrangerSlices,
            swapCount: deck.rearrangerSwapCount,
            chaos: deck.rearrangerChaos,
            reverse: deck.rearrangerReverse,
            regions: deck.rearrangerRegions,
            sliceFadeMs: deck.rearrangerSliceFadeMs,
          }, { chaosSeed, segmentSamples });
          nextRegionIds = deriveRearrangedRegionIds(
            {
              slices: deck.rearrangerSlices,
              swapCount: deck.rearrangerSwapCount,
              chaos: deck.rearrangerChaos,
              reverse: deck.rearrangerReverse,
              regions: deck.rearrangerRegions,
              sliceFadeMs: deck.rearrangerSliceFadeMs,
            },
            deck.rearrangerRegionIds,
            { chaosSeed }
          );
        }
        const name = buildDerivedDeckName(deck.fileName, "Rearranged");
        const wasPlaying = deck.status === "playing";
        if (options?.transient) {
          skipNextAutosaveRef.current += 1;
        }
        loadDeckBuffer(deckId, rearranged, {
          name,
          autoplay: wasPlaying,
          recordHistory: !options?.transient,
          preserveNodes: options?.transient,
          // Manual rearrange should keep current deck FX, matching auto-loop rearrange behavior.
          preserveFxState: true,
          offsetSeconds: nextOffsetSeconds,
          rearrangerRegions: nextRegions,
          rearrangerRegionIds: nextRegionIds,
        });
      } finally {
        rearrangeBusyByDeckRef.current.set(deckId, false);
      }
    },
    [decks, getDeckPlaybackSnapshot, loadDeckBuffer]
  );

  const handleDeleteRearrangerSlice = useCallback(
    (deckId: number, sliceIndex: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const sliceCount = Math.max(0, Math.round(deck.rearrangerSlices ?? 0));
      if (sliceCount <= 1) return;
      const clampedIndex = Math.max(0, Math.min(sliceCount - 1, Math.round(sliceIndex)));

      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration <= 0.01) return;

      const regions = normalizeRearrangerRegions(deck.rearrangerRegions, sliceCount);
      if (regions.length !== sliceCount + 1) return;
      const sliceStartSeconds = loopStart + loopDuration * regions[clampedIndex];
      const sliceEndSeconds = loopStart + loopDuration * regions[clampedIndex + 1];
      const sampleRate = deck.buffer.sampleRate;
      const startSample = Math.max(
        0,
        Math.min(deck.buffer.length - 1, Math.round(sliceStartSeconds * sampleRate))
      );
      const endSample = Math.max(
        startSample + 1,
        Math.min(deck.buffer.length, Math.round(sliceEndSeconds * sampleRate))
      );
      const removed = removeBufferSegment(deck.buffer, startSample, endSample);
      if (!removed) return;

      const removedDuration = removed.removedLength / sampleRate;
      const nextLoopStart = Math.min(loopStart, removed.buffer.duration);
      const nextLoopEnd = Math.min(
        removed.buffer.duration,
        Math.max(nextLoopStart + 0.01, loopEnd - removedDuration)
      );
      const nextLoopDuration = Math.max(0.01, nextLoopEnd - nextLoopStart);

      const absoluteBounds = regions.map((value) => loopStart + value * loopDuration);
      const nextAbsoluteBounds = absoluteBounds
        .filter((_, boundaryIndex) => boundaryIndex !== clampedIndex + 1)
        .map((seconds, boundaryIndex) => {
          if (boundaryIndex > clampedIndex) {
            return seconds - removedDuration;
          }
          return seconds;
        });
      const nextRegions =
        nextAbsoluteBounds.length > 2
          ? nextAbsoluteBounds.map((seconds, boundaryIndex, array) => {
              if (boundaryIndex === 0) return 0;
              if (boundaryIndex === array.length - 1) return 1;
              return Math.min(Math.max((seconds - nextLoopStart) / nextLoopDuration, 0), 1);
            })
          : undefined;
      const nextSlices = Math.max(0, sliceCount - 1);
      const currentIds = normalizeRearrangerRegionIds(deck.rearrangerRegionIds, sliceCount);
      const nextIds = [...currentIds];
      nextIds.splice(clampedIndex, 1);
      const wasPlaying = deck.status === "playing";

      loadDeckBuffer(deckId, removed.buffer, {
        name: buildDerivedDeckName(deck.fileName, "Edited"),
        autoplay: wasPlaying,
        preserveFxState: true,
        loopStartSeconds: nextLoopStart,
        loopEndSeconds: nextLoopEnd,
        rearrangerSlices: nextSlices,
        rearrangerRegions: nextRegions,
        rearrangerRegionIds: nextIds.slice(0, nextSlices),
        rearrangerRegionsManual: Boolean(nextRegions),
      });
    },
    [decks, loadDeckBuffer]
  );

  const handleAutoSliceRearranger = useCallback(
    (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration <= 0.01) return;
      const frameDurationMs =
        loopDuration > 180 ? 24 : loopDuration > 90 ? 20 : loopDuration > 45 ? 16 : 10;
      const currentSlices = Math.max(0, Math.round(deck.rearrangerSlices ?? 0));
      const maxSlices = currentSlices > 1 ? currentSlices : 16;
      const nextRegions = detectRearrangerRegionsFromBufferSegment(
        deck.buffer,
        loopStart,
        loopDuration,
        {
          maxSlices,
          frameDurationMs,
          sensitivity: deck.rearrangerSensitivity,
        }
      );
      setDeckRearrangerRegions(deckId, nextRegions);
    },
    [decks, setDeckRearrangerRegions]
  );

  const handleTrimQuietRearranger = useCallback(
    (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration <= 0.01) return;
      const sampleRate = deck.buffer.sampleRate;
      const loopStartSample = Math.max(
        0,
        Math.min(deck.buffer.length - 1, Math.round(loopStart * sampleRate))
      );
      const loopEndSample = Math.max(
        loopStartSample + 1,
        Math.min(deck.buffer.length, Math.round(loopEnd * sampleRate))
      );
      const quietRanges = detectQuietRangesInSegment(
        deck.buffer,
        loopStartSample,
        loopEndSample,
        deck.rearrangerQuietThreshold
      );
      if (quietRanges.length === 0) return;
      const removed = removeBufferRanges(deck.buffer, quietRanges);
      if (!removed) return;
      const removedDuration = removed.removedLength / sampleRate;
      const nextLoopStart = Math.min(loopStart, removed.buffer.duration);
      const nextLoopEnd = Math.min(
        removed.buffer.duration,
        Math.max(nextLoopStart + 0.01, loopEnd - removedDuration)
      );
      const wasPlaying = deck.status === "playing";
      loadDeckBuffer(deckId, removed.buffer, {
        name: buildDerivedDeckName(deck.fileName, "Trimmed"),
        autoplay: wasPlaying,
        preserveFxState: true,
        loopStartSeconds: nextLoopStart,
        loopEndSeconds: nextLoopEnd,
        rearrangerRegions: undefined,
        rearrangerRegionIds: undefined,
        rearrangerRegionsManual: false,
      });
    },
    [decks, loadDeckBuffer]
  );

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const tracker = rearrangeLoopTrackerRef.current;
      const delaySyncTracker = delaySliceSyncTrackerRef.current;
      const pingPongSchedule = rearrangerPingPongStateRef.current;
      const pendingAuto = pendingAutoRearrangeRef.current;
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
      delaySyncTracker.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          delaySyncTracker.delete(deckId);
        }
      });
      pingPongSchedule.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          pingPongSchedule.delete(deckId);
        }
      });
      pendingAuto.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          pendingAuto.delete(deckId);
        }
      });

      decks.forEach((deck) => {
        const snapshot = getDeckPlaybackSnapshot(deck.id);
        const currentPosition = snapshot?.position ?? deck.offsetSeconds ?? 0;
        const lastSyncedSlice = delaySyncTracker.get(deck.id) ?? -1;
        const restoreManualDelayTime = () => {
          if (lastSyncedSlice !== -1) {
            setDeckDelayTimeTransient(deck.id, deck.delayTime);
            delaySyncTracker.set(deck.id, -1);
          }
        };
        if (
          !deck.delaySliceSync ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled ||
          (deck.rearrangerSlices ?? 0) <= 1
        ) {
          restoreManualDelayTime();
        } else {
          const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
          if (loopLength <= 0.001) {
            restoreManualDelayTime();
          } else {
            const regions = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
            const sliceCount = Math.max(0, regions.length - 1);
            if (sliceCount <= 1) {
              restoreManualDelayTime();
            } else {
              const clampedPosition = Math.min(
                snapshot.loopEnd - 1e-6,
                Math.max(snapshot.loopStart, currentPosition)
              );
              const progress = Math.min(
                1 - 1e-6,
                Math.max(0, (clampedPosition - snapshot.loopStart) / loopLength)
              );
              let sliceIndex = sliceCount - 1;
              for (let i = 0; i < sliceCount; i += 1) {
                if (progress >= regions[i] && progress < regions[i + 1]) {
                  sliceIndex = i;
                  break;
                }
              }
              if (sliceIndex !== lastSyncedSlice) {
                const sliceDuration =
                  loopLength * Math.max(0, (regions[sliceIndex + 1] ?? 1) - (regions[sliceIndex] ?? 0));
                if (sliceDuration > 0.001) {
                  setDeckDelayTimeTransient(deck.id, Math.min(1.5, Math.max(0.01, sliceDuration)));
                }
                delaySyncTracker.set(deck.id, sliceIndex);
              }
            }
          }
        }
        const audioNow = getAudioCurrentTime();
        const resetPingPongPan = () => {
          setDeckRearrangerPanTransient(deck.id, 0);
          setDeckRearrangerPingPongLive(deck.id, 0, null);
          pingPongSchedule.delete(deck.id);
        };
        const pingPongAmount = Math.min(Math.max(deck.rearrangerPingPong ?? 0, 0), 1);
        if (
          pingPongAmount <= 1e-3 ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled ||
          (deck.rearrangerSlices ?? 0) <= 1
        ) {
          resetPingPongPan();
        } else {
          const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
          if (loopLength <= 0.001) {
            resetPingPongPan();
          } else {
            const regions = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
            const sliceCount = Math.max(0, regions.length - 1);
            if (sliceCount <= 1) {
              resetPingPongPan();
            } else {
              if (audioNow === null) {
                resetPingPongPan();
              } else {
                const clampedPosition = Math.min(
                  snapshot.loopEnd - 1e-6,
                  Math.max(snapshot.loopStart, currentPosition)
                );
                const playbackRate = Math.max(0.01, snapshot.playbackRate || 1);
                const regionsSignature = regions.map((value) => value.toFixed(6)).join(",");
                const signature = [
                  pingPongAmount.toFixed(4),
                  snapshot.loopStart.toFixed(5),
                  snapshot.loopEnd.toFixed(5),
                  clampedPosition.toFixed(5),
                  playbackRate.toFixed(5),
                  regionsSignature,
                ].join("|");
                const current = pingPongSchedule.get(deck.id);
                if (!current || current.signature !== signature) {
                  setDeckRearrangerPingPongLive(deck.id, pingPongAmount, {
                    enabled: true,
                    loopStart: snapshot.loopStart,
                    loopEnd: snapshot.loopEnd,
                    playbackRate,
                    regions,
                    anchorTime: audioNow,
                    anchorPosition: clampedPosition,
                  });
                  pingPongSchedule.set(deck.id, { signature });
                }
              }
            }
          }
        }
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
          pendingAuto.delete(deck.id);
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
        if (loopLength < 0.08) {
          pendingAuto.delete(deck.id);
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const sourceBuffer = deck.buffer;
        if (!sourceBuffer) {
          pendingAuto.delete(deck.id);
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const loopStart = Math.max(0, snapshot.loopStart);
        const loopEnd = Math.max(loopStart + 0.01, snapshot.loopEnd);
        const playbackRate = Math.max(0.01, snapshot.playbackRate || 1);
        const loopDuration = Math.max(0.01, loopEnd - loopStart);
        const clampedPosition = Math.min(loopEnd - 1e-6, Math.max(loopStart, currentPosition));
        const progress = Math.min(1 - 1e-6, Math.max(0, (clampedPosition - loopStart) / loopDuration));
        const timeUntilWrapSec = ((1 - progress) * loopDuration) / playbackRate;
        const rearrangerSignature = [
          deck.rearrangerSlices,
          deck.rearrangerSwapCount,
          deck.rearrangerChaos,
          deck.rearrangerReverse,
          deck.rearrangerSliceFadeMs,
          loopStart.toFixed(6),
          loopEnd.toFixed(6),
          (deck.rearrangerRegions ?? []).map((value) => value.toFixed(6)).join(","),
          (deck.rearrangerRegionIds ?? []).join(","),
          sourceBuffer.length,
        ].join("|");
        const cached = pendingAuto.get(deck.id);
        if (
          cached &&
          (cached.sourceBuffer !== sourceBuffer || cached.signature !== rearrangerSignature)
        ) {
          pendingAuto.delete(deck.id);
        }
        if (
          !pendingAuto.has(deck.id) &&
          !rearrangeBusyByDeckRef.current.get(deck.id) &&
          timeUntilWrapSec > 0.06
        ) {
          const chaosSeed = Math.random() * 1_000_000_000;
          const sampleRate = sourceBuffer.sampleRate;
          const startSample = Math.max(
            0,
            Math.min(sourceBuffer.length - 1, Math.round(loopStart * sampleRate))
          );
          const endSample = Math.max(
            startSample + 1,
            Math.min(sourceBuffer.length, Math.round(loopEnd * sampleRate))
          );
          const segmentSamples = Math.max(1, endSample - startSample);
          const buffer = rearrangeBufferSegment(sourceBuffer, loopStart, loopDuration, {
            slices: deck.rearrangerSlices,
            swapCount: deck.rearrangerSwapCount,
            chaos: deck.rearrangerChaos,
            reverse: deck.rearrangerReverse,
            regions: deck.rearrangerRegions,
            sliceFadeMs: deck.rearrangerSliceFadeMs,
          }, { chaosSeed });
          const regions = deriveRearrangedRegions({
            slices: deck.rearrangerSlices,
            swapCount: deck.rearrangerSwapCount,
            chaos: deck.rearrangerChaos,
            reverse: deck.rearrangerReverse,
            regions: deck.rearrangerRegions,
            sliceFadeMs: deck.rearrangerSliceFadeMs,
          }, { chaosSeed, segmentSamples });
          const regionIds = deriveRearrangedRegionIds(
            {
              slices: deck.rearrangerSlices,
              swapCount: deck.rearrangerSwapCount,
              chaos: deck.rearrangerChaos,
              reverse: deck.rearrangerReverse,
              regions: deck.rearrangerRegions,
              sliceFadeMs: deck.rearrangerSliceFadeMs,
            },
            deck.rearrangerRegionIds,
            { chaosSeed }
          );
          pendingAuto.set(deck.id, {
            sourceBuffer,
            signature: rearrangerSignature,
            buffer,
            regions,
            regionIds,
          });
        }

        const triggerWindow = Math.min(0.12, loopLength * 0.25);
        const wrapped =
          state.lastPosition > currentPosition + 0.03 &&
          state.lastPosition > snapshot.loopStart + triggerWindow &&
          currentPosition <= snapshot.loopStart + triggerWindow;
        const cooldownMs = Math.max(120, Math.min(1000, loopLength * 500));

        if (wrapped && now - state.lastTriggerMs > cooldownMs) {
          const prepared = pendingAuto.get(deck.id);
          if (
            prepared &&
            prepared.sourceBuffer === sourceBuffer &&
            prepared.signature === rearrangerSignature
          ) {
            handleRearrangeLoop(deck.id, {
              transient: true,
              precomputed: {
                buffer: prepared.buffer,
                regions: prepared.regions,
                regionIds: prepared.regionIds,
              },
            });
            pendingAuto.delete(deck.id);
          } else {
            handleRearrangeLoop(deck.id, { transient: true });
          }
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
  }, [
    decks,
    getAudioCurrentTime,
    getDeckPlaybackSnapshot,
    handleRearrangeLoop,
    setDeckDelayTimeTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
  ]);

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
        const blobId = createSessionBlobId("clip");
        nextBlobs.set(blobId, clip.blob);
        const mimeType = clip.blob.type || "audio/wav";
        const ext = inferAudioExtension(mimeType, "wav");
        clipSessions.push({
          id: clip.id,
          name: clip.name,
          durationSec: clip.durationSec,
          gain: clip.gain,
          balance: clip.balance,
          pitchShift: clip.pitchShift,
          tempoOffset: clip.tempoOffset ?? 0,
          audioBlobId: blobId,
          audioMimeType: mimeType,
          audioFileName: `${clip.name}.${ext}`,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? false,
        });
      }

      return { clipSessions, blobs: nextBlobs };
    },
    [clips]
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
        const { audioBlobId: _audioBlobId, wavBlobId: _wavBlobId, ...rest } = clip;
        const ext = inferAudioExtension(clip.audioMimeType, "wav");
        return {
          ...rest,
          audioFile: `audio/clip-${clip.id}.${ext}`,
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
      const blobId = clip.audioBlobId ?? clip.wavBlobId;
      if (!blobId) continue;
      const ext = inferAudioExtension(clip.audioMimeType, "wav");
      const audioFile = `audio/clip-${clip.id}.${ext}`;
      const blob = blobs.get(blobId);
      if (!blob) continue;
      fileEntries.push({
        path: audioFile,
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
        const audioPath = clip.audioFile ?? clip.wavFile;
        if (!audioPath) continue;
        const data = files.get(audioPath);
        if (!data) continue;
        const mimeType = clip.audioMimeType ?? inferAudioMimeTypeFromPath(audioPath, "audio/wav");
        const blob = new Blob([toArrayBuffer(data)], { type: mimeType });
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
        const blobId = clip.audioBlobId ?? clip.wavBlobId;
        if (!blobId) continue;
        const blob = blobs.get(blobId);
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
      if (skipInitialAutosaveHydrationRef.current) {
        applyDeckFxPanelStatePatch(fxPanelPatch);
        autosaveReadyRef.current = true;
        setAutosaveReady(true);
        return;
      }
      if (!loaded) {
        applyDeckFxPanelStatePatch(fxPanelPatch);
        autosaveReadyRef.current = true;
        setAutosaveReady(true);
        return;
      }
      if (skipInitialAutosaveHydrationRef.current) {
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
    skipInitialAutosaveHydrationRef.current = true;
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
    skipInitialAutosaveHydrationRef.current = true;
    resetDecks();
    clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
    setClips([]);
    clipIdRef.current = 1;
    clipNameRef.current = 1;
    setMasterGainValue(0.9);
    setSessionName("");
    setSelectedSessionId(null);
    setSessionStatus(null);
  }, [resetDecks]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const importSessionFromFile = useCallback(
    async (file: File) => {
      if (sessionBusy) return;
      skipInitialAutosaveHydrationRef.current = true;
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

  const handleImportChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      await importSessionFromFile(file);
    },
    [importSessionFromFile]
  );

  const handleOpenDemoLoop = useCallback(async () => {
    try {
      const response = await fetch("/example.zip");
      if (!response.ok) {
        throw new Error(`Failed to fetch demo zip: ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], "example.zip", {
        type: blob.type || "application/zip",
      });
      await importSessionFromFile(file);
    } catch (error) {
      console.error("Failed to open demo loop", error);
      setSessionStatus("Failed to open demo loop.");
    }
  }, [importSessionFromFile]);

  const hasFileDrag = useCallback(
    (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes("Files"),
    []
  );

  const findZipFile = useCallback((files: File[] | FileList | null | undefined) => {
    if (!files) return null;
    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".zip") || file.type === "application/zip") {
        return file;
      }
    }
    return null;
  }, []);

  const hasLikelyZipDrag = useCallback((dataTransfer: DataTransfer) => {
    if (!hasFileDrag(dataTransfer)) return false;
    if (findZipFile(dataTransfer.files)) return true;
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") continue;
      if (item.type === "application/zip" || item.type === "application/x-zip-compressed") {
        return true;
      }
    }
    return false;
  }, [findZipFile, hasFileDrag]);

  const handleAppDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    zipDragDepthRef.current += 1;
    if (hasLikelyZipDrag(event.dataTransfer)) {
      setZipDragOver(true);
    }
  }, [hasFileDrag, hasLikelyZipDrag]);

  const handleAppDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!zipDragOver && hasLikelyZipDrag(event.dataTransfer)) {
      setZipDragOver(true);
    }
  }, [hasFileDrag, hasLikelyZipDrag, zipDragOver]);

  const handleAppDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    zipDragDepthRef.current = Math.max(0, zipDragDepthRef.current - 1);
    if (zipDragDepthRef.current === 0) {
      setZipDragOver(false);
    }
  }, [hasFileDrag]);

  const handleAppDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      zipDragDepthRef.current = 0;
      setZipDragOver(false);
      const file = findZipFile(event.dataTransfer.files);
      if (!file) return;
      await importSessionFromFile(file);
    },
    [findZipFile, hasFileDrag, importSessionFromFile]
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
    commitDeckLoopBoundsHistory(deck.id);
  }, [commitDeckLoopBoundsHistory, getActiveDeck, setDeckLoopBounds]);

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
            <button type="button" onClick={() => addDeck()}>
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
                    <button type="button" onClick={handleSaveSession} disabled={sessionBusy}>
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
          onDelayTimeChange={setDeckDelayTime}
          onDelayFeedbackChange={setDeckDelayFeedback}
          onDelayMixChange={setDeckDelayMix}
          onDelayToneChange={setDeckDelayTone}
          onDelayPingPongChange={setDeckDelayPingPong}
          onDelaySliceSyncChange={setDeckDelaySliceSync}
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
