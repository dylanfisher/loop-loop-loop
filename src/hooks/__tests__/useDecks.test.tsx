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
    _eqMode?: "eq3" | "parametric",
    _eqLowGain?: number,
    _eqMidGain?: number,
    _eqHighGain?: number,
    _parametricEqBands?: unknown[],
    _delayTime?: number,
    _delayFeedback?: number,
    _delayMix?: number,
    _delayTone?: number,
    _delayPingPong?: boolean,
    _delaySaturation?: number,
    _delayDamping?: number,
    _delaySafety?: number,
    _delayRhythmMorph?: number,
    _delayRhythmRateHz?: number,
    _delayRhythmSwing?: number,
    _delayDuckDepth?: number,
    _delayDuckThreshold?: number,
    _delayDuckResponseMs?: number,
    _delaySpectralMix?: number,
    _delaySpectralSpread?: number,
    _vocoderMix?: number,
    _vocoderCarrierDeckId?: number | null,
    _vocoderModulatorMonitor?: number,
    _vocoderModDrive?: number,
    _vocoderBandCount?: number,
    _vocoderBandSpread?: number,
    _vocoderAttackMs?: number,
    _vocoderReleaseMs?: number,
    _vocoderNoiseMix?: number,
    _vocoderGateThreshold?: number,
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
const setDeckEqMode = vi.fn();
const setDeckParametricEqBands = vi.fn();
const setDeckBalance = vi.fn();
const setDeckRearrangerPan = vi.fn();
const setDeckRearrangerPingPongAmount = vi.fn();
const setDeckRearrangerPingPongConfig = vi.fn();
const clearDeckRearrangerPanAutomation = vi.fn();
const scheduleDeckRearrangerPan = vi.fn();
const setDeckDelayTime = vi.fn();
const setDeckDelayFeedback = vi.fn();
const setDeckDelayMix = vi.fn();
const setDeckDelayTone = vi.fn();
const setDeckDelayPingPong = vi.fn();
const setDeckDelaySaturation = vi.fn();
const setDeckDelayDamping = vi.fn();
const setDeckDelaySafety = vi.fn();
const setDeckDelayRhythmMorph = vi.fn();
const setDeckDelayRhythmRateHz = vi.fn();
const setDeckDelayRhythmSwing = vi.fn();
const setDeckDelayDuckDepth = vi.fn();
const setDeckDelayDuckThreshold = vi.fn();
const setDeckDelayDuckResponseMs = vi.fn();
const setDeckDelaySpectralMix = vi.fn();
const setDeckDelaySpectralSpread = vi.fn();
const setDeckFractalMix = vi.fn();
const setDeckFractalStructure = vi.fn();
const setDeckFractalDepth = vi.fn();
const setDeckFractalDrift = vi.fn();
const setDeckFractalDecay = vi.fn();
const setDeckFractalTone = vi.fn();
const setDeckPitchShift = vi.fn();
const setDeckVocoderMix = vi.fn();
const setDeckVocoderCarrierDeckId = vi.fn();
const setDeckVocoderModulatorMonitor = vi.fn();
const setDeckVocoderModDrive = vi.fn();
const setDeckVocoderBandCount = vi.fn();
const setDeckVocoderBandSpread = vi.fn();
const setDeckVocoderAttackMs = vi.fn();
const setDeckVocoderReleaseMs = vi.fn();
const setDeckVocoderNoiseMix = vi.fn();
const setDeckVocoderGateThreshold = vi.fn();
const setDeckRecordExportSend = vi.fn();
const removeDeck = vi.fn();
const getDeckPosition = vi.fn(() => null);
const getDeckPlaybackSnapshot = vi.fn(() => null);
const setDeckLoopParams = vi.fn();
const setDeckPlaybackRate = vi.fn();
const setDeckPlaybackOffset = vi.fn();
const getCurrentTime = vi.fn(() => null);

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
    setDeckEqMode,
    setDeckParametricEqBands,
    setDeckBalance,
    setDeckRearrangerPan,
    setDeckRearrangerPingPongAmount,
    setDeckRearrangerPingPongConfig,
    clearDeckRearrangerPanAutomation,
    scheduleDeckRearrangerPan,
    setDeckDelayTime,
    setDeckDelayFeedback,
    setDeckDelayMix,
    setDeckDelayTone,
    setDeckDelayPingPong,
    setDeckDelaySaturation,
    setDeckDelayDamping,
    setDeckDelaySafety,
    setDeckDelayRhythmMorph,
    setDeckDelayRhythmRateHz,
    setDeckDelayRhythmSwing,
    setDeckDelayDuckDepth,
    setDeckDelayDuckThreshold,
    setDeckDelayDuckResponseMs,
    setDeckDelaySpectralMix,
    setDeckDelaySpectralSpread,
    setDeckFractalMix,
    setDeckFractalStructure,
    setDeckFractalDepth,
    setDeckFractalDrift,
    setDeckFractalDecay,
    setDeckFractalTone,
    setDeckPitchShift,
    setDeckVocoderMix,
    setDeckVocoderCarrierDeckId,
    setDeckVocoderModulatorMonitor,
    setDeckVocoderModDrive,
    setDeckVocoderBandCount,
    setDeckVocoderBandSpread,
    setDeckVocoderAttackMs,
    setDeckVocoderReleaseMs,
    setDeckVocoderNoiseMix,
    setDeckVocoderGateThreshold,
    setDeckRecordExportSend,
    removeDeck,
    getDeckPosition,
    getDeckPlaybackSnapshot,
    setDeckLoopParams,
    setDeckPlaybackRate,
    setDeckPlaybackOffset,
    getCurrentTime,
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
    setDeckEqMode.mockClear();
    setDeckParametricEqBands.mockClear();
    setDeckBalance.mockClear();
    setDeckRearrangerPan.mockClear();
    setDeckRearrangerPingPongAmount.mockClear();
    setDeckRearrangerPingPongConfig.mockClear();
    clearDeckRearrangerPanAutomation.mockClear();
    scheduleDeckRearrangerPan.mockClear();
    setDeckDelayTime.mockClear();
    setDeckDelayFeedback.mockClear();
    setDeckDelayMix.mockClear();
    setDeckDelayTone.mockClear();
    setDeckDelayPingPong.mockClear();
    setDeckDelaySaturation.mockClear();
    setDeckDelayDamping.mockClear();
    setDeckDelaySafety.mockClear();
    setDeckDelayRhythmMorph.mockClear();
    setDeckDelayRhythmRateHz.mockClear();
    setDeckDelayRhythmSwing.mockClear();
    setDeckDelayDuckDepth.mockClear();
    setDeckDelayDuckThreshold.mockClear();
    setDeckDelayDuckResponseMs.mockClear();
    setDeckDelaySpectralMix.mockClear();
    setDeckDelaySpectralSpread.mockClear();
    setDeckFractalMix.mockClear();
    setDeckFractalStructure.mockClear();
    setDeckFractalDepth.mockClear();
    setDeckFractalDrift.mockClear();
    setDeckFractalDecay.mockClear();
    setDeckFractalTone.mockClear();
    setDeckPitchShift.mockClear();
    setDeckVocoderMix.mockClear();
    setDeckVocoderCarrierDeckId.mockClear();
    setDeckVocoderModulatorMonitor.mockClear();
    setDeckVocoderModDrive.mockClear();
    setDeckVocoderBandCount.mockClear();
    setDeckVocoderBandSpread.mockClear();
    setDeckVocoderAttackMs.mockClear();
    setDeckVocoderReleaseMs.mockClear();
    setDeckVocoderNoiseMix.mockClear();
    setDeckVocoderGateThreshold.mockClear();
    setDeckRecordExportSend.mockClear();
    removeDeck.mockClear();
    getDeckPosition.mockClear();
    getDeckPlaybackSnapshot.mockClear();
    setDeckLoopParams.mockClear();
    setDeckPlaybackRate.mockClear();
    setDeckPlaybackOffset.mockClear();
    getCurrentTime.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recreates a fresh deck when removing the last deck", () => {
    const { result } = renderHook(() => useDecks());
    expect(result.current.decks).toHaveLength(1);
    expect(result.current.decks[0].tempoOffset).toBe(0);
    const firstDeckId = result.current.decks[0].id;

    act(() => result.current.removeDeck(firstDeckId));
    expect(result.current.decks).toHaveLength(1);
    expect(result.current.decks[0].id).toBe(firstDeckId);
    expect(result.current.decks[0].status).toBe("idle");
    expect(result.current.decks[0].fileName).toBeUndefined();
    expect(removeDeck).toHaveBeenCalledWith(firstDeckId);
    expect(stop).toHaveBeenCalledWith(firstDeckId);
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

  it("reorders decks by source and target ids", () => {
    const { result } = renderHook(() => useDecks());

    act(() => result.current.addDeck());
    act(() => result.current.addDeck());
    const initialOrder = result.current.decks.map((deck) => deck.id);
    expect(initialOrder).toHaveLength(3);

    const sourceId = initialOrder[0];
    const targetId = initialOrder[2];
    act(() => result.current.reorderDecks(sourceId, targetId, "after"));

    const reordered = result.current.decks.map((deck) => deck.id);
    expect(reordered).toEqual([initialOrder[1], initialOrder[2], initialOrder[0]]);
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
        parametricEqMotion: {
          preset: "sweep",
          cycleSec: 3,
          automationActive: true,
          targetBandId: "peq-node-1",
        },
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
        delayMix: 0,
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
    expect(result.current.decks[0].parametricEqMotion).toEqual({
      preset: "sweep",
      cycleSec: 3,
      automationActive: true,
      targetBandId: "peq-node-1",
    });

    const automation = result.current.automationState.get(7);
    expect(automation?.djFilter.active).toBe(true);
    expect(automation?.djFilter.samples.length).toBe(2);
    expect(automation?.djFilter.currentValue).toBe(0.5);
  });
});
