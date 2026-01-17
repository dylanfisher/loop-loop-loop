import { useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";

const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const [decks, setDecks] = useState<DeckState[]>([
    { id: 1, status: "idle", gain: 0.9 },
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
    setDecks((prev) => [...prev, { id, status: "idle", gain: 0.9 }]);
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

    updateDeck(id, { status: "loading", fileName: file.name });
    try {
      const buffer = await decodeFile(file);
      updateDeck(id, { status: "ready", buffer });
    } catch (error) {
      updateDeck(id, { status: "error" });
      console.error("Failed to decode audio", error);
    }
  };

  const playDeck = async (deck: DeckState) => {
    if (!deck.buffer) return;
    stop(deck.id);
    updateDeck(deck.id, { status: "playing" });
    await playBuffer(deck.id, deck.buffer, () => {
      updateDeck(deck.id, { status: "ready" });
    }, deck.gain);
  };

  const stopDeck = (deck: DeckState) => {
    stop(deck.id);
    updateDeck(deck.id, { status: deck.buffer ? "ready" : "idle" });
  };

  const setDeckGainValue = (id: number, value: number) => {
    setDeckGain(id, value);
    updateDeck(id, { gain: value });
  };

  return {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    stopDeck,
    setDeckGain: setDeckGainValue,
    setFileInputRef,
  };
};

export default useDecks;
