import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useDecks from "../useDecks";
import type { DeckSession } from "../../types/session";

const createBuffer = (duration = 10, sampleRate = 44100) => {
  const length = Math.max(1, Math.floor(duration * sampleRate));
  return {
    duration,
    length,
    sampleRate,
  } as AudioBuffer;
};

const decodeFile = vi.fn(async () => createBuffer());
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
    _loopEndSeconds?: number,
    _filterCutoff?: number,
    _highpassCutoff?: number,
    _resonance?: number,
    _eqLowGain?: number,
    _eqMidGain?: number,
    _eqHighGain?: number,
    _delayTime?: number,
    _delayFeedback?: number,
    _delayMix?: number,
    _delayTone?: number,
    _delayPingPong?: boolean,
    _balance?: number,
    _pitchShift?: number
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
const setDeckBalance = vi.fn();
const setDeckDelayTime = vi.fn();
const setDeckDelayFeedback = vi.fn();
const setDeckDelayMix = vi.fn();
const setDeckDelayTone = vi.fn();
const setDeckDelayPingPong = vi.fn();
const setDeckPitchShift = vi.fn();
const removeDeck = vi.fn();
const getDeckPosition = vi.fn(() => null);
const setDeckLoopParams = vi.fn();
const setDeckPlaybackRate = vi.fn();

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
    setDeckBalance,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckPitchShift,
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
    setDeckBalance.mockClear();
    setDeckDelayTime.mockClear();
    setDeckDelayFeedback.mockClear();
    setDeckDelayMix.mockClear();
    setDeckDelayTone.mockClear();
    setDeckDelayPingPong.mockClear();
    setDeckPitchShift.mockClear();
    removeDeck.mockClear();
    getDeckPosition.mockClear();
    setDeckLoopParams.mockClear();
    setDeckPlaybackRate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with one deck and keeps at least one", () => {
    const { result } = renderHook(() => useDecks());
    expect(result.current.decks).toHaveLength(1);
    expect(result.current.decks[0].tempoOffset).toBe(0);

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
      buffer: createBuffer(),
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

  it("supports tempo offsets", () => {
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;

    act(() => result.current.setDeckTempoOffset(deckId, 12.5));
    expect(result.current.decks[0].tempoOffset).toBe(12.5);
  });

  it("seeks while playing by restarting playback at the new offset", async () => {
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;
    const buffer = createBuffer(10);

    await act(async () => {
      await result.current.handleFileSelected(deckId, new File(["data"], "song.wav"));
    });

    playBuffer.mockImplementationOnce(async () => {});
    await act(async () => {
      await result.current.playDeck(result.current.decks[0]);
    });

    playBuffer.mockClear();
    act(() => result.current.seekDeck(deckId, 0.5));

    expect(playBuffer).toHaveBeenCalledTimes(1);
    expect(playBuffer.mock.calls[0][4]).toBeCloseTo(buffer.duration * 0.5, 2);
  });

  it("updates loop bounds in-place when the playhead is inside the loop", async () => {
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;

    await act(async () => {
      await result.current.handleFileSelected(deckId, new File(["data"], "song.wav"));
    });

    playBuffer.mockImplementationOnce(async () => {});
    await act(async () => {
      await result.current.playDeck(result.current.decks[0]);
    });

    getDeckPosition.mockReturnValue(2);
    playBuffer.mockClear();
    setDeckLoopParams.mockClear();

    act(() => result.current.setDeckLoopBounds(deckId, 1, 3));

    expect(setDeckLoopParams).toHaveBeenCalledWith(deckId, true, 1, 3);
    expect(playBuffer).not.toHaveBeenCalled();
  });

  it("wraps playback snapshots when looping", async () => {
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;

    await act(async () => {
      await result.current.handleFileSelected(deckId, new File(["data"], "song.wav"));
    });

    act(() => result.current.setDeckLoopBounds(deckId, 1, 3));
    act(() => result.current.seekDeck(deckId, 0.1));

    playBuffer.mockImplementationOnce(async () => {});
    await act(async () => {
      await result.current.playDeck(result.current.decks[0]);
    });

    nowSpy.mockReturnValue(3000);
    const snapshot = result.current.getDeckPlaybackSnapshot(deckId);
    expect(snapshot?.position).toBeCloseTo(2, 2);
  });

  it("records automation samples and enforces minimum duration", () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const advanceTime = (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(ms);
    };
    const { result } = renderHook(() => useDecks());
    const deckId = result.current.decks[0].id;

    act(() => result.current.startAutomationRecording(deckId, "djFilter"));
    act(() => advanceTime(100));

    const preview = result.current.automationState.get(deckId)?.djFilter.previewSamples;
    expect(preview?.length).toBeGreaterThan(0);

    act(() => result.current.stopAutomationRecording(deckId, "djFilter"));
    const stopped = result.current.automationState.get(deckId)?.djFilter;
    expect(stopped?.samples.length).toBe(0);
    expect(stopped?.durationSec).toBe(0);

    now = 0;
    act(() => result.current.startAutomationRecording(deckId, "djFilter"));
    act(() => advanceTime(1000));
    act(() => result.current.stopAutomationRecording(deckId, "djFilter"));

    const finished = result.current.automationState.get(deckId)?.djFilter;
    expect(finished?.samples.length).toBeGreaterThan(0);
    expect(finished?.durationSec).toBeGreaterThanOrEqual(0.9);
    vi.useRealTimers();
    nowSpy.mockRestore();
  });

  it("hydrates decks and automation from session data", () => {
    const { result } = renderHook(() => useDecks());
    const sessionDecks: DeckSession[] = [
      {
        id: 7,
        fileName: "track.wav",
        gain: 0.8,
        djFilter: 0.2,
        filterResonance: 0,
        eqLowGain: -2,
        eqMidGain: 1,
        eqHighGain: 3,
        balance: -0.25,
        pitchShift: -3,
        offsetSeconds: 1,
        zoom: 2,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: 5,
        tempoOffset: 5,
        tempoPitchSync: false,
        stretchRatio: 2,
        stretchWindowSize: 16384,
        stretchStereoWidth: 1,
        stretchPhaseRandomness: 1,
        stretchTiltDb: 0,
        stretchScatter: 1,
        delayTime: 0.35,
        delayFeedback: 0.35,
        delayMix: 0.25,
        delayTone: 6000,
        delayPingPong: false,
        automation: {
          djFilter: {
            samples: [0, 0.5],
            sampleRate: 30,
            durationSec: 0.5,
            active: true,
            currentValue: 0.5,
          },
          resonance: {
            samples: [],
            sampleRate: 30,
            durationSec: 0,
            active: false,
            currentValue: 0.7,
          },
          eqLow: {
            samples: [],
            sampleRate: 30,
            durationSec: 0,
            active: false,
            currentValue: -2,
          },
          eqMid: {
            samples: [],
            sampleRate: 30,
            durationSec: 0,
            active: false,
            currentValue: 1,
          },
          eqHigh: {
            samples: [],
            sampleRate: 30,
            durationSec: 0,
            active: false,
            currentValue: 3,
          },
          balance: {
            samples: [],
            sampleRate: 30,
            durationSec: 0,
            active: false,
            currentValue: -0.25,
          },
          pitch: {
            samples: [],
            sampleRate: 30,
            durationSec: 0,
            active: false,
            currentValue: -3,
          },
        },
      },
    ];
    const buffer = createBuffer(8);

    act(() => result.current.loadSessionDecks(sessionDecks, new Map([[7, buffer]])));

    expect(result.current.decks).toHaveLength(1);
    expect(result.current.decks[0].id).toBe(7);
    expect(result.current.decks[0].status).toBe("paused");
    expect(result.current.decks[0].buffer).toBe(buffer);

    const automation = result.current.automationState.get(7);
    expect(automation?.djFilter.active).toBe(true);
    expect(automation?.djFilter.samples.length).toBe(2);
    expect(automation?.djFilter.currentValue).toBe(0.5);
  });
});
