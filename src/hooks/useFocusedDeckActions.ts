import { useCallback } from "react";
import type { DeckState } from "../types/deck";

type UseFocusedDeckActionsArgs = {
  decks: DeckState[];
  activeDeckId: number | null;
  pauseDeck: (deck: DeckState) => void;
  playDeck: (deck: DeckState) => Promise<void>;
  setDeckFxPanelOpen: (deckId: number, panel: keyof DeckState["fxPanelOpen"], open: boolean) => void;
  setDeckLoop: (deckId: number, enabled: boolean) => void;
  setDeckLoopBounds: (deckId: number, start: number, end: number) => void;
  commitDeckLoopBoundsHistory: (deckId: number) => void;
  removeDeck: (deckId: number) => void;
  handleCropLoop: (deckId: number) => Promise<void>;
  handleDuplicateLoop: (deckId: number, includeSettings: boolean) => Promise<void>;
  setDeckZoom: (deckId: number, zoom: number) => void;
  zoomSteps: readonly number[];
};

type FocusedDeckActionsResult = {
  handleGlobalPlaybackToggle: () => void;
  handleFocusedDeckPlaybackToggle: () => void;
  handleFocusedDeckRearrangerPanelToggle: () => void;
  handleFocusedDeckLoopToggle: () => void;
  handleFocusedDeckLoopReset: () => void;
  handleFocusedDeckRemove: () => void;
  handleFocusedDeckCrop: () => void;
  handleFocusedDeckDuplicate: () => void;
  handleFocusedDeckZoom: (direction: "in" | "out") => void;
};

const useFocusedDeckActions = ({
  decks,
  activeDeckId,
  pauseDeck,
  playDeck,
  setDeckFxPanelOpen,
  setDeckLoop,
  setDeckLoopBounds,
  commitDeckLoopBoundsHistory,
  removeDeck,
  handleCropLoop,
  handleDuplicateLoop,
  setDeckZoom,
  zoomSteps,
}: UseFocusedDeckActionsArgs): FocusedDeckActionsResult => {
  const hasActivePlayback = decks.some((deck) => deck.status === "playing");

  const getActiveDeck = useCallback(
    () => (activeDeckId === null ? null : decks.find((deck) => deck.id === activeDeckId) ?? null),
    [activeDeckId, decks]
  );

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

  const handleFocusedDeckRemove = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck) return;
    removeDeck(deck.id);
  }, [getActiveDeck, removeDeck]);

  const handleFocusedDeckCrop = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck || !deck.buffer) return;
    void handleCropLoop(deck.id);
  }, [getActiveDeck, handleCropLoop]);

  const handleFocusedDeckDuplicate = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck || !deck.buffer) return;
    void handleDuplicateLoop(deck.id, true);
  }, [getActiveDeck, handleDuplicateLoop]);

  const handleFocusedDeckZoom = useCallback(
    (direction: "in" | "out") => {
      const deck = getActiveDeck();
      if (!deck) return;
      const nearestIndex = zoomSteps.reduce((best, step, index) => {
        const bestDiff = Math.abs(zoomSteps[best] - deck.zoom);
        const nextDiff = Math.abs(step - deck.zoom);
        return nextDiff < bestDiff ? index : best;
      }, 0);
      const nextIndex =
        direction === "in"
          ? Math.min(zoomSteps.length - 1, nearestIndex + 1)
          : Math.max(0, nearestIndex - 1);
      setDeckZoom(deck.id, zoomSteps[nextIndex]);
    },
    [getActiveDeck, setDeckZoom, zoomSteps]
  );

  return {
    handleGlobalPlaybackToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckRemove,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    handleFocusedDeckZoom,
  };
};

export default useFocusedDeckActions;
