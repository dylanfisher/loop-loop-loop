import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useDecks from "../useDecks";

const decodeFile = vi.fn(async () => ({} as AudioBuffer));
const playBuffer = vi.fn(
  async (
    _id: number,
    _buffer: AudioBuffer,
    onEnded?: () => void,
    _gain?: number,
    _offsetSeconds?: number,
    _playbackRate?: number,
    _loopEnabled?: boolean,
    _loopStartSeconds?: number,
    _loopEndSeconds?: number
  ) => {
    onEnded?.();
  }
);
const stop = vi.fn();
const setDeckGain = vi.fn();
const setDeckFilter = vi.fn();
const setDeckHighpass = vi.fn();
const setDeckResonance = vi.fn();
const setDeckEqLow = vi.fn();
const setDeckEqMid = vi.fn();
const setDeckEqHigh = vi.fn();
const removeDeck = vi.fn();
const getDeckPosition = vi.fn(() => null);
const setDeckLoopParams = vi.fn();
const setDeckPlaybackRate = vi.fn();

vi.mock("../../audio/bpm", () => ({
  estimateBpmFromBuffer: () => ({ bpm: null, confidence: 0 }),
}));

vi.mock("../useAudioEngine", () => ({
  default: () => ({
    decodeFile,
    playBuffer,
    stop,
    setDeckGain,
    setDeckFilter,
    setDeckHighpass,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    removeDeck,
    getDeckPosition,
    setDeckLoopParams,
    setDeckPlaybackRate,
  }),
}));

describe("useDecks", () => {
  beforeEach(() => {
    decodeFile.mockClear();
    playBuffer.mockClear();
    stop.mockClear();
    setDeckGain.mockClear();
    setDeckFilter.mockClear();
    setDeckHighpass.mockClear();
    setDeckResonance.mockClear();
    setDeckEqLow.mockClear();
    setDeckEqMid.mockClear();
    setDeckEqHigh.mockClear();
    removeDeck.mockClear();
    getDeckPosition.mockClear();
    setDeckLoopParams.mockClear();
    setDeckPlaybackRate.mockClear();
  });

  it("starts with one deck and keeps at least one", () => {
    const { result } = renderHook(() => useDecks());
    expect(result.current.decks).toHaveLength(1);
    expect(result.current.decks[0].bpm).toBeNull();
    expect(result.current.decks[0].bpmOverride).toBeNull();

    act(() => result.current.removeDeck(result.current.decks[0].id));
    expect(result.current.decks).toHaveLength(1);
    expect(removeDeck).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("adds and removes decks by id", () => {
    const { result } = renderHook(() => useDecks());

    act(() => result.current.addDeck());
    expect(result.current.decks).toHaveLength(2);

    const idToRemove = result.current.decks[1].id;
    act(() => result.current.removeDeck(idToRemove));
    expect(result.current.decks).toHaveLength(1);
    expect(removeDeck).toHaveBeenCalledWith(idToRemove);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("loads a file and stores buffer + filename", async () => {
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;
    const file = new File(["data"], "test.mp3", { type: "audio/mpeg" });

    await act(async () => {
      await result.current.handleFileSelected(deckId, file);
    });

    expect(decodeFile).toHaveBeenCalledTimes(1);
    expect(result.current.decks[0].fileName).toBe("test.mp3");
    expect(result.current.decks[0].status).toBe("ready");
  });

  it("plays and pauses a deck", async () => {
    const { result } = renderHook(() => useDecks());
    const deck = {
      ...result.current.decks[0],
      status: "ready" as const,
      buffer: {} as AudioBuffer,
    };

    playBuffer.mockImplementationOnce(async () => {});
    await act(async () => {
      await result.current.playDeck(deck);
    });

    expect(playBuffer).toHaveBeenCalledTimes(1);
    expect(result.current.decks[0].status).toBe("playing");

    stop.mockClear();
    const playingDeck = result.current.decks[0];
    act(() => result.current.pauseDeck(playingDeck));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.decks[0].status).toBe("paused");
  });

  it("updates gain per deck", () => {
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;

    act(() => result.current.setDeckGain(deckId, 1.1));
    expect(setDeckGain).toHaveBeenCalledWith(deckId, 1.1);
    expect(result.current.decks[0].gain).toBe(1.1);
  });

  it("supports bpm override and tap tempo", () => {
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;

    act(() => result.current.setDeckBpmOverride(deckId, 150));
    expect(result.current.decks[0].bpmOverride).toBe(150);

    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(500);
    act(() => result.current.tapTempo(deckId));
    act(() => result.current.tapTempo(deckId));
    nowSpy.mockRestore();

    expect(result.current.decks[0].bpmOverride).toBeCloseTo(120, 1);
  });
});
