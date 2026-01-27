import { useCallback, useEffect, useRef, useState } from "react";
import DeckStack from "./components/DeckStack";
import ClipRecorder from "./components/ClipRecorder";
import TransportBar from "./components/TransportBar";
import useDecks from "./hooks/useDecks";
import useAudioEngine from "./hooks/useAudioEngine";
import type { ClipItem } from "./types/clip";
import type {
  ClipSession,
  DeckSession,
  SessionFileState,
  SessionMeta,
  SessionState,
} from "./types/session";
import { encodeWav } from "./utils/audio";
import {
  createPitchShiftNodes,
  ensurePitchShiftWorklet,
  setPitchShift,
} from "./audio/pitchShift";
import { createPaulStretchNode, ensurePaulStretchWorklet } from "./audio/paulStretch";
import { createLimiter, createSoftClipper } from "./audio/clipper";
import {
  createSessionBlobId,
  createSessionId,
  listSessionMetas,
  loadSessionState,
  saveSessionState,
} from "./utils/sessionStore";
import { createZip, readZip } from "./utils/zip";

type PerformanceMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
};

const eqStageCount = 2;

const applyEqGain = (filters: BiquadFilterNode[], value: number) => {
  const perStageGain = value / eqStageCount;
  filters.forEach((filter) => {
    filter.gain.value = perStageGain;
  });
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

const App = () => {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [exportMinutes, setExportMinutes] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const { getMasterStream, decodeFile } = useAudioEngine();
  const clipIdRef = useRef(1);
  const clipNameRef = useRef(1);
  const clipsRef = useRef<ClipItem[]>([]);
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
    setDeckPitchShift,
    seekDeck,
    setDeckZoom,
    setDeckLoop,
    setDeckLoopBounds,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
    setDeckStretchRatio,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
    getDeckPosition,
    getDeckPlaybackSnapshot,
    getSessionDecks,
    loadSessionDecks,
    undo,
    redo,
    canUndo,
    canRedo,
    loadDeckBuffer,
  } = useDecks();

  const getFilterTargets = useCallback((djFilter: number) => {
    const min = 60;
    const max = 20000;
    const highpassMax = 12000;
    const normalized = Math.min(Math.max(djFilter, -1), 1);
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const logHighMax = Math.log10(highpassMax);
    if (normalized < 0) {
      const t = 1 + normalized;
      const lowpass = Math.pow(10, logMin + t * (logMax - logMin));
      return { lowpass, highpass: min };
    }
    if (normalized > 0) {
      const t = normalized;
      const highpass = Math.pow(10, logMin + t * (logHighMax - logMin));
      return { lowpass: max, highpass };
    }
    return { lowpass: max, highpass: min };
  }, []);

  useEffect(() => {
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
  }, []);

  const scheduleLoopedSamples = useCallback(
    (
    samples: Float32Array,
    durationSec: number,
    renderDuration: number,
    onValue: (value: number, time: number) => void
  ) => {
    if (!durationSec || samples.length === 0 || renderDuration <= 0) return;
    const sampleRate = samples.length / durationSec;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    const totalSteps = Math.max(1, Math.ceil(renderDuration * sampleRate));
    for (let i = 0; i < totalSteps; i += 1) {
      const time = i / sampleRate;
      const value = samples[i % samples.length] ?? 0;
      onValue(value, time);
    }
  },
    []
  );

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

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
        },
        ...prev,
      ]);
    },
    []
  );

  const updateClip = useCallback((id: number, updates: Partial<ClipItem>) => {
    setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...updates } : clip)));
  }, []);

  const handleSaveLoopClip = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return;
      const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
      const sliceDuration = Math.max(0.01, loopEnd - loopStart);
      const renderDuration = sliceDuration / Math.max(0.01, tempoRatio);
      const sampleRate = deck.buffer.sampleRate;
      const targetSamples = Math.max(1, Math.ceil(renderDuration * sampleRate));
      const fftFrameSize = 1024;
      const osamp = 8;
      const pitchTrack = automationState.get(deckId)?.pitch;
      const pitchActive =
        Math.abs(deck.pitchShift) >= 0.001 || pitchTrack?.active === true;
      const latencySamples = pitchActive
        ? Math.round(fftFrameSize - fftFrameSize / osamp)
        : 0;
      const maxSilenceTrimSamples = Math.ceil(0.03 * sampleRate);
      const extraSamples = latencySamples + maxSilenceTrimSamples;
      const length = Math.max(1, targetSamples + extraSamples);
      const offline = new OfflineAudioContext(
        deck.buffer.numberOfChannels,
        length,
        sampleRate
      );
      try {
        await ensurePitchShiftWorklet(offline);
      } catch (error) {
        console.warn("Pitch shift worklet unavailable for clip render", error);
      }
      const source = offline.createBufferSource();
      source.buffer = deck.buffer;
      source.playbackRate.value = tempoRatio;
      const pitchShiftNodes = createPitchShiftNodes(offline);
      const balanceNode = offline.createStereoPanner();
      const highpass = offline.createBiquadFilter();
      highpass.type = "highpass";
      const lowpass = offline.createBiquadFilter();
      lowpass.type = "lowpass";
      const eqLow = Array.from({ length: eqStageCount }, () => {
        const filter = offline.createBiquadFilter();
        filter.type = "lowshelf";
        filter.frequency.value = 120;
        return filter;
      });
      const eqMid = Array.from({ length: eqStageCount }, () => {
        const filter = offline.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = 1000;
        return filter;
      });
      const eqHigh = Array.from({ length: eqStageCount }, () => {
        const filter = offline.createBiquadFilter();
        filter.type = "highshelf";
        filter.frequency.value = 8000;
        return filter;
      });
      const gainNode = offline.createGain();
      gainNode.gain.value = deck.gain;
      const clipper = createSoftClipper(offline);
      const limiter = createLimiter(offline);
      const masterGain = offline.createGain();
      masterGain.gain.value = 0.9;

      const automation = automationState.get(deckId);
      const djFilterTrack = automation?.djFilter;
      const resonanceTrack = automation?.resonance;
      const eqLowTrack = automation?.eqLow;
      const eqMidTrack = automation?.eqMid;
      const eqHighTrack = automation?.eqHigh;
      const balanceTrack = automation?.balance;

      const djFilterValue = djFilterTrack?.active ? djFilterTrack.currentValue : deck.djFilter;
      const resonanceValue = resonanceTrack?.active
        ? resonanceTrack.currentValue
        : deck.filterResonance;
      const eqLowValue = eqLowTrack?.active ? eqLowTrack.currentValue : deck.eqLowGain;
      const eqMidValue = eqMidTrack?.active ? eqMidTrack.currentValue : deck.eqMidGain;
      const eqHighValue = eqHighTrack?.active ? eqHighTrack.currentValue : deck.eqHighGain;
      const balanceValue = balanceTrack?.active ? balanceTrack.currentValue : deck.balance;
      const pitchValue = pitchTrack?.active ? pitchTrack.currentValue : deck.pitchShift;

      const targets = getFilterTargets(djFilterValue);
      highpass.frequency.value = targets.highpass;
      lowpass.frequency.value = targets.lowpass;
      highpass.Q.value = resonanceValue;
      lowpass.Q.value = resonanceValue;
      applyEqGain(eqLow, eqLowValue);
      applyEqGain(eqMid, eqMidValue);
      applyEqGain(eqHigh, eqHighValue);
      balanceNode.pan.value = balanceValue;
      setPitchShift(pitchShiftNodes, pitchValue);

      if (djFilterTrack?.active && djFilterTrack.durationSec > 0) {
        scheduleLoopedSamples(
          djFilterTrack.samples,
          djFilterTrack.durationSec,
          renderDuration,
          (value, time) => {
            const nextTargets = getFilterTargets(value);
            lowpass.frequency.setValueAtTime(nextTargets.lowpass, time);
            highpass.frequency.setValueAtTime(nextTargets.highpass, time);
          }
        );
      }
      if (resonanceTrack?.active && resonanceTrack.durationSec > 0) {
        scheduleLoopedSamples(
          resonanceTrack.samples,
          resonanceTrack.durationSec,
          renderDuration,
          (value, time) => {
            lowpass.Q.setValueAtTime(value, time);
            highpass.Q.setValueAtTime(value, time);
          }
        );
      }
      if (eqLowTrack?.active && eqLowTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqLowTrack.samples,
          eqLowTrack.durationSec,
          renderDuration,
          (value, time) => {
            const perStageGain = value / eqStageCount;
            eqLow.forEach((filter) => {
              filter.gain.setValueAtTime(perStageGain, time);
            });
          }
        );
      }
      if (eqMidTrack?.active && eqMidTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqMidTrack.samples,
          eqMidTrack.durationSec,
          renderDuration,
          (value, time) => {
            const perStageGain = value / eqStageCount;
            eqMid.forEach((filter) => {
              filter.gain.setValueAtTime(perStageGain, time);
            });
          }
        );
      }
      if (eqHighTrack?.active && eqHighTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqHighTrack.samples,
          eqHighTrack.durationSec,
          renderDuration,
          (value, time) => {
            const perStageGain = value / eqStageCount;
            eqHigh.forEach((filter) => {
              filter.gain.setValueAtTime(perStageGain, time);
            });
          }
        );
      }
      if (balanceTrack?.active && balanceTrack.durationSec > 0) {
        scheduleLoopedSamples(
          balanceTrack.samples,
          balanceTrack.durationSec,
          renderDuration,
          (value, time) => {
            balanceNode.pan.setValueAtTime(value, time);
          }
        );
      }
      if (pitchTrack?.active && pitchTrack.durationSec > 0 && pitchShiftNodes.worklet) {
        const pitchParam = pitchShiftNodes.worklet.parameters.get("pitch");
        if (pitchParam) {
          pitchShiftNodes.dryGain.gain.value = 0;
          pitchShiftNodes.wetGain.gain.value = 1;
          scheduleLoopedSamples(
            pitchTrack.samples,
            pitchTrack.durationSec,
            renderDuration,
            (value, time) => {
              pitchParam.setValueAtTime(value, time);
            }
          );
        }
      }

      source.connect(balanceNode);
      balanceNode.connect(pitchShiftNodes.input);
      pitchShiftNodes.output.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(eqLow[0]);
      for (let i = 0; i < eqLow.length - 1; i++) {
        eqLow[i].connect(eqLow[i + 1]);
      }
      eqLow[eqLow.length - 1].connect(eqMid[0]);
      for (let i = 0; i < eqMid.length - 1; i++) {
        eqMid[i].connect(eqMid[i + 1]);
      }
      eqMid[eqMid.length - 1].connect(eqHigh[0]);
      for (let i = 0; i < eqHigh.length - 1; i++) {
        eqHigh[i].connect(eqHigh[i + 1]);
      }
      eqHigh[eqHigh.length - 1].connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(clipper);
      clipper.connect(masterGain);
      masterGain.connect(offline.destination);
      source.start(0, loopStart, renderDuration);
      void offline.startRendering().then((rendered) => {
        const silenceTrimSamples = findLeadingSilenceSamples(
          rendered,
          maxSilenceTrimSamples,
          1e-4
        );
        const totalTrim = Math.min(latencySamples + silenceTrimSamples, extraSamples);
        const trimmed = trimBufferLeadingSamples(
          offline,
          rendered,
          totalTrim,
          targetSamples
        );
        const blob = encodeWav(trimmed);
        addClip({
          blob,
          durationSec: trimmed.duration,
          buffer: trimmed,
          gain: 0.9,
          balance: 0,
          pitchShift: 0,
          tempoOffset: 0,
          name: `${deck.fileName ? `${deck.fileName} ` : ""}Loop`,
        });
      });
    },
    [addClip, automationState, decks, getFilterTargets, scheduleLoopedSamples]
  );

  const exportMixdown = useCallback(async () => {
    if (exporting) return;
    const activeDecks = decks.filter(
      (deck) => deck.status === "playing" && deck.buffer
    );
    if (activeDecks.length === 0) return;
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

      const balanceNode = offline.createStereoPanner();
      const pitchShiftNodes = createPitchShiftNodes(offline);
      const highpass = offline.createBiquadFilter();
      highpass.type = "highpass";
      const lowpass = offline.createBiquadFilter();
      lowpass.type = "lowpass";
      const eqLow = Array.from({ length: eqStageCount }, () => {
        const filter = offline.createBiquadFilter();
        filter.type = "lowshelf";
        filter.frequency.value = 120;
        return filter;
      });
      const eqMid = Array.from({ length: eqStageCount }, () => {
        const filter = offline.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = 1000;
        return filter;
      });
      const eqHigh = Array.from({ length: eqStageCount }, () => {
        const filter = offline.createBiquadFilter();
        filter.type = "highshelf";
        filter.frequency.value = 8000;
        return filter;
      });
      const gainNode = offline.createGain();
      const clipper = createSoftClipper(offline);
      const limiter = createLimiter(offline);

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
      const pitchValue = pitchTrack?.active ? pitchTrack.currentValue : deck.pitchShift;

      const targets = getFilterTargets(djFilterValue);
      highpass.frequency.value = targets.highpass;
      lowpass.frequency.value = targets.lowpass;
      highpass.Q.value = resonanceValue;
      lowpass.Q.value = resonanceValue;
      applyEqGain(eqLow, eqLowValue);
      applyEqGain(eqMid, eqMidValue);
      applyEqGain(eqHigh, eqHighValue);
      gainNode.gain.value = deck.gain;
      balanceNode.pan.value = balanceValue;
      setPitchShift(pitchShiftNodes, pitchValue);

      if (djFilterTrack?.active && djFilterTrack.durationSec > 0) {
        scheduleLoopedSamples(
          djFilterTrack.samples,
          djFilterTrack.durationSec,
          durationSec,
          (value, time) => {
            const nextTargets = getFilterTargets(value);
            lowpass.frequency.setValueAtTime(nextTargets.lowpass, time);
            highpass.frequency.setValueAtTime(nextTargets.highpass, time);
          }
        );
      }
      if (resonanceTrack?.active && resonanceTrack.durationSec > 0) {
        scheduleLoopedSamples(
          resonanceTrack.samples,
          resonanceTrack.durationSec,
          durationSec,
          (value, time) => {
            lowpass.Q.setValueAtTime(value, time);
            highpass.Q.setValueAtTime(value, time);
          }
        );
      }
      if (eqLowTrack?.active && eqLowTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqLowTrack.samples,
          eqLowTrack.durationSec,
          durationSec,
          (value, time) => {
            const perStageGain = value / eqStageCount;
            eqLow.forEach((filter) => {
              filter.gain.setValueAtTime(perStageGain, time);
            });
          }
        );
      }
      if (eqMidTrack?.active && eqMidTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqMidTrack.samples,
          eqMidTrack.durationSec,
          durationSec,
          (value, time) => {
            const perStageGain = value / eqStageCount;
            eqMid.forEach((filter) => {
              filter.gain.setValueAtTime(perStageGain, time);
            });
          }
        );
      }
      if (eqHighTrack?.active && eqHighTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqHighTrack.samples,
          eqHighTrack.durationSec,
          durationSec,
          (value, time) => {
            const perStageGain = value / eqStageCount;
            eqHigh.forEach((filter) => {
              filter.gain.setValueAtTime(perStageGain, time);
            });
          }
        );
      }
      if (balanceTrack?.active && balanceTrack.durationSec > 0) {
        scheduleLoopedSamples(
          balanceTrack.samples,
          balanceTrack.durationSec,
          durationSec,
          (value, time) => {
            balanceNode.pan.setValueAtTime(value, time);
          }
        );
      }
      if (pitchTrack?.active && pitchTrack.durationSec > 0 && pitchShiftNodes.worklet) {
        const pitchParam = pitchShiftNodes.worklet.parameters.get("pitch");
        if (pitchParam) {
          pitchShiftNodes.dryGain.gain.value = 0;
          pitchShiftNodes.wetGain.gain.value = 1;
          scheduleLoopedSamples(
            pitchTrack.samples,
            pitchTrack.durationSec,
            durationSec,
            (value, time) => {
              pitchParam.setValueAtTime(value, time);
            }
          );
        }
      }

      source.connect(balanceNode);
      balanceNode.connect(pitchShiftNodes.input);
      pitchShiftNodes.output.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(eqLow[0]);
      for (let i = 0; i < eqLow.length - 1; i++) {
        eqLow[i].connect(eqLow[i + 1]);
      }
      eqLow[eqLow.length - 1].connect(eqMid[0]);
      for (let i = 0; i < eqMid.length - 1; i++) {
        eqMid[i].connect(eqMid[i + 1]);
      }
      eqMid[eqMid.length - 1].connect(eqHigh[0]);
      for (let i = 0; i < eqHigh.length - 1; i++) {
        eqHigh[i].connect(eqHigh[i + 1]);
      }
      eqHigh[eqHigh.length - 1].connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(clipper);
      clipper.connect(masterMix);

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
    }
  }, [
    automationState,
    decks,
    exportMinutes,
    exporting,
    getFilterTargets,
    scheduleLoopedSamples,
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
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, deck.buffer.duration)
          : deck.buffer.duration;
      if (loopEnd <= loopStart + 0.01) return;
      const ratio = Math.min(Math.max(deck.stretchRatio ?? 2, 1), 16);
      const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
      const sliceDuration = Math.max(0.01, loopEnd - loopStart);
      // Duration to pull from the buffer in source-time so the rendered input is sliceDuration.
      const inputDurationSource = sliceDuration * tempoRatio;
      const sampleRate = deck.buffer.sampleRate;
      const winSize = 16384;
      const hopOut = winSize / 2;
      const inputSamples = Math.max(1, Math.ceil(sliceDuration * sampleRate));
      const outputSamples = Math.max(1, Math.ceil(sliceDuration * ratio * sampleRate));
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
      const stretchNode = createPaulStretchNode(
        offline,
        ratio,
        winSize,
        inputSamples,
        outputSamples
      );
      stretchNode.port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "paulstretch-debug") {
          console.info(
            `Paulstretch debug: base=${message.baseRatio} param=${message.ratioParam} resolved=${message.resolvedRatio} hopIn=${message.hopIn} hopOut=${message.hopOut} in=${message.inputSamples} out=${message.outputSamples} len=${message.paramLength}`
          );
        } else if (message?.type === "paulstretch-input-done") {
          console.info(
            `Paulstretch input done: in=${message.inputSamples} out=${message.outputSamples} emitted=${message.outputSamplesEmitted} total=${message.outputSamplesTotal} inputFrames=${message.inputFrames} tailFrames=${message.tailFrames} zeroFrames=${message.zeroFrames} read=${message.readPos} write=${message.writePos}`
          );
        } else if (message?.type === "paulstretch-output-done") {
          console.info(
            `Paulstretch output done: in=${message.inputSamples} out=${message.outputSamples} emitted=${message.outputSamplesEmitted} total=${message.outputSamplesTotal} inputFrames=${message.inputFrames} tailFrames=${message.tailFrames} zeroFrames=${message.zeroFrames} read=${message.readPos} write=${message.writePos}`
          );
        }
      };
      const source = offline.createBufferSource();
      const keepAlive = offline.createConstantSource();
      keepAlive.offset.value = 1e-6;
      source.buffer = deck.buffer;
      source.playbackRate.value = tempoRatio;
      source.connect(stretchNode, 0, 0);
      keepAlive.connect(stretchNode, 0, 1);
      stretchNode.connect(offline.destination);
      source.start(0, loopStart, inputDurationSource);
      keepAlive.start(0);
      keepAlive.stop(length / sampleRate);

      const rendered = await offline.startRendering();
      const lastNonSilent = findTrailingNonSilenceSample(rendered, 1e-4);
      setSessionStatus(
        `Stretch debug: out=${rendered.length} target=${outputSamples} lastNonSilent=${lastNonSilent}`
      );
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
      loadDeckBuffer(deckId, trimmed, { name, autoplay: true });
    },
    [decks, loadDeckBuffer]
  );

  const encodeDecksForSession = useCallback(async () => {
    const sessionDecks = getSessionDecks();
    const blobs = new Map<string, Blob>();
    const decksWithBlobs = await Promise.all(
      sessionDecks.map(async (deckSession) => {
        const deck = decks.find((item) => item.id === deckSession.id);
        if (!deck?.buffer) {
          return deckSession;
        }
        const wav = encodeWav(deck.buffer);
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
          const file = new File([clip.blob], `${clip.name}.webm`, {
            type: clip.blob.type || "audio/webm",
          });
          buffer = await decodeFile(file);
        }
        const wav = encodeWav(buffer);
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
  }, [encodeClipsForSession, encodeDecksForSession, sessionName]);

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
        const blob = new Blob([data], { type: "audio/wav" });
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
        const blob = new Blob([data], { type: "audio/wav" });
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
        });
        maxClipId = Math.max(maxClipId, clip.id);
      }
      setClips(nextClips);
      clipIdRef.current = Math.max(1, maxClipId + 1);
      clipNameRef.current = Math.max(1, maxClipId + 1);
      setSessionName(sessionFile.name);
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
  }, [encodeClipsForSession, encodeDecksForSession, refreshSessions, sessionBusy, sessionName]);

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
      const buffers = await decodeSessionDecks(session.decks, blobs);
      loadSessionDecks(session.decks, buffers);

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
        });
        maxClipId = Math.max(maxClipId, clip.id);
      }
      setClips(nextClips);
      clipIdRef.current = Math.max(1, maxClipId + 1);
      clipNameRef.current = Math.max(1, maxClipId + 1);
      setSessionName(session.name);
      setSessionStatus(`Loaded "${session.name}".`);
    } catch (error) {
      console.error("Failed to load session", error);
      setSessionStatus("Session load failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [decodeSessionDecks, loadSessionDecks, selectedSessionId, sessionBusy]);

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

  const hasActivePlayback = decks.some((deck) => deck.status === "playing");
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

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-row app__header-row--primary">
          <div className="app__brand">Loop Loop Loop</div>
          <div className="app__project">
            {sessionName.trim() ? `Project: ${sessionName}` : "Project: Untitled"}
          </div>
          <div className="app__status">{sessionStatus ?? "Audio engine: idle"}</div>
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
          <button type="button" onClick={handleGlobalPlaybackToggle}>
            {hasActivePlayback ? "Pause All" : "Play All"}
          </button>
          <details className="session-bar__details">
            <summary>Restore + Zip</summary>
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
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            onChange={handleImportChange}
            className="session-bar__input"
          />
        </div>
      </header>

      <TransportBar
        exportMinutes={exportMinutes}
        onExportMinutesChange={handleExportMinutesChange}
        onExport={exportMixdown}
        exporting={exporting}
        recording={recording}
        onRecordToggle={handleRecordToggle}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <main className="app__main">
        <ClipRecorder
          decks={decks}
          clips={clips}
          onLoadClip={handleFileSelected}
          onAddClip={addClip}
          onUpdateClip={updateClip}
        />
        <DeckStack
          decks={decks}
          onAddDeck={addDeck}
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
          onBalanceChange={setDeckBalance}
          onPitchShiftChange={setDeckPitchShift}
          onSeek={seekDeck}
          onZoomChange={setDeckZoom}
          onLoopChange={setDeckLoop}
          onLoopBoundsChange={setDeckLoopBounds}
          onTempoOffsetChange={setDeckTempoOffset}
          onTempoPitchSyncChange={setDeckTempoPitchSync}
          onStretchRatioChange={setDeckStretchRatio}
          onStretchLoop={handleStretchLoop}
          automationState={automationState}
          onAutomationStart={startAutomationRecording}
          onAutomationStop={stopAutomationRecording}
          onAutomationValueChange={updateAutomationValue}
          getAutomationPlayhead={getAutomationPlayhead}
          onAutomationToggle={toggleAutomationActive}
          onAutomationReset={resetAutomationTrack}
          getDeckPosition={getDeckPosition}
          getDeckPlaybackSnapshot={getDeckPlaybackSnapshot}
          setFileInputRef={setFileInputRef}
          onSaveLoopClip={handleSaveLoopClip}
        />
      </main>
    </div>
  );
};

export default App;
