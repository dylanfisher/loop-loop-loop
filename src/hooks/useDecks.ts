import { useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";
import { estimateBpmFromBuffer } from "../audio/bpm";

const clampBpm = (value: number) => Math.min(Math.max(value, 1), 999);
const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);

const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const bpmWorkerRef = useRef<Worker | null>(null);
  const bpmRequestIdRef = useRef<Map<number, number>>(new Map());
  const bpmWorkerReadyRef = useRef(false);
  const stretchWorkerRef = useRef<Worker | null>(null);
  const stretchRequestIdRef = useRef<Map<number, number>>(new Map());
  const stretchWorkerReadyRef = useRef(false);
  const playbackRateRef = useRef<Map<number, number>>(new Map());
  const [decks, setDecks] = useState<DeckState[]>([
    {
      id: 1,
      status: "idle",
      gain: 0.9,
      offsetSeconds: 0,
      zoom: 1,
      follow: true,
      loopEnabled: false,
      loopStartSeconds: 0,
      loopEndSeconds: 0,
      bpm: null,
      bpmConfidence: 0,
      bpmOverride: null,
      preservePitch: false,
      sourceBuffer: undefined,
    },
  ]);
  const tapTempoRefs = useRef<Map<number, number[]>>(new Map());
  const {
    decodeFile,
    playBuffer,
    stop,
    setDeckGain,
    removeDeck: removeDeckNodes,
    getDeckPosition,
    setDeckLoopParams,
    setDeckPlaybackRate,
    createBuffer,
  } = useAudioEngine();

  const getDeckPlaybackRate = (deck: DeckState) => {
    if (deck.preservePitch && deck.bpmOverride && deck.bpm) {
      return 1;
    }
    if (!deck.bpmOverride || !deck.bpm) return 1;
    return clampPlaybackRate(deck.bpmOverride / deck.bpm);
  };

  useEffect(() => {
    return () => {
      bpmWorkerRef.current?.terminate();
      bpmWorkerRef.current = null;
      bpmWorkerReadyRef.current = false;
      stretchWorkerRef.current?.terminate();
      stretchWorkerRef.current = null;
      stretchWorkerReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const seen = new Set<number>();
    decks.forEach((deck) => {
      seen.add(deck.id);
      const targetRate = getDeckPlaybackRate(deck);
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

  const getBpmWorker = () => {
    if (bpmWorkerReadyRef.current || typeof Worker === "undefined") {
      return bpmWorkerRef.current;
    }

    const worker = new Worker(new URL("../workers/bpmWorker.ts", import.meta.url), {
      type: "module",
    });
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

  const getStretchWorker = () => {
    if (stretchWorkerReadyRef.current || typeof Worker === "undefined") {
      return stretchWorkerRef.current;
    }

    const worker = new Worker(new URL("../workers/timeStretchWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      event: MessageEvent<{
        deckId: number;
        requestId: number;
        channels?: ArrayBuffer[];
        sampleRate?: number;
        error?: string;
      }>
    ) => {
      const { deckId, requestId, channels, sampleRate, error } = event.data;
      const latestRequestId = stretchRequestIdRef.current.get(deckId);
      if (latestRequestId !== requestId) return;

      if (!channels || !sampleRate || channels.length === 0) {
        console.error("Time-stretch failed", error);
        return;
      }

      const nextBuffer = createBuffer(
        channels.length,
        new Float32Array(channels[0]).length,
        sampleRate
      );
      channels.forEach((buffer, index) => {
        nextBuffer.getChannelData(index).set(new Float32Array(buffer));
      });

      applyStretchedBuffer(deckId, nextBuffer);
    };
    stretchWorkerRef.current = worker;
    stretchWorkerReadyRef.current = true;
    return worker;
  };

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

  const applyStretchedBuffer = (deckId: number, nextBuffer: AudioBuffer) => {
    let restartPlayback = false;
    let nextOffsetSeconds = 0;
    let loopStartSeconds = 0;
    let loopEndSeconds = nextBuffer.duration;
    let shouldLoop = false;
    let deckGain = 0.9;

    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== deckId) return deck;
        const prevDuration = deck.duration ?? deck.buffer?.duration ?? nextBuffer.duration;
        const durationScale = prevDuration > 0 ? nextBuffer.duration / prevDuration : 1;
        const currentPosition = getDeckPosition(deck.id);
        const progress =
          prevDuration > 0
            ? Math.min(Math.max((currentPosition ?? deck.offsetSeconds ?? 0) / prevDuration, 0), 1)
            : 0;
        nextOffsetSeconds = progress * nextBuffer.duration;
        shouldLoop = deck.loopEnabled;
        loopStartSeconds = deck.loopStartSeconds * durationScale;
        loopEndSeconds = deck.loopEndSeconds * durationScale;
        restartPlayback = deck.status === "playing";
        deckGain = deck.gain;

        return {
          ...deck,
          buffer: nextBuffer,
          duration: nextBuffer.duration,
          offsetSeconds: nextOffsetSeconds,
          loopStartSeconds,
          loopEndSeconds: loopEndSeconds || nextBuffer.duration,
          startedAtMs: restartPlayback ? performance.now() : deck.startedAtMs,
        };
      })
    );

    if (restartPlayback) {
      void playBuffer(
        deckId,
        nextBuffer,
        () => updateDeck(deckId, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
        deckGain,
        nextOffsetSeconds,
        1,
        shouldLoop,
        loopStartSeconds,
        loopEndSeconds
      );
    }
  };

  const startTimeStretch = (deck: DeckState, targetBpm: number) => {
    const sourceBuffer = deck.sourceBuffer ?? deck.buffer;
    if (!sourceBuffer || !deck.bpm) return;
    if (!deck.sourceBuffer) {
      updateDeck(deck.id, { sourceBuffer });
    }
    const tempoRatio = clampPlaybackRate(targetBpm / deck.bpm);

    const nextRequestId = (stretchRequestIdRef.current.get(deck.id) ?? 0) + 1;
    stretchRequestIdRef.current.set(deck.id, nextRequestId);

    const worker = getStretchWorker();
    if (worker) {
      const channelBuffers = Array.from(
        { length: sourceBuffer.numberOfChannels },
        (_, index) => {
          const channelData = sourceBuffer.getChannelData(index);
          const copy = new Float32Array(channelData.length);
          copy.set(channelData);
          return copy.buffer;
        }
      );

      worker.postMessage(
        {
          deckId: deck.id,
          requestId: nextRequestId,
          channels: channelBuffers,
          sampleRate: sourceBuffer.sampleRate,
          tempoRatio,
        },
        channelBuffers
      );
      return;
    }

    console.warn("Time-stretch worker unavailable; falling back to playback rate.");
    setDeckPlaybackRate(deck.id, clampPlaybackRate(tempoRatio));
  };

  const applyBpmResult = (deckId: number, bpm: number | null, confidence: number) => {
    let nextRate: number | null = null;
    let shouldUpdateRate = false;
    let shouldStretch = false;
    let stretchTarget = 0;
    let deckSnapshot: DeckState | null = null;
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== deckId) return deck;
        const nextDeck = { ...deck, bpm, bpmConfidence: confidence };
        deckSnapshot = nextDeck;
        if (nextDeck.bpmOverride && nextDeck.bpm && !nextDeck.preservePitch) {
          nextRate = clampPlaybackRate(nextDeck.bpmOverride / nextDeck.bpm);
          shouldUpdateRate = true;
        }
        if (nextDeck.bpmOverride && nextDeck.bpm && nextDeck.preservePitch) {
          shouldStretch = true;
          stretchTarget = nextDeck.bpmOverride;
        }
        return nextDeck;
      })
    );
    if (shouldUpdateRate && nextRate !== null) {
      setDeckPlaybackRate(deckId, nextRate);
    }
    if (shouldStretch && deckSnapshot) {
      startTimeStretch(deckSnapshot, stretchTarget);
    }
  };

  const updateDeck = (id: number, updates: Partial<DeckState>) => {
    setDecks((prev) =>
      prev.map((deck) => (deck.id === id ? { ...deck, ...updates } : deck))
    );
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
        offsetSeconds: 0,
        zoom: 1,
        follow: true,
        loopEnabled: false,
        loopStartSeconds: 0,
        loopEndSeconds: 0,
        bpm: null,
        bpmConfidence: 0,
        bpmOverride: null,
        preservePitch: false,
        sourceBuffer: undefined,
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
      stretchRequestIdRef.current.delete(id);
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
      zoom: 1,
      follow: true,
      loopEnabled: false,
      loopStartSeconds: 0,
      loopEndSeconds: 0,
      bpm: null,
      bpmConfidence: 0,
      bpmOverride: null,
      preservePitch: false,
      sourceBuffer: undefined,
    });
    tapTempoRefs.current.delete(id);
    bpmRequestIdRef.current.delete(id);
    stretchRequestIdRef.current.delete(id);
    try {
      const buffer = await decodeFile(file);
      updateDeck(id, {
        status: "ready",
        buffer,
        duration: buffer.duration,
        offsetSeconds: 0,
        zoom: 1,
        follow: true,
        loopEnabled: false,
        loopStartSeconds: 0,
        loopEndSeconds: buffer.duration,
        bpm: null,
        bpmConfidence: 0,
        bpmOverride: null,
        preservePitch: false,
        sourceBuffer: buffer,
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
    const playbackRate = getDeckPlaybackRate(deck);
    await playBuffer(
      deck.id,
      deck.buffer,
      () => {
        updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 });
      },
      deck.gain,
      offsetSeconds,
      playbackRate,
      deck.loopEnabled,
      deck.loopStartSeconds,
      deck.loopEndSeconds
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
      const playbackRate = getDeckPlaybackRate(deck);
      void playBuffer(
        deck.id,
        deck.buffer,
        () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
        deck.gain,
        offsetSeconds,
        playbackRate,
        deck.loopEnabled,
        deck.loopStartSeconds,
        deck.loopEndSeconds
      );
      return;
    }

    updateDeck(id, { offsetSeconds });
  };

  const setDeckGainValue = (id: number, value: number) => {
    setDeckGain(id, value);
    updateDeck(id, { gain: value });
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
        const playbackRate = getDeckPlaybackRate(deck);

        void playBuffer(
          deck.id,
          deck.buffer,
          () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
          deck.gain,
          clampedOffset,
          playbackRate,
          value,
          nextDeck.loopStartSeconds,
          nextDeck.loopEndSeconds
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
          void playBuffer(
            deck.id,
            deck.buffer,
            () =>
              updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
            deck.gain,
            clampedOffset,
            getDeckPlaybackRate(deck),
            true,
            nextStart,
            nextEnd
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
      stretchRequestIdRef.current.set(id, (stretchRequestIdRef.current.get(id) ?? 0) + 1);
      if (nextDeck.sourceBuffer && nextDeck.buffer !== nextDeck.sourceBuffer) {
        applyStretchedBuffer(id, nextDeck.sourceBuffer);
      }
      setDeckPlaybackRate(id, 1);
      return;
    }

    if (!nextDeck.bpm) return;
    if (nextDeck.preservePitch) {
      startTimeStretch(nextDeck, nextValue);
      setDeckPlaybackRate(id, 1);
      return;
    }

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

  const setDeckPreservePitch = (id: number, value: boolean) => {
    let nextDeck: DeckState | null = null;
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        nextDeck = { ...deck, preservePitch: value };
        return nextDeck;
      })
    );

    if (!nextDeck) return;

    if (!value) {
      stretchRequestIdRef.current.set(id, (stretchRequestIdRef.current.get(id) ?? 0) + 1);
      if (nextDeck.sourceBuffer && nextDeck.buffer !== nextDeck.sourceBuffer) {
        applyStretchedBuffer(id, nextDeck.sourceBuffer);
      }
      if (nextDeck.bpmOverride && nextDeck.bpm) {
        setDeckPlaybackRate(id, clampPlaybackRate(nextDeck.bpmOverride / nextDeck.bpm));
      } else {
        setDeckPlaybackRate(id, 1);
      }
      return;
    }

    if (nextDeck.bpmOverride && nextDeck.bpm) {
      startTimeStretch(nextDeck, nextDeck.bpmOverride);
      setDeckPlaybackRate(id, 1);
    }
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
    seekDeck,
    setDeckZoom: setDeckZoomValue,
    setDeckFollow: setDeckFollowValue,
    setDeckLoop: setDeckLoopValue,
    setDeckLoopBounds,
    setDeckBpmOverride,
    tapTempo,
    setDeckPreservePitch,
    getDeckPosition,
    setFileInputRef,
  };
};

export default useDecks;
