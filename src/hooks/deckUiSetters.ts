import type { DeckFxPanel, DeckState, DeckWidthOverride } from "../types/deck";
import { MAX_REARRANGER_SLICES } from "../utils/rearranger";
import {
  DEFAULT_REARRANGER_CHAOS,
  DEFAULT_REARRANGER_PINGPONG,
  DEFAULT_REARRANGER_QUIET_THRESHOLD,
  DEFAULT_REARRANGER_REVERSE,
  DEFAULT_REARRANGER_SENSITIVITY,
  DEFAULT_REARRANGER_SLICE_DELAY_SEC,
  DEFAULT_REARRANGER_SLICE_FADE_MS,
  DEFAULT_REARRANGER_SLICES,
  DEFAULT_REARRANGER_SWAP_COUNT,
  DEFAULT_STRETCH_PHASE_RANDOMNESS,
  DEFAULT_STRETCH_RATIO,
  DEFAULT_STRETCH_SCATTER,
  DEFAULT_STRETCH_STEREO_WIDTH,
  DEFAULT_STRETCH_TILT_DB,
  DEFAULT_STRETCH_WINDOW_SIZE,
  STRETCH_WINDOW_SIZES,
  appendRearrangerBoundary,
  sanitizeRearrangerRegions,
  withDefaultFxPanelOpen,
} from "./useDecksShared";

type Args = {
  updateDeck: (id: number, patch: Partial<DeckState>, recordHistory?: boolean) => void;
  setDecksNoHistory: (updater: (prev: DeckState[]) => DeckState[]) => void;
  setDeckRecordExportSend: (id: number, active: boolean) => void;
};

