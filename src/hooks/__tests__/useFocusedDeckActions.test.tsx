import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useFocusedDeckActions from "../useFocusedDeckActions";
import { buildInitialDecks, withDefaultFxPanelOpen } from "../useDecksShared";
import type { DeckState } from "../../types/deck";

const createArgs = (decks: DeckState[], setDeckFxPanelOpen: ReturnType<typeof vi.fn>) => ({
  decks,
  activeDeckId: decks[0]?.id ?? null,
  pauseDeck: vi.fn(),
  playDeck: vi.fn(async () => {}),
  setDeckFxPanelOpen,
  setDeckLoop: vi.fn(),
  setDeckLoopBounds: vi.fn(),
  commitDeckLoopBoundsHistory: vi.fn(),
  removeDeck: vi.fn(),
  handleCropLoop: vi.fn(async () => {}),
  handleDuplicateLoop: vi.fn(async () => {}),
  setDeckZoom: vi.fn(),
  zoomSteps: [1, 2, 4, 8, 16] as const,
});

describe("useFocusedDeckActions", () => {
  it("opens adjusted FX panels when q restore has no previous memory", () => {
    const base = buildInitialDecks()[0];
    const deck: DeckState = {
      ...base,
      delayMix: 0.35,
      stretchRatio: 3,
      fxPanelOpen: withDefaultFxPanelOpen(),
    };
    const setDeckFxPanelOpen = vi.fn();
    const { result } = renderHook(() => useFocusedDeckActions(createArgs([deck], setDeckFxPanelOpen)));

    act(() => {
      result.current.handleFocusedDeckFxVisibilityToggle();
    });

    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(deck.id, "delay", true);
    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(deck.id, "stretch", true);
  });

  it("restores previously open panel set after collapse", () => {
    const base = buildInitialDecks()[0];
    const deckOpen: DeckState = {
      ...base,
      fxPanelOpen: withDefaultFxPanelOpen({
        gain: true,
        delay: true,
      }),
    };
    const setDeckFxPanelOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ decks }) => useFocusedDeckActions(createArgs(decks, setDeckFxPanelOpen)),
      { initialProps: { decks: [deckOpen] } }
    );

    act(() => {
      result.current.handleFocusedDeckFxVisibilityToggle();
    });
    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(deckOpen.id, "gain", false);
    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(deckOpen.id, "delay", false);

    setDeckFxPanelOpen.mockClear();
    const deckClosed: DeckState = {
      ...deckOpen,
      fxPanelOpen: withDefaultFxPanelOpen(),
    };
    rerender({ decks: [deckClosed] });

    act(() => {
      result.current.handleFocusedDeckFxVisibilityToggle();
    });
    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(deckOpen.id, "gain", true);
    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(deckOpen.id, "delay", true);
  });

  it("shift+q closes all open FX across decks, then opens adjusted FX when none are open", () => {
    const base = buildInitialDecks()[0];
    const deckOne: DeckState = {
      ...base,
      id: 1,
      fxPanelOpen: withDefaultFxPanelOpen({ gain: true }),
    };
    const deckTwo: DeckState = {
      ...base,
      id: 2,
      fxPanelOpen: withDefaultFxPanelOpen(),
      delayMix: 0.3,
    };
    const setDeckFxPanelOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ decks }) => useFocusedDeckActions(createArgs(decks, setDeckFxPanelOpen)),
      { initialProps: { decks: [deckOne, deckTwo] } }
    );

    act(() => {
      result.current.handleAllDecksFxVisibilityToggle();
    });

    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(1, "gain", false);
    expect(setDeckFxPanelOpen).not.toHaveBeenCalledWith(2, "delay", true);

    setDeckFxPanelOpen.mockClear();
    const deckOneClosed: DeckState = {
      ...deckOne,
      fxPanelOpen: withDefaultFxPanelOpen(),
    };
    const deckTwoClosed: DeckState = {
      ...deckTwo,
      fxPanelOpen: withDefaultFxPanelOpen(),
    };
    rerender({ decks: [deckOneClosed, deckTwoClosed] });

    act(() => {
      result.current.handleAllDecksFxVisibilityToggle();
    });
    expect(setDeckFxPanelOpen).toHaveBeenCalledWith(2, "delay", true);
  });
});
