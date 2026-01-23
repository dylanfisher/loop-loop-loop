import { useCallback, useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";
import { estimateBpmFromBuffer } from "../audio/bpm";

const clampBpm = (value: number) => Math.min(Math.max(value, 1), 999);
const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
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

  const getFilterTargets = (djFilter: number) => {
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
  };

  const setDeckResonanceValue = (id: number, value: number) => {
    setDeckResonance(id, value);
    updateDeck(id, { filterResonance: value });
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
    let nextDeck: DeckState | null = null;
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        nextDeck = { ...deck, bpmOverride: nextValue };
        return nextDeck;
      })
    );

    if (!nextDeck) return;

    if (nextValue === null) {
      setDeckPlaybackRate(id, 1);
      return;
    }

    if (!nextDeck.bpm) return;

    setDeckPlaybackRate(id, clampPlaybackRate(nextValue / nextDeck.bpm));
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
    getDeckPosition,
    setFileInputRef,
  };
};

export default useDecks;