export const createDeckUiSetters = ({ updateDeck, setDecksNoHistory, setDeckRecordExportSend }: Args) => {
  const setDeckStretchRatio = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_RATIO;
    const clamped = Math.min(Math.max(safeValue, 1), 16);
    updateDeck(id, { stretchRatio: clamped }, false);
  };

  const setDeckStretchWindowSize = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? Math.floor(value) : DEFAULT_STRETCH_WINDOW_SIZE;
    const nextValue = STRETCH_WINDOW_SIZES.includes(safeValue)
      ? safeValue
      : STRETCH_WINDOW_SIZES.reduce((closest, current) =>
          Math.abs(current - safeValue) < Math.abs(closest - safeValue) ? current : closest
        );
    updateDeck(id, { stretchWindowSize: nextValue }, false);
  };

  const setDeckStretchStereoWidth = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_STEREO_WIDTH;
    const clamped = Math.min(Math.max(safeValue, 0), 2);
    updateDeck(id, { stretchStereoWidth: clamped }, false);
  };

  const setDeckStretchPhaseRandomness = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_PHASE_RANDOMNESS;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { stretchPhaseRandomness: clamped }, false);
  };

  const setDeckStretchTiltDb = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_TILT_DB;
    const clamped = Math.min(Math.max(safeValue, -18), 18);
    updateDeck(id, { stretchTiltDb: clamped }, false);
  };

  const setDeckStretchScatter = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_STRETCH_SCATTER;
    const clamped = Math.min(Math.max(safeValue, 1), 16);
    updateDeck(id, { stretchScatter: clamped }, false);
  };

  const setDeckWidthOverride = (id: number, value?: DeckWidthOverride) => {
    updateDeck(id, { deckWidthOverride: value }, false);
  };

  const setDeckIncludeInRecordExport = (
    id: number,
    active: boolean,
    options?: { altKey?: boolean; shiftKey?: boolean }
  ) => {
    const altKey = options?.altKey === true;
    const shiftKey = options?.shiftKey === true;
    if (altKey && shiftKey) {
      setDecksNoHistory((prev) => {
        const hasExcludedDeck = prev.some((deck) => !deck.includeInRecordExport);
        const nextActive = hasExcludedDeck;
        prev.forEach((deck) => {
          setDeckRecordExportSend(deck.id, nextActive);
        });
        return prev.map((deck) =>
          deck.includeInRecordExport === nextActive
            ? deck
            : { ...deck, includeInRecordExport: nextActive }
        );
      });
      return;
    }
    if (altKey) {
      setDecksNoHistory((prev) => {
        const includedDecks = prev.filter((deck) => deck.includeInRecordExport);
        const isSolo =
          includedDecks.length === 1 && includedDecks[0]?.id === id;
        prev.forEach((deck) => {
          const nextActive = isSolo ? true : deck.id === id;
          setDeckRecordExportSend(deck.id, nextActive);
        });
        return prev.map((deck) => {
          const nextActive = isSolo ? true : deck.id === id;
          return deck.includeInRecordExport === nextActive
            ? deck
            : { ...deck, includeInRecordExport: nextActive };
        });
      });
      return;
    }
    setDeckRecordExportSend(id, active);
    updateDeck(id, { includeInRecordExport: active }, false);
  };

  const setDeckRearrangerSlices = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? Math.round(value) : DEFAULT_REARRANGER_SLICES;
    const clamped = Math.min(Math.max(safeValue, 0), MAX_REARRANGER_SLICES);
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const current = Math.min(
          Math.max(Math.round(deck.rearrangerSlices || DEFAULT_REARRANGER_SLICES), 0),
          MAX_REARRANGER_SLICES
        );
        if (clamped === current) return deck;
        const hasManualRegions = deck.rearrangerRegionsManual === true;
        const customRegions = hasManualRegions
          ? sanitizeRearrangerRegions(deck.rearrangerRegions)
          : undefined;
        const currentIds =
          deck.rearrangerRegionIds ??
          Array.from({ length: Math.max(0, current) }, (_, index) => index);
        if (clamped <= 1) {
          return {
            ...deck,
            rearrangerSlices: clamped,
            rearrangerRegions: undefined,
            rearrangerRegionIds: currentIds.slice(0, clamped),
            rearrangerRegionsManual: false,
          };
        }
        if (!customRegions) {
          const nextIds =
            clamped > current
              ? [
                  ...currentIds,
                  ...Array.from({ length: clamped - current }, (_, index) => current + index),
                ]
              : currentIds.slice(0, clamped);
          return {
            ...deck,
            rearrangerSlices: clamped,
            rearrangerRegions: undefined,
            rearrangerRegionIds: nextIds,
            rearrangerRegionsManual: false,
          };
        }
        let nextRegions = [...customRegions];
        const nextIds = [...currentIds];
        if (nextRegions.length === clamped + 1) {
          return {
            ...deck,
            rearrangerSlices: clamped,
            rearrangerRegions: nextRegions,
            rearrangerRegionIds: nextIds.slice(0, clamped),
            rearrangerRegionsManual: true,
          };
        }
        if (clamped > current) {
          while (nextRegions.length < clamped + 1) {
            nextRegions = appendRearrangerBoundary(nextRegions);
            const maxId = nextIds.reduce((max, nextId) => Math.max(max, nextId), -1);
            nextIds.push(maxId + 1);
          }
        } else {
          while (nextRegions.length > clamped + 1 && nextRegions.length > 3) {
            nextRegions.splice(nextRegions.length - 2, 1);
            nextIds.splice(nextIds.length - 1, 1);
          }
        }
        return {
          ...deck,
          rearrangerSlices: clamped,
          rearrangerRegions: nextRegions,
          rearrangerRegionIds: nextIds.slice(0, clamped),
          rearrangerRegionsManual: true,
        };
      })
    );
  };

  const setDeckRearrangerSwapCount = (id: number, value: number) => {
    const safeValue = Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_REARRANGER_SWAP_COUNT;
    const clamped = Math.min(Math.max(safeValue, 0), MAX_REARRANGER_SLICES);
    updateDeck(id, { rearrangerSwapCount: clamped }, false);
  };

  const setDeckRearrangerChaos = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_CHAOS;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerChaos: clamped }, false);
  };

  const setDeckRearrangerReverse = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_REVERSE;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerReverse: clamped }, false);
  };

  const setDeckRearrangerSensitivity = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_SENSITIVITY;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerSensitivity: clamped }, false);
  };

  const setDeckRearrangerQuietThreshold = (id: number, value: number) => {
    const safeValue = Number.isFinite(value)
      ? value
      : DEFAULT_REARRANGER_QUIET_THRESHOLD;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerQuietThreshold: clamped }, false);
  };

  const setDeckRearrangerSliceFadeMs = (id: number, value: number) => {
    const safeValue = Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_REARRANGER_SLICE_FADE_MS;
    const clamped = Math.min(Math.max(safeValue, 0), 12);
    updateDeck(id, { rearrangerSliceFadeMs: clamped }, false);
  };

  const setDeckRearrangerSliceDelaySec = (id: number, value: number) => {
    const safeValue = Number.isFinite(value)
      ? value
      : DEFAULT_REARRANGER_SLICE_DELAY_SEC;
    const clamped = Math.min(Math.max(safeValue, 0), 5);
    const quantized = Math.round(clamped * 100) / 100;
    updateDeck(id, { rearrangerSliceDelaySec: quantized }, false);
  };

  const setDeckRearrangerPingPong = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : DEFAULT_REARRANGER_PINGPONG;
    const clamped = Math.min(Math.max(safeValue, 0), 1);
    updateDeck(id, { rearrangerPingPong: clamped }, false);
  };

  const setDeckRearrangerAuto = (id: number, value: boolean) => {
    updateDeck(id, { rearrangerAuto: value }, false);
  };

  const setDeckRearrangerRegions = (id: number, regions?: number[]) => {
    const next = sanitizeRearrangerRegions(regions);
    const nextSlices = next ? Math.max(0, next.length - 1) : undefined;
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const slices = nextSlices ?? deck.rearrangerSlices;
        const currentIds =
          deck.rearrangerRegionIds ??
          Array.from({ length: Math.max(0, deck.rearrangerSlices) }, (_, index) => index);
        const nextIds =
          slices <= currentIds.length
            ? currentIds.slice(0, slices)
            : [
                ...currentIds,
                ...Array.from({ length: slices - currentIds.length }, (_, index) => currentIds.length + index),
              ];
        return {
          ...deck,
          rearrangerSlices: slices,
          rearrangerRegions: next,
          rearrangerRegionIds: nextIds,
          rearrangerRegionsManual: true,
        };
      })
    );
  };

  const setDeckFxPanelOpen = (id: number, panel: DeckFxPanel, open: boolean) => {
    setDecksNoHistory((prev) =>
      prev.map((deck) =>
        deck.id === id
          ? { ...deck, fxPanelOpen: { ...withDefaultFxPanelOpen(deck.fxPanelOpen), [panel]: open } }
          : deck
      )
    );
  };

  const setDeckFxPanelsOpen = (id: number, open: boolean) => {
    setDecksNoHistory((prev) =>
      prev.map((deck) =>
        deck.id === id
          ? {
              ...deck,
              fxPanelOpen: {
                gain: open,
                loopDelay: open,
                djFilter: open,
                resonance: open,
                eqLow: open,
                eqMid: open,
                eqHigh: open,
                parametricEq: open,
                balance: open,
                pitch: open,
                vocoder: open,
                delay: open,
                spectralSpace: open,
                rearranger: open,
                stretch: open,
              },
            }
          : deck
      )
    );
  };

  return {
    setDeckIncludeInRecordExport,
    setDeckStretchRatio,
    setDeckStretchWindowSize,
    setDeckStretchStereoWidth,
    setDeckStretchPhaseRandomness,
    setDeckStretchTiltDb,
    setDeckStretchScatter,
    setDeckWidthOverride,
    setDeckRearrangerSlices,
    setDeckRearrangerSwapCount,
    setDeckRearrangerChaos,
    setDeckRearrangerReverse,
    setDeckRearrangerSensitivity,
    setDeckRearrangerQuietThreshold,
    setDeckRearrangerSliceFadeMs,
    setDeckRearrangerSliceDelaySec,
    setDeckRearrangerPingPong,
    setDeckRearrangerAuto,
    setDeckRearrangerRegions,
    setDeckFxPanelOpen,
    setDeckFxPanelsOpen,
  };
};
