import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useClipLibrary from "../useClipLibrary";
import { buildInitialDecks } from "../useDecksShared";
import type { ClipItem } from "../../types/clip";
import type { DeckState } from "../../types/deck";

const createClip = (): ClipItem => ({
  id: 1,
  name: "Clip 1",
  blob: new Blob(["clip"], { type: "audio/webm" }),
  url: "blob:clip-1",
  durationSec: 1,
  gain: 0.9,
  balance: 0,
  pitchShift: 0,
  tempoOffset: 0,
});

const createDeckWithLoadedClip = (): DeckState => ({
  ...buildInitialDecks()[0],
  fileName: "Existing Clip.wav",
  buffer: {
    duration: 1,
    sampleRate: 44100,
    length: 44100,
    numberOfChannels: 2,
    getChannelData: vi.fn(() => new Float32Array(44100)),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer,
});

describe("useClipLibrary clip loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels loading when user declines replacing a loaded deck clip", async () => {
    const handleFileSelected = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const deck = createDeckWithLoadedClip();
    const clip = createClip();
    const { result } = renderHook(() =>
      useClipLibrary({
        decks: [deck],
        automationState: new Map(),
        addDeck: vi.fn(() => 2),
        handleFileSelected,
        loadDeckBuffer: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setActiveDeckId: vi.fn(),
        setScrollToDeckId: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleLoadClipToDeck(deck.id, clip);
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      'Replace deck "Existing Clip.wav" with "Clip 1"?'
    );
    expect(handleFileSelected).not.toHaveBeenCalled();
  });

  it("loads clip when user confirms replacing a loaded deck clip", async () => {
    const handleFileSelected = vi.fn(async () => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const deck = createDeckWithLoadedClip();
    const clip = createClip();
    const { result } = renderHook(() =>
      useClipLibrary({
        decks: [deck],
        automationState: new Map(),
        addDeck: vi.fn(() => 2),
        handleFileSelected,
        loadDeckBuffer: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setActiveDeckId: vi.fn(),
        setScrollToDeckId: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleLoadClipToDeck(deck.id, clip);
    });

    expect(handleFileSelected).toHaveBeenCalledTimes(1);
    expect(handleFileSelected).toHaveBeenCalledWith(
      deck.id,
      expect.any(File),
      expect.objectContaining({
        gain: clip.gain,
        balance: clip.balance,
        pitchShift: clip.pitchShift,
        tempoOffset: clip.tempoOffset,
      })
    );
  });
});
