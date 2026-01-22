import { useCallback, useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";
import { estimateBpmFromBuffer } from "../audio/bpm";

const clampBpm = (value: number) => Math.min(Math.max(value, 1), 999);
const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
const isTestEnv = import.meta.env.MODE === "test";
const debugLog = (...args: unknown[]) => {
  if (!isTestEnv) {
    console.log(...args);
  }
};
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
  const stretchWorkerRef = useRef<Worker | null>(null);
  const stretchRequestIdRef = useRef<Map<number, number>>(new Map());
  const stretchWorkerReadyRef = useRef(false);
  const stretchFallbackRef = useRef<Map<number, boolean>>(new Map());
  const stretchTargetBpmRef = useRef<Map<number, number>>(new Map());
  const stretchPendingRef = useRef<Map<number, boolean>>(new Map());
  const stretchStatusRef = useRef<"idle" | "loading" | "ready" | "error">("idle");
  const stretchTimeoutRef = useRef<Map<number, number>>(new Map());
  const [deckStretchStatus, setDeckStretchStatus] = useState<Map<number, "idle" | "stretching" | "stretched">>(
    new Map()
  );
  const playbackRateRef = useRef<Map<number, number>>(new Map());
  const [stretchEngineStatus, setStretchEngineStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
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
    setDeckTempoRatio,
    ensureTimeStretchWorklet,
  } = useAudioEngine();

  const getDeckTempoRatio = (deck: DeckState) => {
    const shouldFallback = stretchFallbackRef.current.get(deck.id) ?? false;
    if (!deck.bpmOverride || !deck.bpm) return 1;
    const ratio = clampPlaybackRate(deck.bpmOverride / deck.bpm);
    if (deck.preservePitch && !shouldFallback) {
      return ratio;
    }
    return ratio;
  };

  useEffect(() => {
    const fallbackRef = stretchFallbackRef;
    const targetRef = stretchTargetBpmRef;
    const pendingRef = stretchPendingRef;
    const timeoutRef = stretchTimeoutRef;
    const statusRef = stretchStatusRef;
    return () => {
      bpmWorkerRef.current?.terminate();
      bpmWorkerRef.current = null;
      bpmWorkerReadyRef.current = false;
      stretchWorkerRef.current?.terminate();
      stretchWorkerRef.current = null;
      stretchWorkerReadyRef.current = false;
      fallbackRef.current.clear();
      targetRef.current.clear();
      pendingRef.current.clear();
      statusRef.current = "idle";
      timeoutRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutRef.current.clear();
    };
  }, []);

  const setDeckStretchState = (deckId: number, status: "idle" | "stretching" | "stretched") => {
    setDeckStretchStatus((prev) => {
      const next = new Map(prev);
      next.set(deckId, status);
      return next;
    });
  };

  const ensureStretchEngineReady = () => {
    setStretchEngineStatus("loading");
    return ensureTimeStretchWorklet()
      .then(() => {
        setStretchEngineStatus("ready");
      })
      .catch((error) => {
        console.error("Time-stretch worklet failed to load", error);
        setStretchEngineStatus("error");
      });
  };

  const updateDeck = useCallback((id: number, updates: Partial<DeckState>) => {
    setDecks((prev) =>
      prev.map((deck) => (deck.id === id ? { ...deck, ...updates } : deck))
    );
  }, []);

  const applyStretchedBuffer = useCallback(
    (deckId: number, nextBuffer: AudioBuffer) => {
      updateDeck(deckId, {
        buffer: nextBuffer,
        duration: nextBuffer.duration,
      });
    },
    [updateDeck]
  );

  useEffect(() => {
    stretchStatusRef.current = stretchEngineStatus;
    debugLog("stretchEngineStatus", stretchEngineStatus);
  }, [stretchEngineStatus]);

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

  const getStretchWorker = useCallback(() => {
    debugLog("getStretchWorker: called", {
      ready: stretchWorkerReadyRef.current,
      hasWorker: typeof Worker !== "undefined",
      status: stretchEngineStatus,
    });
    if (stretchWorkerReadyRef.current || typeof Worker === "undefined") {
      debugLog("getStretchWorker: returning existing/unsupported", {
        ready: stretchWorkerReadyRef.current,
        hasWorker: typeof Worker !== "undefined",
        current: Boolean(stretchWorkerRef.current),
      });
      return stretchWorkerRef.current;
    }

    let worker: Worker;
    try {
      setStretchEngineStatus("loading");
      debugLog("Time-stretch worker: creating");
      debugLog(
        "Time-stretch worker: url",
        new URL("../workers/timeStretchWorker.ts", import.meta.url).toString()
      );
      worker = new Worker(new URL("../workers/timeStretchWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      console.error("Failed to initialize time-stretch worker", error);
      setStretchEngineStatus("error");
      return null;
    }
    const handleStretchFallback = (deckId: number) => {
      stretchFallbackRef.current.set(deckId, true);
      stretchPendingRef.current.set(deckId, false);
      const timeoutId = stretchTimeoutRef.current.get(deckId);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        stretchTimeoutRef.current.delete(deckId);
      }
      const targetBpm = stretchTargetBpmRef.current.get(deckId);
      if (!targetBpm) return;
      setDecks((prev) => {
        const deck = prev.find((item) => item.id === deckId);
        if (!deck || !deck.bpm) return prev;
        setDeckPlaybackRate(deckId, clampPlaybackRate(targetBpm / deck.bpm));
        return prev;
      });
    };
    worker.onmessage = (
      event: MessageEvent<{
        type?: string;
        deckId: number;
        requestId: number;
        channels?: ArrayBuffer[];
        sampleRate?: number;
        error?: string;
        attempt?: number;
        hasDefault?: boolean;
        hasConstructor?: boolean;
      }>
    ) => {
      if (event.data.type === "rubberband:load") {
        debugInfo("Time-stretch: loading Rubber Band", {
          attempt: event.data.attempt,
        });
        return;
      }
      if (event.data.type === "rubberband:ready") {
        debugInfo("Time-stretch: Rubber Band ready", {
          attempt: event.data.attempt,
          hasDefault: event.data.hasDefault,
          hasConstructor: event.data.hasConstructor,
          hasInterface: event.data.hasInterface,
        });
        setStretchEngineStatus("ready");
        return;
      }
      if (event.data.type === "rubberband:pong") {
        debugInfo("Time-stretch: worker pong");
        return;
      }
      if (event.data.type === "rubberband:wasm-url") {
        debugInfo("Time-stretch: Rubber Band wasm URL", event.data.url);
        return;
      }
      if (event.data.type === "rubberband:module-imported") {
        debugInfo("Time-stretch: Rubber Band module imported");
        return;
      }
      if (event.data.type === "rubberband:init") {
        debugInfo("Time-stretch: Rubber Band init", {
          hasDefault: event.data.hasDefault,
        });
        return;
      }
      if (event.data.type === "rubberband:result") {
        // fall through to handle buffer update
      }
      if (event.data.type === "rubberband:error") {
        console.error("Time-stretch: Rubber Band error", event.data.error);
        setStretchEngineStatus("error");
        const deckId = event.data.deckId;
        if (typeof deckId === "number") {
          handleStretchFallback(deckId);
        }
        return;
      }

      const { deckId, requestId, channels, sampleRate, error } = event.data;
      const latestRequestId = stretchRequestIdRef.current.get(deckId);
      if (latestRequestId !== requestId) return;

      const timeoutId = stretchTimeoutRef.current.get(deckId);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        stretchTimeoutRef.current.delete(deckId);
      }

      if (!channels || !sampleRate || channels.length === 0) {
        console.error("Time-stretch failed", { error, data: event.data });
        handleStretchFallback(deckId);
        setDeckStretchState(deckId, "idle");
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

      stretchFallbackRef.current.set(deckId, false);
      stretchPendingRef.current.set(deckId, false);
      if (channels.length > 0) {
        console.info("Time-stretch result", {
          deckId,
          length: new Float32Array(channels[0]).length,
          sampleRate,
          channels: channels.length,
        });
      }
      setDeckStretchState(deckId, "stretched");
      applyStretchedBuffer(deckId, nextBuffer);
    };
    worker.onerror = (event) => {
      console.error("Time-stretch worker error", event);
      setStretchEngineStatus("error");
      stretchPendingRef.current.forEach((_value, deckId) => {
        handleStretchFallback(deckId);
      });
    };
    worker.onmessageerror = (event) => {
      console.error("Time-stretch worker message error", event);
      setStretchEngineStatus("error");
      stretchPendingRef.current.forEach((_value, deckId) => {
        handleStretchFallback(deckId);
      });
    };
    worker.postMessage({ type: "ping" });
    setTimeout(() => {
      debugLog("Time-stretch worker: post-ping status", {
        ready: stretchWorkerReadyRef.current,
        status: stretchEngineStatus,
      });
    }, 0);
    stretchWorkerRef.current = worker;
    stretchWorkerReadyRef.current = true;
    return worker;
  }, [applyStretchedBuffer, createBuffer, setDeckPlaybackRate, stretchEngineStatus]);

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
        if (deck.preservePitch) {
          setDeckTempoRatio(deck.id, targetRate);
        } else {
          setDeckPlaybackRate(deck.id, targetRate);
        }
      }
    });

    Array.from(playbackRateRef.current.keys()).forEach((deckId) => {
      if (!seen.has(deckId)) {
        playbackRateRef.current.delete(deckId);
      }
    });
  }, [decks, setDeckPlaybackRate, setDeckTempoRatio]);

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

  const _startTimeStretch = (deck: DeckState, targetBpm: number) => {
    const sourceBuffer = deck.sourceBuffer ?? deck.buffer;
    if (!sourceBuffer || !deck.bpm) return;
    if (!deck.sourceBuffer) {
      updateDeck(deck.id, { sourceBuffer });
    }
    const tempoRatio = clampPlaybackRate(targetBpm / deck.bpm);
    stretchFallbackRef.current.set(deck.id, false);
    stretchTargetBpmRef.current.set(deck.id, targetBpm);
    stretchPendingRef.current.set(deck.id, true);
    setDeckStretchState(deck.id, "stretching");
    const timeoutId = window.setTimeout(() => {
      if (stretchPendingRef.current.get(deck.id)) {
        stretchFallbackRef.current.set(deck.id, true);
        stretchPendingRef.current.set(deck.id, false);
      }
    }, 1500);
    stretchTimeoutRef.current.set(deck.id, timeoutId);

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
    stretchFallbackRef.current.set(deck.id, true);
    stretchPendingRef.current.set(deck.id, false);
    setDeckStretchState(deck.id, "idle");
    setDeckPlaybackRate(deck.id, clampPlaybackRate(tempoRatio));
  };

  const applyBpmResult = (deckId: number, bpm: number | null, confidence: number) => {
    let nextRate: number | null = null;
    let shouldUpdateRate = false;
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
        return nextDeck;
      })
    );
    if (shouldUpdateRate && nextRate !== null) {
      setDeckPlaybackRate(deckId, nextRate);
    }
    if (deckSnapshot?.preservePitch && deckSnapshot.bpmOverride && deckSnapshot.bpm) {
      setDeckTempoRatio(deckId, getDeckTempoRatio(deckSnapshot));
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
      stretchFallbackRef.current.delete(id);
      stretchTargetBpmRef.current.delete(id);
      stretchPendingRef.current.delete(id);
      setDeckStretchState(id, "idle");
      const timeoutId = stretchTimeoutRef.current.get(id);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        stretchTimeoutRef.current.delete(id);
      }
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
    stretchFallbackRef.current.delete(id);
    stretchTargetBpmRef.current.delete(id);
    stretchPendingRef.current.delete(id);
    setDeckStretchState(id, "idle");
    const timeoutId = stretchTimeoutRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      stretchTimeoutRef.current.delete(id);
    }
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
    const tempoRatio = getDeckTempoRatio(deck);
    const playbackRate = deck.preservePitch ? 1 : tempoRatio;
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
      deck.loopEndSeconds,
      deck.preservePitch,
      tempoRatio
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
      const playbackRate = deck.preservePitch ? 1 : tempoRatio;
      void playBuffer(
        deck.id,
        deck.buffer,
        () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
        deck.gain,
        offsetSeconds,
        playbackRate,
        deck.loopEnabled,
        deck.loopStartSeconds,
        deck.loopEndSeconds,
        deck.preservePitch,
        tempoRatio
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
        const tempoRatio = getDeckTempoRatio(deck);
        const playbackRate = deck.preservePitch ? 1 : tempoRatio;

        void playBuffer(
          deck.id,
          deck.buffer,
          () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
          deck.gain,
          clampedOffset,
          playbackRate,
          value,
          nextDeck.loopStartSeconds,
          nextDeck.loopEndSeconds,
          deck.preservePitch,
          tempoRatio
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
            deck.preservePitch ? 1 : getDeckTempoRatio(deck),
            true,
            nextStart,
            nextEnd,
            deck.preservePitch,
            getDeckTempoRatio(deck)
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
      stretchFallbackRef.current.set(id, false);
      stretchTargetBpmRef.current.delete(id);
      stretchPendingRef.current.set(id, false);
      const timeoutId = stretchTimeoutRef.current.get(id);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        stretchTimeoutRef.current.delete(id);
      }
      stretchRequestIdRef.current.set(id, (stretchRequestIdRef.current.get(id) ?? 0) + 1);
      if (nextDeck.sourceBuffer && nextDeck.buffer !== nextDeck.sourceBuffer) {
        applyStretchedBuffer(id, nextDeck.sourceBuffer);
      }
      setDeckTempoRatio(id, 1);
      setDeckPlaybackRate(id, 1);
      setDeckStretchState(id, "idle");
      return;
    }

    if (nextDeck.preservePitch) {
      setDeckStretchState(id, "stretching");
      void ensureStretchEngineReady().then(() => setDeckStretchState(id, "stretched"));
      if (nextDeck.bpm) {
        stretchFallbackRef.current.set(id, false);
        setDeckTempoRatio(id, getDeckTempoRatio(nextDeck));
      }
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

  const setDeckPreservePitch = (id: number, value: boolean) => {
    debugLog("setDeckPreservePitch", { deckId: id, value });
    const currentDeck = decks.find((deck) => deck.id === id);
    if (!currentDeck) {
      console.warn("setDeckPreservePitch: deck missing", { deckId: id });
      return;
    }
    const nextDeck: DeckState = { ...currentDeck, preservePitch: value };
    setDecks((prev) =>
      prev.map((deck) => (deck.id === id ? { ...deck, preservePitch: value } : deck))
    );

    if (!value) {
      debugLog("Pitch lock disabled", { deckId: id });
      stretchFallbackRef.current.set(id, false);
      stretchTargetBpmRef.current.delete(id);
      stretchPendingRef.current.set(id, false);
      const timeoutId = stretchTimeoutRef.current.get(id);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        stretchTimeoutRef.current.delete(id);
      }
      stretchRequestIdRef.current.set(id, (stretchRequestIdRef.current.get(id) ?? 0) + 1);
      if (nextDeck.sourceBuffer && nextDeck.buffer !== nextDeck.sourceBuffer) {
        applyStretchedBuffer(id, nextDeck.sourceBuffer);
      }
      setDeckStretchState(id, "idle");
      const tempoRatio = getDeckTempoRatio(nextDeck);
      if (nextDeck.status === "playing" && nextDeck.buffer) {
        const position = getDeckPosition(id) ?? nextDeck.offsetSeconds ?? 0;
        stop(id);
        updateDeck(id, {
          status: "playing",
          startedAtMs: performance.now(),
          offsetSeconds: position,
        });
        void playBuffer(
          id,
          nextDeck.buffer,
          () => updateDeck(id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
          nextDeck.gain,
          position,
          tempoRatio,
          nextDeck.loopEnabled,
          nextDeck.loopStartSeconds,
          nextDeck.loopEndSeconds,
          false,
          tempoRatio
        );
      }
      if (nextDeck.bpmOverride && nextDeck.bpm) {
        setDeckPlaybackRate(id, tempoRatio);
      } else {
        setDeckPlaybackRate(id, 1);
      }
      return;
    }

    debugLog("Pitch lock enabled", { deckId: id });
    setDeckStretchState(id, "stretching");
    void ensureStretchEngineReady().then(() => setDeckStretchState(id, "stretched"));
    stretchFallbackRef.current.set(id, false);
    const currentRate = playbackRateRef.current.get(id);
    const tempoRatio = currentRate ?? getDeckTempoRatio(nextDeck);
    if (nextDeck.status === "playing" && nextDeck.buffer) {
      const position = getDeckPosition(id) ?? nextDeck.offsetSeconds ?? 0;
      stop(id);
      updateDeck(id, {
        status: "playing",
        startedAtMs: performance.now(),
        offsetSeconds: position,
      });
      void playBuffer(
        id,
        nextDeck.buffer,
        () => updateDeck(id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
        nextDeck.gain,
        position,
        1,
        nextDeck.loopEnabled,
        nextDeck.loopStartSeconds,
        nextDeck.loopEndSeconds,
        true,
        tempoRatio
      );
    }
    setDeckTempoRatio(id, tempoRatio);
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
    stretchEngineStatus,
    deckStretchStatus,
    getDeckPosition,
    setFileInputRef,
  };
};

export default useDecks;
