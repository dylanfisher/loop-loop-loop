import { useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";
import { estimateBpmFromBuffer } from "../audio/bpm";

const clampBpm = (value: number) => Math.min(Math.max(value, 40), 240);

const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const bpmWorkerRef = useRef<Worker | null>(null);
  const bpmRequestIdRef = useRef<Map<number, number>>(new Map());
  const bpmWorkerReadyRef = useRef(false);
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
  } = useAudioEngine();

  useEffect(() => {
    return () => {
      bpmWorkerRef.current?.terminate();
      bpmWorkerRef.current = null;
      bpmWorkerReadyRef.current = false;
    };
  }, []);

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
      updateDeck(deckId, { bpm, bpmConfidence: confidence });
    };
    bpmWorkerRef.current = worker;
    bpmWorkerReadyRef.current = true;
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
    updateDeck(id, { bpm, bpmConfidence: confidence });
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
    await playBuffer(
      deck.id,
      deck.buffer,
      () => {
        updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 });
      },
      deck.gain,
      offsetSeconds,
      deck.loopEnabled,
      deck.loopStartSeconds,
      deck.loopEndSeconds
    );
  };

  const pauseDeck = (deck: DeckState) => {
    if (deck.status !== "playing") return;

    const startedAtMs = deck.startedAtMs ?? performance.now();
    const elapsedSeconds = (performance.now() - startedAtMs) / 1000;
    const baseOffset = deck.offsetSeconds ?? 0;
    const duration = deck.duration ?? deck.buffer?.duration ?? 0;
    const offsetSeconds = Math.min(baseOffset + elapsedSeconds, duration);

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
      void playBuffer(
        deck.id,
        deck.buffer,
        () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
        deck.gain,
        offsetSeconds,
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

        const startedAtMs = deck.startedAtMs ?? performance.now();
        const elapsedSeconds = (performance.now() - startedAtMs) / 1000;
        const baseOffset = deck.offsetSeconds ?? 0;
        const offsetSeconds = Math.min(baseOffset + elapsedSeconds, duration);
        const clampedOffset = value
          ? Math.min(Math.max(offsetSeconds, nextStart), Math.max(nextStart, nextEnd - 0.01))
          : offsetSeconds;

        void playBuffer(
          deck.id,
          deck.buffer,
          () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }),
          deck.gain,
          clampedOffset,
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
    updateDeck(id, { bpmOverride: nextValue });
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
