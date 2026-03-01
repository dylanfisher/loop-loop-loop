import { useCallback, useRef } from "react";
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
  setDeckWidthOverride: (deckId: number, value?: "full" | "half") => void;
  zoomSteps: readonly number[];
};

type FocusedDeckActionsResult = {
  handleGlobalPlaybackToggle: () => void;
  handleFocusedDeckPlaybackToggle: () => void;
  handleFocusedDeckRearrangerPanelToggle: () => void;
  handleFocusedDeckFxVisibilityToggle: () => void;
  handleAllDecksFxVisibilityToggle: () => void;
  handleFocusedDeckLoopToggle: () => void;
  handleFocusedDeckLoopReset: () => void;
  handleFocusedDeckRemove: () => void;
  handleFocusedDeckCrop: () => void;
  handleFocusedDeckDuplicate: () => void;
  handleFocusedDeckZoom: (direction: "in" | "out") => void;
  handleFocusedDeckWidthToggle: () => void;
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
  setDeckWidthOverride,
  zoomSteps,
}: UseFocusedDeckActionsArgs): FocusedDeckActionsResult => {
  const hasActivePlayback = decks.some((deck) => deck.status === "playing");
  const fxVisibilityMemoryRef = useRef<Map<number, DeckState["fxPanelOpen"]>>(new Map());
  const isDifferent = (value: number, target: number, epsilon = 1e-3) =>
    Math.abs(value - target) > epsilon;

  const getAdjustedFxPanels = useCallback((deck: DeckState) => {
    const adjusted: Partial<Record<keyof DeckState["fxPanelOpen"], boolean>> = {
      gain: isDifferent(deck.gain, 0.9),
      djFilter: isDifferent(deck.djFilter, 0),
      resonance: isDifferent(deck.filterResonance, 0),
      parametricEq:
        deck.eqMode === "parametric" &&
        deck.parametricEqBands.some(
          (band) =>
            band.enabled &&
            (Math.abs(band.gain) > 1e-3 || Math.abs(band.q - 1.2) > 1e-3)
        ),
      balance: isDifferent(deck.balance, 0),
      pitch: isDifferent(deck.pitchShift, 0),
      vocoder:
        isDifferent(deck.vocoderMix, 0) ||
        deck.vocoderCarrierDeckId !== null ||
        isDifferent(deck.vocoderModulatorMonitor, 0) ||
        isDifferent(deck.vocoderModDrive, 2) ||
        Math.round(deck.vocoderBandCount) !== 12 ||
        isDifferent(deck.vocoderBandSpread, 1) ||
        isDifferent(deck.vocoderAttackMs, 8) ||
        isDifferent(deck.vocoderReleaseMs, 5) ||
        isDifferent(deck.vocoderNoiseMix, 0) ||
        isDifferent(deck.vocoderGateThreshold, 0.5),
      delay:
        isDifferent(deck.delayMix, 0) ||
        isDifferent(deck.delayTime, 0.35) ||
        isDifferent(deck.delayFeedback, 0.35) ||
        isDifferent(deck.delayTone, 6000, 1) ||
        isDifferent(deck.delaySaturation ?? 0, 0) ||
        isDifferent(deck.delayDamping ?? 0, 0) ||
        isDifferent(deck.delaySafety ?? 0, 0) ||
        isDifferent(deck.delayRhythmMorph ?? 0, 0) ||
        isDifferent(deck.delayRhythmRateHz ?? 0, 0, 0.01) ||
        isDifferent(deck.delayRhythmSwing ?? 0, 0) ||
        isDifferent(deck.delayDuckDepth ?? 0, 0) ||
        isDifferent(deck.delayDuckThreshold ?? 0.2, 0.2) ||
        isDifferent(deck.delayDuckResponseMs ?? 80, 80, 0.5) ||
        isDifferent(deck.delaySpectralMix ?? 0, 0) ||
        isDifferent(deck.delaySpectralSpread ?? 0.35, 0.35) ||
        deck.delayPingPong ||
        Boolean(deck.delaySliceSync),
      rearranger:
        Math.round(deck.rearrangerSlices) > 0 ||
        Math.round(deck.rearrangerSwapCount) !== 0 ||
        isDifferent(deck.rearrangerChaos, 0) ||
        isDifferent(deck.rearrangerReverse, 0) ||
        isDifferent(deck.rearrangerSensitivity, 0.6) ||
        isDifferent(deck.rearrangerQuietThreshold, 0.3) ||
        isDifferent(deck.rearrangerSliceFadeMs, 0, 1) ||
        isDifferent(deck.rearrangerSliceDelaySec, 0) ||
        isDifferent(deck.rearrangerPingPong, 0) ||
        deck.rearrangerAuto ||
        (deck.rearrangerRegions?.length ?? 0) > 0,
      stretch:
        isDifferent(deck.stretchRatio, 2) ||
        Math.round(deck.stretchWindowSize) !== 16384 ||
        isDifferent(deck.stretchStereoWidth, 1) ||
        isDifferent(deck.stretchPhaseRandomness, 0.5) ||
        isDifferent(deck.stretchTiltDb, 0) ||
        isDifferent(deck.stretchScatter, 1),
    };
    return (Object.keys(deck.fxPanelOpen) as Array<keyof DeckState["fxPanelOpen"]>).filter(
      (panel) => Boolean(adjusted[panel])
    );
  }, []);

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

  const toggleDeckFxVisibility = useCallback((deck: DeckState) => {
    const panelKeys = Object.keys(deck.fxPanelOpen) as Array<keyof DeckState["fxPanelOpen"]>;
    const anyOpen = panelKeys.some((panel) => deck.fxPanelOpen[panel]);
    if (anyOpen) {
      fxVisibilityMemoryRef.current.set(deck.id, { ...deck.fxPanelOpen });
      panelKeys.forEach((panel) => {
        if (deck.fxPanelOpen[panel]) {
          setDeckFxPanelOpen(deck.id, panel, false);
        }
      });
      return;
    }
    const previous = fxVisibilityMemoryRef.current.get(deck.id);
    if (previous) {
      panelKeys.forEach((panel) => {
        setDeckFxPanelOpen(deck.id, panel, Boolean(previous[panel]));
      });
      fxVisibilityMemoryRef.current.delete(deck.id);
      return;
    }
    const adjustedPanels = getAdjustedFxPanels(deck);
    adjustedPanels.forEach((panel) => {
      setDeckFxPanelOpen(deck.id, panel, true);
    });
  }, [getAdjustedFxPanels, setDeckFxPanelOpen]);

  const handleFocusedDeckFxVisibilityToggle = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck) return;
    toggleDeckFxVisibility(deck);
  }, [getActiveDeck, toggleDeckFxVisibility]);

  const handleAllDecksFxVisibilityToggle = useCallback(() => {
    const anyOpenAcrossDecks = decks.some((deck) =>
      (Object.keys(deck.fxPanelOpen) as Array<keyof DeckState["fxPanelOpen"]>).some(
        (panel) => deck.fxPanelOpen[panel]
      )
    );
    if (anyOpenAcrossDecks) {
      decks.forEach((deck) => {
        (Object.keys(deck.fxPanelOpen) as Array<keyof DeckState["fxPanelOpen"]>).forEach(
          (panel) => {
            if (deck.fxPanelOpen[panel]) {
              setDeckFxPanelOpen(deck.id, panel, false);
            }
          }
        );
      });
      return;
    }
    decks.forEach((deck) => {
      const adjustedPanels = getAdjustedFxPanels(deck);
      adjustedPanels.forEach((panel) => {
        setDeckFxPanelOpen(deck.id, panel, true);
      });
    });
  }, [decks, getAdjustedFxPanels, setDeckFxPanelOpen]);

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

  const handleFocusedDeckWidthToggle = useCallback(() => {
    const deck = getActiveDeck();
    if (!deck) return;
    const next =
      deck.deckWidthOverride === "full"
        ? "half"
        : deck.deckWidthOverride === "half"
          ? "full"
          : "full";
    setDeckWidthOverride(deck.id, next);
  }, [getActiveDeck, setDeckWidthOverride]);

  return {
    handleGlobalPlaybackToggle,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckFxVisibilityToggle,
    handleAllDecksFxVisibilityToggle,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckRemove,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    handleFocusedDeckZoom,
    handleFocusedDeckWidthToggle,
  };
};

export default useFocusedDeckActions;
