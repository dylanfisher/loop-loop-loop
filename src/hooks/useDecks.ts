import { useCallback, useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";
import { estimateBpmFromBuffer } from "../audio/bpm";

const clampBpm = (value: number) => Math.min(Math.max(value, 1), 999);
const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const AUTOMATION_SAMPLE_RATE = 30;
const MIN_AUTOMATION_DURATION = 0.25;

type AutomationParam = "djFilter" | "resonance";

type AutomationTrack = {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  recording: boolean;
  active: boolean;
  currentValue: number;
  lastIndex: number;
  lastPreviewLength: number;
  recordBuffer: number[];
  recordStartMs: number;
  lastSampleMs: number;
  playbackStartMs: number;
};

type AutomationDeck = {
  djFilter: AutomationTrack;
  resonance: AutomationTrack;
};

type AutomationView = {
  samples: Float32Array;
  previewSamples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  currentValue: number;
};

const createTrack = (initialValue: number): AutomationTrack => ({
  samples: new Float32Array(0),
  sampleRate: AUTOMATION_SAMPLE_RATE,
  durationSec: 0,
  recording: false,
  active: false,
  currentValue: initialValue,
  lastIndex: -1,
  lastPreviewLength: 0,
  recordBuffer: [],
  recordStartMs: 0,
  lastSampleMs: 0,
  playbackStartMs: 0,
});
const isTestEnv = import.meta.env.MODE === "test";
const debugInfo = (...args: unknown[]) => {
  if (!isTestEnv) {
    console.info(...args);
  }
};

const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const bpmWorkerRef = useRef<Worker | null>(null);
  const bpmRequestIdRef = useRef<Map<number, number>>(new Map());
  const bpmWorkerReadyRef = useRef(false);
  const playbackRateRef = useRef<Map<number, number>>(new Map());
  const automationRef = useRef<Map<number, AutomationDeck>>(new Map());
  const automationPlayheadRef = useRef<Map<number, Record<AutomationParam, number>>>(new Map());
  const [automationState, setAutomationState] = useState<Map<number, Record<AutomationParam, AutomationView>>>(
    new Map()
  );
  const [decks, setDecks] = useState<DeckState[]>([
    {
      id: 1,
      status: "idle",
      gain: 0.9,
      djFilter: 0,
      filterResonance: 0.7,
      offsetSeconds: 0,
      zoom: 1,
      follow: true,
      loopEnabled: false,
      loopStartSeconds: 0,
      loopEndSeconds: 0,
      bpm: null,
      bpmConfidence: 0,
      bpmOverride: null,
    },
  ]);
  const tapTempoRefs = useRef<Map<number, number[]>>(new Map());
  const {
    decodeFile,
    playBuffer,
    stop,
    setDeckGain,
    setDeckFilter,
    setDeckHighpass,
    setDeckResonance,
    removeDeck: removeDeckNodes,
    getDeckPosition,
    setDeckLoopParams,
    setDeckPlaybackRate,
  } = useAudioEngine();

  const getFilterTargets = useCallback((djFilter: number) => {
    const min = 60;
    const max = 20000;
    const highpassMax = 12000;
    const normalized = clamp(djFilter, -1, 1);
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

  const resetAutomation = (deckId: number, djFilterValue: number, resonanceValue: number) => {
    const automation: AutomationDeck = {
      djFilter: createTrack(djFilterValue),
      resonance: createTrack(resonanceValue),
    };
    automationRef.current.set(deckId, automation);
    automationPlayheadRef.current.set(deckId, { djFilter: 0, resonance: 0 });
    updateAutomationView(deckId);
  };

  const ensureAutomationDeck = (deckId: number, deck: DeckState) => {
    let automation = automationRef.current.get(deckId);
    if (!automation) {
      automation = {
        djFilter: createTrack(deck.djFilter),
        resonance: createTrack(deck.filterResonance),
      };
      automationRef.current.set(deckId, automation);
      automationPlayheadRef.current.set(deckId, { djFilter: 0, resonance: 0 });
      setAutomationState((prev) => {
        const next = new Map(prev);
        next.set(deckId, {
          djFilter: {
            samples: automation!.djFilter.samples,
            previewSamples: new Float32Array(0),
            durationSec: 0,
            recording: false,
            active: false,
            currentValue: automation!.djFilter.currentValue,
          },
          resonance: {
            samples: automation!.resonance.samples,
            previewSamples: new Float32Array(0),
            durationSec: 0,
            recording: false,
            active: false,
            currentValue: automation!.resonance.currentValue,
          },
        });
        return next;
      });
    }
    return automation;
  };

  const updateAutomationView = (deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    setAutomationState((prev) => {
      const next = new Map(prev);
      next.set(deckId, {
        djFilter: {
          samples: automation.djFilter.samples,
          previewSamples: automation.djFilter.recording
            ? new Float32Array(automation.djFilter.recordBuffer)
            : new Float32Array(0),
          durationSec: automation.djFilter.durationSec,
          recording: automation.djFilter.recording,
          active: automation.djFilter.active,
          currentValue: automation.djFilter.currentValue,
        },
        resonance: {
          samples: automation.resonance.samples,
          previewSamples: automation.resonance.recording
            ? new Float32Array(automation.resonance.recordBuffer)
            : new Float32Array(0),
          durationSec: automation.resonance.durationSec,
          recording: automation.resonance.recording,
          active: automation.resonance.active,
          currentValue: automation.resonance.currentValue,
        },
      });
      return next;
    });
  };

  const getDeckTempoRatio = (deck: DeckState) => {
    if (!deck.bpmOverride || !deck.bpm) return 1;
    return clampPlaybackRate(deck.bpmOverride / deck.bpm);
  };

  useEffect(() => {
    return () => {
      bpmWorkerRef.current?.terminate();
      bpmWorkerRef.current = null;
      bpmWorkerReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let running = true;
    const tick = (now: number) => {
      const automation = automationRef.current;
      automation.forEach((tracks, deckId) => {
        (Object.keys(tracks) as AutomationParam[]).forEach((param) => {
          const track = tracks[param];
          if (track.recording) {
            const interval = 1000 / track.sampleRate;
            while (now - track.lastSampleMs >= interval) {
              track.recordBuffer.push(track.currentValue);
              track.lastSampleMs += interval;
              track.durationSec = track.recordBuffer.length / track.sampleRate;
            }
            if (track.recordBuffer.length !== track.lastPreviewLength) {
              track.lastPreviewLength = track.recordBuffer.length;
              updateAutomationView(deckId);
            }
          }
          if (!track.recording && track.active && track.durationSec > 0) {
            const elapsedSec = (now - track.playbackStartMs) / 1000;
            const positionSec = elapsedSec % track.durationSec;
            const index = Math.min(
              track.samples.length - 1,
              Math.floor(positionSec * track.sampleRate)
            );
            const value = track.samples[index] ?? track.currentValue;
            track.currentValue = value;
            if (param === "djFilter") {
              const targets = getFilterTargets(value);
              setDeckFilter(deckId, targets.lowpass);
              setDeckHighpass(deckId, targets.highpass);
            } else {
              setDeckResonance(deckId, value);
            }
            if (index !== track.lastIndex) {
              track.lastIndex = index;
              updateAutomationView(deckId);
            }
            const playhead = positionSec / track.durationSec;
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] = playhead;
            }
          }
          if (!track.active || track.durationSec <= 0) {
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] = 0;
            }
          }
        });
      });

      if (running) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [getFilterTargets, setDeckFilter, setDeckHighpass, setDeckResonance]);

  const updateDeck = useCallback((id: number, updates: Partial<DeckState>) => {
    setDecks((prev) =>
      prev.map((deck) => (deck.id === id ? { ...deck, ...updates } : deck))
    );
  }, []);


  const getBpmWorker = () => {
    if (bpmWorkerReadyRef.current || typeof Worker === "undefined") {
      return bpmWorkerRef.current;
    }

    const worker = new Worker(new URL("../workers/bpmWorker.ts", import.meta.url), {
      type: "module",
    });
    debugInfo("BPM worker: created");
    debugInfo("BPM worker: url", new URL("../workers/bpmWorker.ts", import.meta.url).toString());
    worker.onmessage = (
      event: MessageEvent<{
        deckId: number;
        requestId: number;
        bpm: number | null;
        confidence: number;
      }>
    ) => {
      const { deckId, requestId, bpm, confidence } = event.data;
      const latestRequestId = bpmRequestIdRef.current.get(deckId);
      if (latestRequestId !== requestId) return;
      applyBpmResult(deckId, bpm, confidence);
    };
    bpmWorkerRef.current = worker;
    bpmWorkerReadyRef.current = true;
    return worker;
  };

  useEffect(() => {
    const seen = new Set<number>();
    decks.forEach((deck) => {
      seen.add(deck.id);
      const targetRate = getDeckTempoRatio(deck);
      const prevRate = playbackRateRef.current.get(deck.id);
      if (prevRate === undefined) {
        playbackRateRef.current.set(deck.id, targetRate);
        return;
      }
      if (prevRate !== targetRate) {
        playbackRateRef.current.set(deck.id, targetRate);
        setDeckPlaybackRate(deck.id, targetRate);
      }
    });

    Array.from(playbackRateRef.current.keys()).forEach((deckId) => {
      if (!seen.has(deckId)) {
        playbackRateRef.current.delete(deckId);
      }
    });
  }, [decks, setDeckPlaybackRate]);

  const startBpmAnalysis = (id: number, buffer: AudioBuffer) => {
    if (!buffer || typeof buffer.getChannelData !== "function") return;

    const nextRequestId = (bpmRequestIdRef.current.get(id) ?? 0) + 1;
    bpmRequestIdRef.current.set(id, nextRequestId);

    const worker = getBpmWorker();
    if (worker) {
      const channelData = buffer.getChannelData(0);
      const samplesCopy = new Float32Array(channelData.length);
      samplesCopy.set(channelData);
      worker.postMessage(
        {
          deckId: id,
          requestId: nextRequestId,
          samplesBuffer: samplesCopy.buffer,
          sampleRate: buffer.sampleRate,
        },
        [samplesCopy.buffer]
      );
      return;
    }

    const { bpm, confidence } = estimateBpmFromBuffer(buffer);
    const latestRequestId = bpmRequestIdRef.current.get(id);
    if (latestRequestId !== nextRequestId) return;
    applyBpmResult(id, bpm, confidence);
  };

  const applyBpmResult = (deckId: number, bpm: number | null, confidence: number) => {
    let nextRate: number | null = null;
    let shouldUpdateRate = false;
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== deckId) return deck;
        const nextDeck = { ...deck, bpm, bpmConfidence: confidence };
        if (nextDeck.bpmOverride && nextDeck.bpm) {
          nextRate = clampPlaybackRate(nextDeck.bpmOverride / nextDeck.bpm);
          shouldUpdateRate = true;
        }
        return nextDeck;
      })
    );
    if (shouldUpdateRate && nextRate !== null) {
      setDeckPlaybackRate(deckId, nextRate);
    }
  };

  const addDeck = () => {
    const id = nextDeckId.current;
    nextDeckId.current += 1;
    resetAutomation(id, 0, 0.7);
    setDecks((prev) => [
      ...prev,
      {
        id,
        status: "idle",
        gain: 0.9,
        djFilter: 0,
        filterResonance: 0.7,
        offsetSeconds: 0,
        zoom: 1,
        follow: true,
        loopEnabled: false,
        loopStartSeconds: 0,
        loopEndSeconds: 0,
        bpm: null,
        bpmConfidence: 0,
        bpmOverride: null,
      },
    ]);
  };

  const removeDeck = (id: number) => {
    setDecks((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      stop(id);
      removeDeckNodes(id);
      tapTempoRefs.current.delete(id);
      bpmRequestIdRef.current.delete(id);
      automationRef.current.delete(id);
      automationPlayheadRef.current.delete(id);
      setAutomationState((state) => {
        const next = new Map(state);
        next.delete(id);
        return next;
      });
      return prev.filter((deck) => deck.id !== id);
    });
  };

  const setFileInputRef = (id: number, node: HTMLInputElement | null) => {
    fileInputRefs.current.set(id, node);
  };

  const handleLoadClick = (id: number) => {
    fileInputRefs.current.get(id)?.click();
  };

  const handleFileSelected = async (id: number, file: File | null) => {
    if (!file) return;

    resetAutomation(id, 0, 0.7);
    updateDeck(id, {
      status: "loading",
      fileName: file.name,
      startedAtMs: undefined,
      offsetSeconds: 0,
      djFilter: 0,
      filterResonance: 0.7,
      zoom: 1,
      follow: true,
      loopEnabled: false,
      loopStartSeconds: 0,
      loopEndSeconds: 0,
      bpm: null,
      bpmConfidence: 0,
      bpmOverride: null,
    });
    tapTempoRefs.current.delete(id);
    bpmRequestIdRef.current.delete(id);
    try {
      const buffer = await decodeFile(file);
      updateDeck(id, {
        status: "ready",
        buffer,
        duration: buffer.duration,
        offsetSeconds: 0,
        djFilter: 0,
        filterResonance: 0.7,
        zoom: 1,
        follow: true,
        loopEnabled: false,
        loopStartSeconds: 0,
        loopEndSeconds: buffer.duration,
        bpm: null,
        bpmConfidence: 0,
        bpmOverride: null,
      });
      startBpmAnalysis(id, buffer);
    } catch (error) {
      updateDeck(id, { status: "error" });
      console.error("Failed to decode audio", error);
    }
  };

  const playDeck = async (deck: DeckState) => {
    if (!deck.buffer) return;
    stop(deck.id);
    let offsetSeconds = deck.offsetSeconds ?? 0;
    if (deck.loopEnabled && deck.loopEndSeconds > deck.loopStartSeconds) {
      const maxOffset = Math.max(deck.loopStartSeconds, deck.loopEndSeconds - 0.01);
      offsetSeconds = Math.min(Math.max(offsetSeconds, deck.loopStartSeconds), maxOffset);
    }
    updateDeck(deck.id, {
      status: "playing",
      startedAtMs: performance.now(),
      duration: deck.buffer.duration,
      offsetSeconds,
    });
    const tempoRatio = getDeckTempoRatio(deck);
    const filters = getFilterTargets(deck.djFilter);
    await playBuffer(
      deck.id,
      deck.buffer,
      () => {
        updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 });
      },
      deck.gain,
      offsetSeconds,
      tempoRatio,
      deck.loopEnabled,
      deck.loopStartSeconds,
      deck.loopEndSeconds,
      filters.lowpass,
      filters.highpass,
      deck.filterResonance
    );
  };

  const pauseDeck = (deck: DeckState) => {
    if (deck.status !== "playing") return;
    const position = getDeckPosition(deck.id);
    const duration = deck.duration ?? deck.buffer?.duration ?? 0;
    const offsetSeconds =
      position !== null ? Math.min(Math.max(0, position), duration) : deck.offsetSeconds ?? 0;

    stop(deck.id);
    updateDeck(deck.id, {
      status: "paused",
      startedAtMs: undefined,
      offsetSeconds,
    });
  };

  const seekDeck = (id: number, progress: number) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck || !deck.duration || !deck.buffer) return;

    const clamped = Math.min(Math.max(0, progress), 1);
    const offsetSeconds = clamped * deck.duration;

    if (deck.status === "playing") {
      updateDeck(id, {
        startedAtMs: performance.now(),
        offsetSeconds,
        status: "playing",
      });
      const tempoRatio = getDeckTempoRatio(deck);
      const filters = getFilterTargets(deck.djFilter);
      void playBuffer(
        deck.id,
        deck.buffer,
        () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
        deck.gain,
        offsetSeconds,
        tempoRatio,
        deck.loopEnabled,
        deck.loopStartSeconds,
        deck.loopEndSeconds,
        filters.lowpass,
        filters.highpass,
        deck.filterResonance
      );
      return;
    }

    updateDeck(id, { offsetSeconds });
  };

  const setDeckGainValue = (id: number, value: number) => {
    setDeckGain(id, value);
    updateDeck(id, { gain: value });
  };

  const setDeckFilterValue = (id: number, value: number) => {
    const targets = getFilterTargets(value);
    setDeckFilter(id, targets.lowpass);
    setDeckHighpass(id, targets.highpass);
    updateDeck(id, { djFilter: clamp(value, -1, 1) });
    const automation = automationRef.current.get(id);
    const track = automation?.djFilter;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
  };

  const setDeckResonanceValue = (id: number, value: number) => {
    setDeckResonance(id, value);
    updateDeck(id, { filterResonance: value });
    const automation = automationRef.current.get(id);
    const track = automation?.resonance;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
  };

  const startAutomationRecording = (id: number, param: AutomationParam) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck) return;
    const automation = ensureAutomationDeck(id, deck);
    const track = automation[param];
    track.recording = true;
    track.active = true;
    track.recordBuffer = [];
    track.samples = new Float32Array(0);
    track.durationSec = 0;
    track.recordStartMs = performance.now();
    track.lastSampleMs = track.recordStartMs;
    track.lastPreviewLength = 0;
    track.currentValue = param === "djFilter" ? deck.djFilter : deck.filterResonance;
    updateAutomationView(id);
  };

  const stopAutomationRecording = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    if (!track.recording) return;
    track.recording = false;
    const duration = track.recordBuffer.length / track.sampleRate;
    if (duration >= MIN_AUTOMATION_DURATION) {
      track.samples = new Float32Array(track.recordBuffer);
      track.durationSec = duration;
      track.playbackStartMs = performance.now();
    } else {
      track.samples = new Float32Array(0);
      track.durationSec = 0;
    }
    track.recordBuffer = [];
    track.lastPreviewLength = 0;
    updateAutomationView(id);
  };

  const updateAutomationValue = (id: number, param: AutomationParam, value: number) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    track.currentValue = value;
    if (param === "djFilter") {
      setDeckFilterValue(id, value);
    } else {
      setDeckResonanceValue(id, value);
    }
    if (track.recording || track.active) {
      updateAutomationView(id);
    }
  };

  const getAutomationPlayhead = (id: number, param: AutomationParam) => {
    const playheads = automationPlayheadRef.current.get(id);
    return playheads ? playheads[param] : 0;
  };

  const toggleAutomationActive = (id: number, param: AutomationParam, next: boolean) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    track.active = next;
    if (next) {
      track.playbackStartMs = performance.now();
    }
    updateAutomationView(id);
  };

  const resetAutomationTrack = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    track.samples = new Float32Array(0);
    track.recordBuffer = [];
    track.durationSec = 0;
    track.recording = false;
    track.active = false;
    track.lastPreviewLength = 0;
    updateAutomationView(id);
  };

  const setDeckZoomValue = (id: number, value: number) => {
    updateDeck(id, { zoom: value });
  };

  const setDeckFollowValue = (id: number, value: boolean) => {
    updateDeck(id, { follow: value });
  };

  const setDeckLoopValue = (id: number, value: boolean) => {
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const duration = deck.duration ?? deck.buffer?.duration ?? 0;
        const nextStart = deck.loopStartSeconds ?? 0;
        const nextEnd =
          deck.loopEndSeconds > nextStart + 0.01 ? deck.loopEndSeconds : duration;
        const nextDeck = {
          ...deck,
          loopEnabled: value,
          loopStartSeconds: nextStart,
          loopEndSeconds: nextEnd,
        };
        if (deck.status !== "playing" || !deck.buffer) {
          return nextDeck;
        }

        const currentPosition = getDeckPosition(deck.id);
        const offsetSeconds =
          currentPosition !== null ? currentPosition : deck.offsetSeconds ?? 0;
        const clampedOffset = value
          ? Math.min(Math.max(offsetSeconds, nextStart), Math.max(nextStart, nextEnd - 0.01))
          : offsetSeconds;
        const tempoRatio = getDeckTempoRatio(deck);

        const filters = getFilterTargets(deck.djFilter);
        void playBuffer(
          deck.id,
          deck.buffer,
          () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
          deck.gain,
          clampedOffset,
          tempoRatio,
          value,
          nextDeck.loopStartSeconds,
          nextDeck.loopEndSeconds,
          filters.lowpass,
          filters.highpass,
          deck.filterResonance
        );

        return {
          ...nextDeck,
          status: "playing",
          startedAtMs: performance.now(),
          offsetSeconds: clampedOffset,
          duration,
        };
      })
    );
  };

  const setDeckLoopBounds = (id: number, startSeconds: number, endSeconds: number) => {
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== id || !deck.buffer) return deck;
        const duration = deck.duration ?? deck.buffer.duration;
        const nextStart = Math.min(Math.max(0, startSeconds), duration);
        const nextEnd = Math.min(Math.max(nextStart + 0.05, endSeconds), duration);

        if (deck.status === "playing" && deck.loopEnabled) {
          const currentPosition = getDeckPosition(deck.id);
          if (
            currentPosition !== null &&
            currentPosition >= nextStart &&
            currentPosition <= nextEnd
          ) {
            setDeckLoopParams(deck.id, true, nextStart, nextEnd);
            return {
              ...deck,
              loopStartSeconds: nextStart,
              loopEndSeconds: nextEnd,
            };
          }

          const clampedOffset = Math.min(
            Math.max(currentPosition ?? nextStart, nextStart),
            Math.max(nextStart, nextEnd - 0.01)
          );
          const filters = getFilterTargets(deck.djFilter);
          void playBuffer(
            deck.id,
            deck.buffer,
            () =>
              updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
            deck.gain,
            clampedOffset,
            getDeckTempoRatio(deck),
            true,
            nextStart,
            nextEnd,
            filters.lowpass,
            filters.highpass,
            deck.filterResonance
          );
          return {
            ...deck,
            loopStartSeconds: nextStart,
            loopEndSeconds: nextEnd,
            startedAtMs: performance.now(),
            offsetSeconds: clampedOffset,
          };
        }

        return { ...deck, loopStartSeconds: nextStart, loopEndSeconds: nextEnd };
      })
    );
  };

  const setDeckBpmOverride = (id: number, value: number | null) => {
    const nextValue = value === null ? null : clampBpm(value);
    const currentDeck = decks.find((deck) => deck.id === id);
    if (!currentDeck) return;
    setDecks((prev) =>
      prev.map((deck) =>
        deck.id === id ? { ...deck, bpmOverride: nextValue } : deck
      )
    );

    if (nextValue === null) {
      setDeckPlaybackRate(id, 1);
      return;
    }

    if (!currentDeck.bpm) return;

    setDeckPlaybackRate(id, clampPlaybackRate(nextValue / currentDeck.bpm));
  };

  const tapTempo = (id: number) => {
    const now = performance.now();
    const history = tapTempoRefs.current.get(id) ?? [];
    const lastTap = history[history.length - 1];

    if (lastTap !== undefined && now - lastTap > 2000) {
      history.length = 0;
    }

    history.push(now);
    if (history.length > 6) {
      history.shift();
    }
    tapTempoRefs.current.set(id, history);

    if (history.length < 2) return;

    const intervals = history.slice(1).map((tap, index) => tap - history[index]);
    const averageInterval =
      intervals.reduce((sum, value) => sum + value, 0) / intervals.length;

    if (!Number.isFinite(averageInterval) || averageInterval <= 0) {
      return;
    }

    setDeckBpmOverride(id, clampBpm(60000 / averageInterval));
  };

  return {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    setDeckGain: setDeckGainValue,
    setDeckFilter: setDeckFilterValue,
    setDeckResonance: setDeckResonanceValue,
    seekDeck,
    setDeckZoom: setDeckZoomValue,
    setDeckFollow: setDeckFollowValue,
    setDeckLoop: setDeckLoopValue,
    setDeckLoopBounds,
    setDeckBpmOverride,
    tapTempo,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
    getDeckPosition,
    setFileInputRef,
  };
};

export default useDecks;
