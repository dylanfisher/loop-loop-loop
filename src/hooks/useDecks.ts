import { useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";

const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const [decks, setDecks] = useState<DeckState[]>([
    { id: 1, status: "idle", gain: 0.9, offsetSeconds: 0, zoom: 1, follow: true },
  ]);
  const { decodeFile, playBuffer, stop, setDeckGain, removeDeck: removeDeckNodes } =
    useAudioEngine();

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
      { id, status: "idle", gain: 0.9, offsetSeconds: 0, zoom: 1, follow: true },
    ]);
  };

  const removeDeck = (id: number) => {
    setDecks((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      stop(id);
      removeDeckNodes(id);
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
    });
    try {
      const buffer = await decodeFile(file);
      updateDeck(id, {
        status: "ready",
        buffer,
        duration: buffer.duration,
        offsetSeconds: 0,
        zoom: 1,
        follow: true,
      });
    } catch (error) {
      updateDeck(id, { status: "error" });
      console.error("Failed to decode audio", error);
    }
  };

  const playDeck = async (deck: DeckState) => {
    if (!deck.buffer) return;
    stop(deck.id);
    const offsetSeconds = deck.offsetSeconds ?? 0;
    updateDeck(deck.id, {
      status: "playing",
      startedAtMs: performance.now(),
      duration: deck.buffer.duration,
      offsetSeconds,
    });
    await playBuffer(deck.id, deck.buffer, () => {
      updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 });
    }, deck.gain, offsetSeconds);
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
        offsetSeconds
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
    setFileInputRef,
  };
};

export default useDecks;
