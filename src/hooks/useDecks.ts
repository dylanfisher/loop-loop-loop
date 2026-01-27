import { useCallback, useEffect, useRef, useState } from "react";
import useAudioEngine from "./useAudioEngine";
import type { DeckState } from "../types/deck";
import type { AutomationParam, DeckSession } from "../types/session";
const clampPlaybackRate = (value: number) => Math.min(Math.max(value, 0.01), 16);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const AUTOMATION_SAMPLE_RATE = 30;
const MIN_AUTOMATION_DURATION = 0.25;
const AUTOMATION_UI_INTERVAL_MS = 100;
const TEMPO_SNAP_STEP = 25;
const TEMPO_SNAP_THRESHOLD = 1;

type AutomationTrack = {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  recording: boolean;
  active: boolean;
  paused: boolean;
  pausedPositionSec: number;
  currentValue: number;
  lastIndex: number;
  lastPreviewLength: number;
  recordBuffer: number[];
  recordStartMs: number;
  lastSampleMs: number;
  playbackStartMs: number;
};

type AutomationDeck = {
  djFilter: AutomationTrack;
  resonance: AutomationTrack;
  eqLow: AutomationTrack;
  eqMid: AutomationTrack;
  eqHigh: AutomationTrack;
  balance: AutomationTrack;
  pitch: AutomationTrack;
};

type AutomationView = {
  samples: Float32Array;
  previewSamples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  currentValue: number;
};

const toAutomationView = (track: AutomationTrack): AutomationView => ({
  samples: track.samples,
  previewSamples: track.recording ? new Float32Array(track.recordBuffer) : new Float32Array(0),
  durationSec: track.durationSec,
  recording: track.recording,
  active: track.active,
  currentValue: track.currentValue,
});

const createTrack = (initialValue: number): AutomationTrack => ({
  samples: new Float32Array(0),
  sampleRate: AUTOMATION_SAMPLE_RATE,
  durationSec: 0,
  recording: false,
  active: false,
  paused: false,
  pausedPositionSec: 0,
  currentValue: initialValue,
  lastIndex: -1,
  lastPreviewLength: 0,
  recordBuffer: [],
  recordStartMs: 0,
  lastSampleMs: 0,
  playbackStartMs: 0,
});
const useDecks = () => {
  const nextDeckId = useRef(2);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const playbackRateRef = useRef<Map<number, number>>(new Map());
  const playbackStartRef = useRef<Map<number, number>>(new Map());
  const automationRef = useRef<Map<number, AutomationDeck>>(new Map());
  const automationPlayheadRef = useRef<Map<number, Record<AutomationParam, number>>>(new Map());
  const automationUiUpdateRef = useRef<Map<number, number>>(new Map());
  const automationTickEnabledRef = useRef(false);
  const [automationState, setAutomationState] = useState<Map<number, Record<AutomationParam, AutomationView>>>(
    new Map()
  );
  const [automationTickEnabled, setAutomationTickEnabled] = useState(false);
  const [decks, setDecks] = useState<DeckState[]>([
    {
      id: 1,
      status: "idle",
      gain: 0.9,
      djFilter: 0,
      filterResonance: 0.7,
      eqLowGain: 0,
      eqMidGain: 0,
      eqHighGain: 0,
      balance: 0,
      pitchShift: 0,
      offsetSeconds: 0,
      zoom: 1,
      loopEnabled: true,
      loopStartSeconds: 0,
      loopEndSeconds: 0,
      tempoOffset: 0,
      tempoPitchSync: false,
      stretchRatio: 2,
    },
  ]);
  const {
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
    setDeckPitchShift,
    removeDeck: removeDeckNodes,
    getDeckPosition,
    getDeckPlaybackSnapshot: _getDeckPlaybackSnapshot,
    setDeckLoopParams,
    setDeckPlaybackRate,
  } = useAudioEngine();

  const getFilterTargets = useCallback((djFilter: number) => {
    const min = 60;
    const max = 20000;
    const highpassMax = 12000;
    const normalized = clamp(djFilter, -1, 1);
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const logHighMax = Math.log10(highpassMax);
    if (normalized < 0) {
      const t = 1 + normalized;
      const lowpass = Math.pow(10, logMin + t * (logMax - logMin));
      return { lowpass, highpass: min };
    }
    if (normalized > 0) {
      const t = normalized;
      const highpass = Math.pow(10, logMin + t * (logHighMax - logMin));
      return { lowpass: max, highpass };
    }
    return { lowpass: max, highpass: min };
  }, []);

  const ensureAutomationDeck = (deckId: number, deck: DeckState) => {
    let automation = automationRef.current.get(deckId);
    if (!automation) {
      automation = {
        djFilter: createTrack(deck.djFilter),
        resonance: createTrack(deck.filterResonance),
        eqLow: createTrack(deck.eqLowGain),
        eqMid: createTrack(deck.eqMidGain),
        eqHigh: createTrack(deck.eqHighGain),
        balance: createTrack(deck.balance),
        pitch: createTrack(deck.pitchShift),
      };
      automationRef.current.set(deckId, automation);
      automationPlayheadRef.current.set(deckId, {
        djFilter: 0,
        resonance: 0,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        balance: 0,
        pitch: 0,
      });
      setAutomationState((prev) => {
        const next = new Map(prev);
        next.set(deckId, {
          djFilter: toAutomationView(automation!.djFilter),
          resonance: toAutomationView(automation!.resonance),
          eqLow: toAutomationView(automation!.eqLow),
          eqMid: toAutomationView(automation!.eqMid),
          eqHigh: toAutomationView(automation!.eqHigh),
          balance: toAutomationView(automation!.balance),
          pitch: toAutomationView(automation!.pitch),
        });
        return next;
      });
    }
    return automation;
  };

  const updateAutomationTickEnabled = useCallback(() => {
    let enabled = false;
    automationRef.current.forEach((tracks) => {
      if (enabled) return;
      (Object.values(tracks) as AutomationTrack[]).forEach((track) => {
        if (track.recording || track.active) {
          enabled = true;
        }
      });
    });
    if (automationTickEnabledRef.current !== enabled) {
      automationTickEnabledRef.current = enabled;
      setAutomationTickEnabled(enabled);
    }
  }, []);

  const updateAutomationView = useCallback((deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    setAutomationState((prev) => {
      const next = new Map(prev);
      next.set(deckId, {
        djFilter: toAutomationView(automation.djFilter),
        resonance: toAutomationView(automation.resonance),
        eqLow: toAutomationView(automation.eqLow),
        eqMid: toAutomationView(automation.eqMid),
        eqHigh: toAutomationView(automation.eqHigh),
        balance: toAutomationView(automation.balance),
        pitch: toAutomationView(automation.pitch),
      });
      return next;
    });
  }, []);

  const resetAutomation = useCallback(
    (
      deckId: number,
      djFilterValue: number,
      resonanceValue: number,
      eqLowGain: number,
      eqMidGain: number,
      eqHighGain: number,
      balance: number,
      pitchShift: number
    ) => {
      const automation: AutomationDeck = {
        djFilter: createTrack(djFilterValue),
        resonance: createTrack(resonanceValue),
        eqLow: createTrack(eqLowGain),
        eqMid: createTrack(eqMidGain),
        eqHigh: createTrack(eqHighGain),
        balance: createTrack(balance),
        pitch: createTrack(pitchShift),
      };
      automationRef.current.set(deckId, automation);
      automationPlayheadRef.current.set(deckId, {
        djFilter: 0,
        resonance: 0,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        balance: 0,
        pitch: 0,
      });
      updateAutomationView(deckId);
      updateAutomationTickEnabled();
    },
    [updateAutomationTickEnabled, updateAutomationView]
  );

  const getDeckPlaybackRate = useCallback(
    (deck: DeckState) => clampPlaybackRate(1 + deck.tempoOffset / 100),
    []
  );

  const getTempoSyncedPitch = (tempoOffset: number) => {
    const rate = clampPlaybackRate(1 + tempoOffset / 100);
    const semitones = -12 * Math.log2(rate);
    return Math.min(24, Math.max(-24, semitones));
  };

  const historyRef = useRef<{ past: DeckState[][]; future: DeckState[][] }>({
    past: [],
    future: [],
  });
  const historyDisabledRef = useRef(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const historyLimit = 100;

  const snapshotDecks = useCallback(
    (source: DeckState[]) =>
      source.map((deck) => ({
        ...deck,
        status: deck.status === "playing" ? "paused" : deck.status,
        startedAtMs: deck.status === "playing" ? undefined : deck.startedAtMs,
      })),
    []
  );

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: historyRef.current.past.length > 0,
      canRedo: historyRef.current.future.length > 0,
    });
  }, []);

  const recordHistory = useCallback(
    (prev: DeckState[]) => {
      const snapshot = snapshotDecks(prev);
      historyRef.current.past.push(snapshot);
      if (historyRef.current.past.length > historyLimit) {
        historyRef.current.past.shift();
      }
      historyRef.current.future = [];
      syncHistoryState();
    },
    [snapshotDecks, syncHistoryState]
  );

  const setDecksWithHistory = useCallback(
    (updater: (prev: DeckState[]) => DeckState[]) => {
      setDecks((prev) => {
        if (!historyDisabledRef.current) {
          recordHistory(prev);
        }
        return updater(prev);
      });
    },
    [recordHistory]
  );

  const setDecksNoHistory = useCallback((updater: (prev: DeckState[]) => DeckState[]) => {
    setDecks((prev) => updater(prev));
  }, []);

  const updateDeck = useCallback(
    (id: number, updates: Partial<DeckState>, record = true) => {
      const setter = record ? setDecksWithHistory : setDecksNoHistory;
      setter((prev) =>
        prev.map((deck) => (deck.id === id ? { ...deck, ...updates } : deck))
      );
    },
    [setDecksNoHistory, setDecksWithHistory]
  );

  const applyDeckSnapshot = useCallback(
    (snapshot: DeckState[]) => {
      historyDisabledRef.current = true;
      decks.forEach((deck) => {
        stop(deck.id);
      });
      playbackStartRef.current.clear();
      setDecksNoHistory(() => snapshotDecks(snapshot));
      snapshot.forEach((deck) => {
        setDeckGain(deck.id, deck.gain);
        setDeckFilter(deck.id, deck.djFilter);
        setDeckResonance(deck.id, deck.filterResonance);
        setDeckEqLow(deck.id, deck.eqLowGain);
        setDeckEqMid(deck.id, deck.eqMidGain);
        setDeckEqHigh(deck.id, deck.eqHighGain);
        setDeckBalance(deck.id, deck.balance);
        setDeckPitchShift(deck.id, deck.pitchShift);
        setDeckPlaybackRate(deck.id, clampPlaybackRate(1 + deck.tempoOffset / 100));
        setDeckLoopParams(
          deck.id,
          deck.loopEnabled,
          deck.loopStartSeconds,
          deck.loopEndSeconds
        );
      });
      historyDisabledRef.current = false;
    },
    [
      decks,
      setDeckBalance,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckGain,
      setDeckPitchShift,
      setDeckPlaybackRate,
      setDeckResonance,
      setDeckLoopParams,
      setDecksNoHistory,
      snapshotDecks,
      stop,
    ]
  );

  const undo = useCallback(() => {
    const past = historyRef.current.past;
    if (past.length === 0) return;
    const current = snapshotDecks(decks);
    const previous = past.pop();
    if (!previous) return;
    historyRef.current.future.push(current);
    applyDeckSnapshot(previous);
    syncHistoryState();
  }, [applyDeckSnapshot, decks, snapshotDecks, syncHistoryState]);

  const redo = useCallback(() => {
    const future = historyRef.current.future;
    if (future.length === 0) return;
    const current = snapshotDecks(decks);
    const next = future.pop();
    if (!next) return;
    historyRef.current.past.push(current);
    applyDeckSnapshot(next);
    syncHistoryState();
  }, [applyDeckSnapshot, decks, snapshotDecks, syncHistoryState]);

  const setDeckBalanceValue = useCallback(
    (id: number, value: number) => {
      const clamped = Math.min(Math.max(value, -1), 1);
      setDeckBalance(id, clamped);
      updateDeck(id, { balance: clamped });
      const automation = automationRef.current.get(id);
      const track = automation?.balance;
      if (track && track.active && !track.recording) {
        track.active = false;
        track.playbackStartMs = 0;
        updateAutomationView(id);
      }
      updateAutomationTickEnabled();
    },
    [setDeckBalance, updateDeck, updateAutomationTickEnabled, updateAutomationView]
  );

  useEffect(() => {
    if (!automationTickEnabled) return;
    const intervalMs = 1000 / AUTOMATION_SAMPLE_RATE;
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const automation = automationRef.current;
      if (automation.size === 0) return;
      automation.forEach((tracks, deckId) => {
        let hasActive = false;
        let shouldUpdateView = false;
        (Object.keys(tracks) as AutomationParam[]).forEach((param) => {
          const track = tracks[param];
          if (track.recording || (track.active && track.durationSec > 0)) {
            hasActive = true;
          }
          if (track.paused && track.active && !track.recording) {
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] =
                track.durationSec > 0 ? track.pausedPositionSec / track.durationSec : 0;
            }
            return;
          }
          if (track.recording) {
            const interval = 1000 / track.sampleRate;
            while (now - track.lastSampleMs >= interval) {
              track.recordBuffer.push(track.currentValue);
              track.lastSampleMs += interval;
              track.durationSec = track.recordBuffer.length / track.sampleRate;
            }
            if (track.recordBuffer.length !== track.lastPreviewLength) {
              shouldUpdateView = true;
            }
          }
          if (!track.recording && track.active && track.durationSec > 0) {
            const elapsedSec = (now - track.playbackStartMs) / 1000;
            const positionSec = elapsedSec % track.durationSec;
            const index = Math.min(
              track.samples.length - 1,
              Math.floor(positionSec * track.sampleRate)
            );
            const value = track.samples[index] ?? track.currentValue;
            track.currentValue = value;
            if (param === "djFilter") {
              const targets = getFilterTargets(value);
              setDeckFilter(deckId, targets.lowpass);
              setDeckHighpass(deckId, targets.highpass);
            } else if (param === "resonance") {
              setDeckResonance(deckId, value);
            } else if (param === "eqLow") {
              setDeckEqLow(deckId, value);
            } else if (param === "eqMid") {
              setDeckEqMid(deckId, value);
            } else if (param === "eqHigh") {
              setDeckEqHigh(deckId, value);
            } else if (param === "balance") {
              setDeckBalance(deckId, value);
            } else if (param === "pitch") {
              setDeckPitchShift(deckId, value);
            } else {
              setDeckResonance(deckId, value);
            }
            if (index !== track.lastIndex) {
              track.lastIndex = index;
              shouldUpdateView = true;
            }
            const playhead = positionSec / track.durationSec;
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] = playhead;
            }
          }
          if (!track.active || track.durationSec <= 0) {
            const playheads = automationPlayheadRef.current.get(deckId);
            if (playheads) {
              playheads[param] = 0;
            }
          }
        });
        if (shouldUpdateView) {
          const lastUpdate = automationUiUpdateRef.current.get(deckId) ?? 0;
          if (now - lastUpdate >= AUTOMATION_UI_INTERVAL_MS) {
            automationUiUpdateRef.current.set(deckId, now);
            (Object.values(tracks) as AutomationTrack[]).forEach((track) => {
              if (track.recording) {
                track.lastPreviewLength = track.recordBuffer.length;
              }
            });
            updateAutomationView(deckId);
          }
        }
        if (!hasActive) {
          const playheads = automationPlayheadRef.current.get(deckId);
          if (playheads) {
            (Object.keys(playheads) as AutomationParam[]).forEach((param) => {
              playheads[param] = 0;
            });
          }
        }
      });
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    automationTickEnabled,
    getFilterTargets,
    setDeckFilter,
    setDeckHighpass,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    setDeckBalance,
    setDeckPitchShift,
    updateAutomationView,
  ]);

  useEffect(() => {
    const seen = new Set<number>();
    decks.forEach((deck) => {
      seen.add(deck.id);
      const targetRate = getDeckPlaybackRate(deck);
      const prevRate = playbackRateRef.current.get(deck.id);
      if (prevRate === undefined) {
        playbackRateRef.current.set(deck.id, targetRate);
        return;
      }
      if (prevRate !== targetRate) {
        playbackRateRef.current.set(deck.id, targetRate);
        setDeckPlaybackRate(deck.id, targetRate);
      }
    });

    Array.from(playbackRateRef.current.keys()).forEach((deckId) => {
      if (!seen.has(deckId)) {
        playbackRateRef.current.delete(deckId);
      }
    });
  }, [decks, getDeckPlaybackRate, setDeckPlaybackRate]);

  const addDeck = () => {
    const id = nextDeckId.current;
    nextDeckId.current += 1;
    resetAutomation(id, 0, 0.7, 0, 0, 0, 0, 0);
    setDecksWithHistory((prev) => [
      ...prev,
      {
        id,
        status: "idle",
        gain: 0.9,
        djFilter: 0,
        filterResonance: 0.7,
        eqLowGain: 0,
        eqMidGain: 0,
        eqHighGain: 0,
        balance: 0,
        pitchShift: 0,
        offsetSeconds: 0,
        zoom: 1,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: 0,
        tempoOffset: 0,
        tempoPitchSync: false,
        stretchRatio: 2,
      },
    ]);
  };

  const removeDeck = (id: number) => {
    setDecksWithHistory((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      stop(id);
      removeDeckNodes(id);
      playbackStartRef.current.delete(id);
      automationRef.current.delete(id);
      automationPlayheadRef.current.delete(id);
      setAutomationState((state) => {
        const next = new Map(state);
        next.delete(id);
        return next;
      });
      return prev.filter((deck) => deck.id !== id);
    });
  };

  const setFileInputRef = (id: number, node: HTMLInputElement | null) => {
    fileInputRefs.current.set(id, node);
  };

  const handleLoadClick = (id: number) => {
    fileInputRefs.current.get(id)?.click();
  };

  const handleFileSelected = async (
    id: number,
    file: File | null,
    options?: { gain?: number; pitchShift?: number; balance?: number; tempoOffset?: number }
  ) => {
    if (!file) return;

    const currentDeck = decks.find((deck) => deck.id === id);
    const wasPlaying = currentDeck?.status === "playing";
    const nextGain = options?.gain ?? 0.9;
    const nextPitchShift = options?.pitchShift ?? 0;
    const nextBalance = options?.balance ?? 0;
    const nextTempoOffset = options?.tempoOffset ?? 0;
    if (wasPlaying) {
      stop(id);
      playbackStartRef.current.delete(id);
    }
    resetAutomation(id, 0, 0.7, 0, 0, 0, nextBalance, nextPitchShift);
    updateDeck(id, {
      status: "loading",
      fileName: file.name,
      gain: nextGain,
      startedAtMs: undefined,
      offsetSeconds: 0,
      djFilter: 0,
      filterResonance: 0.7,
      eqLowGain: 0,
      eqMidGain: 0,
      eqHighGain: 0,
      balance: nextBalance,
      pitchShift: nextPitchShift,
      zoom: 1,
      loopEnabled: true,
      loopStartSeconds: 0,
      loopEndSeconds: 0,
      tempoOffset: nextTempoOffset,
      tempoPitchSync: false,
      stretchRatio: 2,
    }, false);
    setDeckPitchShift(id, nextPitchShift);
    setDeckBalance(id, nextBalance);
    try {
      const buffer = await decodeFile(file);
      const duration = Number.isFinite(buffer.duration)
        ? buffer.duration
        : buffer.length / buffer.sampleRate;
      const baseDeck = {
        buffer,
        duration,
        gain: nextGain,
        offsetSeconds: 0,
        djFilter: 0,
        filterResonance: 0.7,
        eqLowGain: 0,
        eqMidGain: 0,
        eqHighGain: 0,
        balance: nextBalance,
        pitchShift: nextPitchShift,
        zoom: 1,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: duration,
        tempoOffset: nextTempoOffset,
        tempoPitchSync: false,
        stretchRatio: 2,
      };
      if (wasPlaying) {
        const startedAtMs = performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        updateDeck(id, {
          ...baseDeck,
          status: "playing",
          startedAtMs,
        }, false);
        const filters = getFilterTargets(0);
        const gain = nextGain;
        const tempoRatio = clampPlaybackRate(1 + nextTempoOffset / 100);
        void playBuffer(
          id,
          buffer,
          () => {
            console.info("Deck ended", { deckId: id, loopEnabled: true });
            playbackStartRef.current.delete(id);
            updateDeck(id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
          gain,
          0,
          tempoRatio,
          true,
          0,
          duration,
          filters.lowpass,
          filters.highpass,
          0.7,
          0,
          0,
          0,
          nextBalance,
          nextPitchShift
        );
      } else {
        updateDeck(id, {
          ...baseDeck,
          status: "ready",
        }, false);
      }
    } catch (error) {
      updateDeck(id, { status: "error" }, false);
      console.error("Failed to decode audio", error);
    }
  };

  const playDeck = async (deck: DeckState) => {
    if (!deck.buffer) return;
    stop(deck.id);
    let offsetSeconds = deck.offsetSeconds ?? 0;
    if (deck.loopEnabled && deck.loopEndSeconds > deck.loopStartSeconds) {
      const maxOffset = Math.max(deck.loopStartSeconds, deck.loopEndSeconds - 0.01);
      offsetSeconds = Math.min(Math.max(offsetSeconds, deck.loopStartSeconds), maxOffset);
    }
    // eslint-disable-next-line react-hooks/purity -- timestamp is captured during user action
    const startedAtMs = performance.now();
    playbackStartRef.current.set(deck.id, startedAtMs);
    updateDeck(deck.id, {
      status: "playing",
      startedAtMs,
      duration: deck.buffer.duration,
      offsetSeconds,
    }, false);
    const tempoRatio = getDeckPlaybackRate(deck);
    const filters = getFilterTargets(deck.djFilter);
    await playBuffer(
      deck.id,
      deck.buffer,
      () => {
        console.info("Deck ended", { deckId: deck.id, loopEnabled: deck.loopEnabled });
        playbackStartRef.current.delete(deck.id);
        updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
      },
      deck.gain,
      offsetSeconds,
      tempoRatio,
      deck.loopEnabled,
      deck.loopStartSeconds,
      deck.loopEndSeconds,
      filters.lowpass,
      filters.highpass,
      deck.filterResonance,
      deck.eqLowGain,
      deck.eqMidGain,
      deck.eqHighGain,
      deck.balance,
      deck.pitchShift
    );
    if (deck.status === "paused") {
      resumeAutomationDeck(deck.id);
    }
  };

  const pauseAutomationDeck = (deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    const now = performance.now();
    (Object.keys(automation) as AutomationParam[]).forEach((param) => {
      const track = automation[param];
      if (!track.active || track.recording || track.durationSec <= 0) {
        return;
      }
      const elapsedSec = (now - track.playbackStartMs) / 1000;
      const positionSec = elapsedSec % track.durationSec;
      track.paused = true;
      track.pausedPositionSec = positionSec;
      track.playbackStartMs = 0;
      const playheads = automationPlayheadRef.current.get(deckId);
      if (playheads) {
        playheads[param] = positionSec / track.durationSec;
      }
    });
    updateAutomationView(deckId);
  };

  const resumeAutomationDeck = (deckId: number) => {
    const automation = automationRef.current.get(deckId);
    if (!automation) return;
    const now = performance.now();
    (Object.keys(automation) as AutomationParam[]).forEach((param) => {
      const track = automation[param];
      if (!track.paused || !track.active || track.durationSec <= 0) {
        track.paused = false;
        track.pausedPositionSec = 0;
        return;
      }
      track.playbackStartMs = now - track.pausedPositionSec * 1000;
      track.paused = false;
      track.pausedPositionSec = 0;
    });
    updateAutomationView(deckId);
  };

  const pauseDeck = (deck: DeckState) => {
    if (deck.status !== "playing") return;
    const position = getDeckPosition(deck.id);
    const duration = deck.duration ?? deck.buffer?.duration ?? 0;
    const offsetSeconds =
      position !== null ? Math.min(Math.max(0, position), duration) : deck.offsetSeconds ?? 0;

    stop(deck.id);
    playbackStartRef.current.delete(deck.id);
    pauseAutomationDeck(deck.id);
    updateDeck(deck.id, {
      status: "paused",
      startedAtMs: undefined,
      offsetSeconds,
    }, false);
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
      }, false);
      const tempoRatio = getDeckPlaybackRate(deck);
      const filters = getFilterTargets(deck.djFilter);
      void playBuffer(
        deck.id,
        deck.buffer,
        () => updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false),
        deck.gain,
        offsetSeconds,
        tempoRatio,
        deck.loopEnabled,
        deck.loopStartSeconds,
        deck.loopEndSeconds,
        filters.lowpass,
        filters.highpass,
        deck.filterResonance,
        deck.eqLowGain,
        deck.eqMidGain,
        deck.eqHighGain,
        deck.balance,
        deck.pitchShift
      );
      return;
    }

    updateDeck(id, { offsetSeconds }, false);
  };

  const setDeckGainValue = (id: number, value: number) => {
    setDeckGain(id, value);
    updateDeck(id, { gain: value });
  };

  const setDeckFilterValue = (id: number, value: number) => {
    const targets = getFilterTargets(value);
    setDeckFilter(id, targets.lowpass);
    setDeckHighpass(id, targets.highpass);
    updateDeck(id, { djFilter: clamp(value, -1, 1) });
    const automation = automationRef.current.get(id);
    const track = automation?.djFilter;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckResonanceValue = (id: number, value: number) => {
    setDeckResonance(id, value);
    updateDeck(id, { filterResonance: value });
    const automation = automationRef.current.get(id);
    const track = automation?.resonance;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckEqLowValue = (id: number, value: number) => {
    setDeckEqLow(id, value);
    updateDeck(id, { eqLowGain: value });
    const automation = automationRef.current.get(id);
    const track = automation?.eqLow;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckEqMidValue = (id: number, value: number) => {
    setDeckEqMid(id, value);
    updateDeck(id, { eqMidGain: value });
    const automation = automationRef.current.get(id);
    const track = automation?.eqMid;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckEqHighValue = (id: number, value: number) => {
    setDeckEqHigh(id, value);
    updateDeck(id, { eqHighGain: value });
    const automation = automationRef.current.get(id);
    const track = automation?.eqHigh;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };

  const setDeckPitchShiftValue = (id: number, value: number) => {
    const deck = decks.find((item) => item.id === id);
    if (deck?.tempoPitchSync) return;
    const clamped = Math.min(Math.max(value, -12), 12);
    setDeckPitchShift(id, clamped);
    updateDeck(id, { pitchShift: clamped });
    const automation = automationRef.current.get(id);
    const track = automation?.pitch;
    if (track && track.active && !track.recording) {
      track.active = false;
      track.playbackStartMs = 0;
      updateAutomationView(id);
    }
    updateAutomationTickEnabled();
  };


  const startAutomationRecording = (id: number, param: AutomationParam) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck) return;
    if (param === "pitch" && deck.tempoPitchSync) return;
    const automation = ensureAutomationDeck(id, deck);
    const track = automation[param];
    track.recording = true;
    track.active = true;
    track.paused = false;
    track.pausedPositionSec = 0;
    track.recordBuffer = [];
    track.samples = new Float32Array(0);
    track.durationSec = 0;
    track.recordStartMs = performance.now();
    track.lastSampleMs = track.recordStartMs;
    track.lastPreviewLength = 0;
    if (param === "djFilter") {
      track.currentValue = deck.djFilter;
    } else if (param === "resonance") {
      track.currentValue = deck.filterResonance;
    } else if (param === "eqLow") {
      track.currentValue = deck.eqLowGain;
    } else if (param === "eqMid") {
      track.currentValue = deck.eqMidGain;
    } else if (param === "eqHigh") {
      track.currentValue = deck.eqHighGain;
    } else if (param === "balance") {
      track.currentValue = deck.balance;
    } else if (param === "pitch") {
      track.currentValue = deck.pitchShift;
    } else {
      track.currentValue = deck.pitchShift;
    }
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const stopAutomationRecording = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    if (!track.recording) return;
    track.recording = false;
    const duration = track.recordBuffer.length / track.sampleRate;
    if (duration >= MIN_AUTOMATION_DURATION) {
      track.samples = new Float32Array(track.recordBuffer);
      track.durationSec = duration;
      track.playbackStartMs = performance.now();
    } else {
      track.samples = new Float32Array(0);
      track.durationSec = 0;
    }
    track.recordBuffer = [];
    track.lastPreviewLength = 0;
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const updateAutomationValue = (id: number, param: AutomationParam, value: number) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const deck = decks.find((item) => item.id === id);
    if (param === "pitch" && deck?.tempoPitchSync) return;
    const track = automation[param];
    track.currentValue = value;
    if (param === "djFilter") {
      setDeckFilterValue(id, value);
    } else if (param === "resonance") {
      setDeckResonanceValue(id, value);
    } else if (param === "eqLow") {
      setDeckEqLowValue(id, value);
    } else if (param === "eqMid") {
      setDeckEqMidValue(id, value);
    } else if (param === "eqHigh") {
      setDeckEqHighValue(id, value);
    } else if (param === "balance") {
      setDeckBalanceValue(id, value);
    } else if (param === "pitch") {
      setDeckPitchShiftValue(id, value);
    } else {
      setDeckPitchShiftValue(id, value);
    }
    if (track.active) {
      updateAutomationView(id);
    }
  };

  const getAutomationPlayhead = (id: number, param: AutomationParam) => {
    const playheads = automationPlayheadRef.current.get(id);
    return playheads ? playheads[param] : 0;
  };

  const toggleAutomationActive = (id: number, param: AutomationParam, next: boolean) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const deck = decks.find((item) => item.id === id);
    if (param === "pitch" && deck?.tempoPitchSync) return;
    const track = automation[param];
    track.active = next;
    if (next) {
      track.playbackStartMs = performance.now();
    }
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const resetAutomationTrack = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    track.samples = new Float32Array(0);
    track.recordBuffer = [];
    track.durationSec = 0;
    track.recording = false;
    track.active = false;
    track.paused = false;
    track.pausedPositionSec = 0;
    track.playbackStartMs = 0;
    track.lastPreviewLength = 0;
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const setDeckZoomValue = (id: number, value: number) => {
    updateDeck(id, { zoom: value });
  };

  const setDeckLoopValue = (id: number, value: boolean) => {
    setDecksWithHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        const duration = deck.duration ?? deck.buffer?.duration ?? 0;
        const nextStart = deck.loopStartSeconds ?? 0;
        const nextEnd =
          deck.loopEndSeconds > nextStart + 0.01 ? deck.loopEndSeconds : duration;
        const nextDeck = {
          ...deck,
          loopEnabled: value,
          loopStartSeconds: nextStart,
          loopEndSeconds: nextEnd,
        };
        if (deck.status !== "playing" || !deck.buffer) {
          return nextDeck;
        }

        const currentPosition = getDeckPosition(deck.id);
        const offsetSeconds =
          currentPosition !== null ? currentPosition : deck.offsetSeconds ?? 0;
        const clampedOffset = value
          ? Math.min(Math.max(offsetSeconds, nextStart), Math.max(nextStart, nextEnd - 0.01))
          : offsetSeconds;
        const tempoRatio = getDeckPlaybackRate(deck);

        const filters = getFilterTargets(deck.djFilter);
        void playBuffer(
          deck.id,
          deck.buffer,
          () => {
            console.info("Deck ended", { deckId: deck.id, loopEnabled: true });
            playbackStartRef.current.delete(deck.id);
            updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
          deck.gain,
          clampedOffset,
          tempoRatio,
          value,
          nextDeck.loopStartSeconds,
          nextDeck.loopEndSeconds,
          filters.lowpass,
          filters.highpass,
          deck.filterResonance,
          deck.eqLowGain,
          deck.eqMidGain,
          deck.eqHighGain,
          deck.balance,
          deck.pitchShift
        );

        const startedAtMs = performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        return {
          ...nextDeck,
          status: "playing",
          startedAtMs,
          offsetSeconds: clampedOffset,
          duration,
        };
      })
    );
  };

  const setDeckLoopBounds = (id: number, startSeconds: number, endSeconds: number) => {
    setDecksWithHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id || !deck.buffer) return deck;
        const duration = deck.duration ?? deck.buffer.duration;
        const minGap = Math.min(0.05, Math.max(0.005, duration * 0.25));
        const nextStart = Math.min(Math.max(0, startSeconds), duration);
        const nextEnd = Math.min(Math.max(nextStart + minGap, endSeconds), duration);

        if (deck.status === "playing" && deck.loopEnabled) {
          const currentPosition = getDeckPosition(deck.id);
          if (
            currentPosition !== null &&
            currentPosition >= nextStart &&
            currentPosition <= nextEnd
          ) {
            setDeckLoopParams(deck.id, true, nextStart, nextEnd);
            return {
              ...deck,
              loopStartSeconds: nextStart,
              loopEndSeconds: nextEnd,
            };
          }

          const clampedOffset = Math.min(
            Math.max(currentPosition ?? nextStart, nextStart),
            Math.max(nextStart, nextEnd - 0.01)
          );
          const filters = getFilterTargets(deck.djFilter);
          void playBuffer(
            deck.id,
            deck.buffer,
            () => {
              console.info("Deck ended", { deckId: deck.id, loopEnabled: value });
              playbackStartRef.current.delete(deck.id);
            updateDeck(deck.id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
            deck.gain,
            clampedOffset,
            getDeckPlaybackRate(deck),
            true,
            nextStart,
            nextEnd,
            filters.lowpass,
            filters.highpass,
            deck.filterResonance,
            deck.eqLowGain,
            deck.eqMidGain,
            deck.eqHighGain,
            deck.balance,
            deck.pitchShift
          );
          const startedAtMs = performance.now();
          playbackStartRef.current.set(id, startedAtMs);
          return {
            ...deck,
            loopStartSeconds: nextStart,
            loopEndSeconds: nextEnd,
            startedAtMs,
            offsetSeconds: clampedOffset,
          };
        }

        return { ...deck, loopStartSeconds: nextStart, loopEndSeconds: nextEnd };
      })
    );
  };

  const setDeckTempoOffset = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    const snapped =
      Math.abs(safeValue) > 100
        ? safeValue
        : Math.round(safeValue / TEMPO_SNAP_STEP) * TEMPO_SNAP_STEP;
    const nextValue =
      Math.abs(safeValue - snapped) <= TEMPO_SNAP_THRESHOLD ? snapped : safeValue;
    let nextPitch = 0;
    let shouldSyncPitch = false;
    setDecksWithHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        shouldSyncPitch = deck.tempoPitchSync;
        if (shouldSyncPitch) {
          nextPitch = getTempoSyncedPitch(nextValue);
          return { ...deck, tempoOffset: nextValue, pitchShift: nextPitch };
        }
        return { ...deck, tempoOffset: nextValue };
      })
    );
    setDeckPlaybackRate(id, clampPlaybackRate(1 + nextValue / 100));
    if (shouldSyncPitch) {
      setDeckPitchShift(id, nextPitch);
    }
  };

  const setDeckTempoPitchSync = (id: number, enabled: boolean) => {
    let nextPitch = 0;
    setDecksWithHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id) return deck;
        if (enabled) {
          nextPitch = getTempoSyncedPitch(deck.tempoOffset);
          return { ...deck, tempoPitchSync: true, pitchShift: nextPitch };
        }
        return { ...deck, tempoPitchSync: false };
      })
    );
    if (enabled) {
      const automation = automationRef.current.get(id);
      if (automation) {
        const track = automation.pitch;
        track.recording = false;
        track.active = false;
        track.paused = false;
        track.pausedPositionSec = 0;
        track.playbackStartMs = 0;
        track.lastPreviewLength = 0;
        updateAutomationView(id);
        updateAutomationTickEnabled();
      }
      setDeckPitchShift(id, nextPitch);
    }
  };

  const loadDeckBuffer = useCallback(
    (id: number, buffer: AudioBuffer, options?: { name?: string; autoplay?: boolean }) => {
      const deck = decks.find((item) => item.id === id);
      if (!deck) return;
      stop(id);
      playbackStartRef.current.delete(id);
      const duration = Number.isFinite(buffer.duration)
        ? buffer.duration
        : buffer.length / buffer.sampleRate;
      const name = options?.name ?? deck.fileName ?? "Stretched Loop";
      const autoplay = options?.autoplay ?? true;
      const nextGain = 0.9;
      const nextBalance = 0;
      const nextPitchShift = 0;
      const nextTempoOffset = 0;
      const nextStretchRatio = deck.stretchRatio ?? 2;
      resetAutomation(id, 0, 0.7, 0, 0, 0, nextBalance, nextPitchShift);

      const nextDeck = {
        ...deck,
        fileName: name,
        buffer,
        duration,
        gain: nextGain,
        djFilter: 0,
        filterResonance: 0.7,
        eqLowGain: 0,
        eqMidGain: 0,
        eqHighGain: 0,
        balance: nextBalance,
        pitchShift: nextPitchShift,
        offsetSeconds: 0,
        zoom: 1,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: duration,
        tempoOffset: nextTempoOffset,
        tempoPitchSync: false,
        stretchRatio: nextStretchRatio,
        status: autoplay ? "playing" : "ready",
        startedAtMs: autoplay ? performance.now() : undefined,
      };

      setDecksWithHistory((prev) =>
        prev.map((item) => (item.id === id ? nextDeck : item))
      );

      setDeckGain(id, nextGain);
      setDeckFilter(id, 0);
      setDeckResonance(id, 0.7);
      setDeckEqLow(id, 0);
      setDeckEqMid(id, 0);
      setDeckEqHigh(id, 0);
      setDeckBalance(id, nextBalance);
      setDeckPitchShift(id, nextPitchShift);
      setDeckPlaybackRate(id, 1);
      setDeckLoopParams(id, true, 0, duration);

      if (autoplay) {
        const startedAtMs = nextDeck.startedAtMs ?? performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        void playBuffer(
          id,
          buffer,
          () => {
            console.info("Deck ended", { deckId: id, loopEnabled: true });
            playbackStartRef.current.delete(id);
            updateDeck(id, { status: "ready", startedAtMs: undefined, offsetSeconds: 0 }, false);
          },
          nextGain,
          0,
          1,
          true,
          0,
          duration,
          20000,
          60,
          0.7,
          0,
          0,
          0,
          nextBalance,
          nextPitchShift
        );
      }
    },
    [
      decks,
      playBuffer,
      resetAutomation,
      setDeckBalance,
      setDeckEqHigh,
      setDeckEqLow,
      setDeckEqMid,
      setDeckFilter,
      setDeckGain,
      setDeckLoopParams,
      setDeckPitchShift,
      setDeckPlaybackRate,
      setDeckResonance,
      setDecksWithHistory,
      stop,
      updateDeck,
    ]
  );

  const setDeckStretchRatio = (id: number, value: number) => {
    const safeValue = Number.isFinite(value) ? value : 2;
    const clamped = Math.min(Math.max(safeValue, 1), 16);
    updateDeck(id, { stretchRatio: clamped });
  };

  const getDeckPlaybackSnapshotSafe = useCallback(
    (id: number) => {
      const deck = decks.find((item) => item.id === id);
      if (!deck) return null;
      const duration = deck.duration ?? deck.buffer?.duration ?? 0;
      if (!duration) return null;
      const loopStart = deck.loopStartSeconds ?? 0;
      const loopEnd =
        deck.loopEndSeconds > loopStart + 0.01 ? deck.loopEndSeconds : duration;
      const tempoRatio = getDeckPlaybackRate(deck);
      const startedAtMs = deck.startedAtMs ?? playbackStartRef.current.get(id);
      if (deck.status !== "playing" || startedAtMs === undefined) {
        return {
          position: Math.min(deck.offsetSeconds ?? 0, duration),
          duration,
          loopEnabled: deck.loopEnabled,
          loopStart,
          loopEnd,
          playing: false,
          playbackRate: tempoRatio,
        };
      }
      const elapsed = (performance.now() - startedAtMs) / 1000;
      let position = (deck.offsetSeconds ?? 0) + elapsed * tempoRatio;
      if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
        const loopDuration = loopEnd - loopStart;
        const loopOffset = position - loopStart;
        const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
        position = loopStart + wrapped;
      } else {
        position = Math.min(position, duration);
      }
      return {
        position,
        duration,
        loopEnabled: deck.loopEnabled,
        loopStart,
        loopEnd,
        playing: deck.status === "playing",
        playbackRate: tempoRatio,
      };
    },
    [decks, getDeckPlaybackRate]
  );

  const getSessionDecks = useCallback((): DeckSession[] => {
    return decks.map((deck) => {
      const automation = automationRef.current.get(deck.id);
      const buildSnapshot = (track: AutomationTrack | undefined, fallbackValue: number) => ({
        samples: Array.from(track?.samples ?? []),
        sampleRate: track?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
        durationSec: track?.durationSec ?? 0,
        active: track?.active ?? false,
        currentValue: track?.currentValue ?? fallbackValue,
      });

      return {
        id: deck.id,
        fileName: deck.fileName,
        gain: deck.gain,
        djFilter: deck.djFilter,
        filterResonance: deck.filterResonance,
        eqLowGain: deck.eqLowGain,
        eqMidGain: deck.eqMidGain,
        eqHighGain: deck.eqHighGain,
        balance: deck.balance,
        pitchShift: deck.pitchShift,
        offsetSeconds: deck.offsetSeconds ?? 0,
        zoom: deck.zoom,
        loopEnabled: deck.loopEnabled,
        loopStartSeconds: deck.loopStartSeconds,
        loopEndSeconds: deck.loopEndSeconds,
        tempoOffset: deck.tempoOffset,
        tempoPitchSync: deck.tempoPitchSync,
        stretchRatio: deck.stretchRatio,
        automation: {
          djFilter: buildSnapshot(automation?.djFilter, deck.djFilter),
          resonance: buildSnapshot(automation?.resonance, deck.filterResonance),
          eqLow: buildSnapshot(automation?.eqLow, deck.eqLowGain),
          eqMid: buildSnapshot(automation?.eqMid, deck.eqMidGain),
          eqHigh: buildSnapshot(automation?.eqHigh, deck.eqHighGain),
          balance: buildSnapshot(automation?.balance, deck.balance),
          pitch: buildSnapshot(automation?.pitch, deck.pitchShift),
        },
      };
    });
  }, [decks]);

  const loadSessionDecks = useCallback(
    (sessionDecks: DeckSession[], buffers: Map<number, AudioBuffer | null>) => {
      decks.forEach((deck) => {
        stop(deck.id);
        removeDeckNodes(deck.id);
      });

      playbackStartRef.current = new Map();
      playbackRateRef.current = new Map();
      fileInputRefs.current = new Map();
      automationRef.current = new Map();
      automationPlayheadRef.current = new Map();
      automationUiUpdateRef.current = new Map();

      const nextAutomationState = new Map<number, Record<AutomationParam, AutomationView>>();
      let maxDeckId = 1;

      const nextDecks = sessionDecks.map((sessionDeck) => {
        const buffer = buffers.get(sessionDeck.id) ?? undefined;
        const duration = buffer
          ? Number.isFinite(buffer.duration)
            ? buffer.duration
            : buffer.length / buffer.sampleRate
          : 0;
        const loopStart = sessionDeck.loopStartSeconds ?? 0;
        const loopEnd = duration
          ? Math.min(
              Math.max(loopStart + 0.01, sessionDeck.loopEndSeconds ?? duration),
              duration
            )
          : sessionDeck.loopEndSeconds ?? 0;
        const offsetSeconds = duration
          ? Math.min(Math.max(0, sessionDeck.offsetSeconds ?? 0), duration)
          : 0;

        const ensureTrack = (
          snapshot: DeckSession["automation"][AutomationParam] | undefined,
          fallbackValue: number
        ): AutomationTrack => ({
          samples: new Float32Array(snapshot?.samples ?? []),
          sampleRate: snapshot?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
          durationSec: snapshot?.durationSec ?? 0,
          recording: false,
          active: snapshot?.active ?? false,
          paused: false,
          pausedPositionSec: 0,
          currentValue: snapshot?.currentValue ?? fallbackValue,
          lastIndex: -1,
          lastPreviewLength: 0,
          recordBuffer: [],
          recordStartMs: 0,
          lastSampleMs: 0,
          playbackStartMs:
            snapshot?.active && (snapshot?.durationSec ?? 0) > 0 ? performance.now() : 0,
        });

        const automation: AutomationDeck = {
          djFilter: ensureTrack(sessionDeck.automation.djFilter, sessionDeck.djFilter),
          resonance: ensureTrack(
            sessionDeck.automation.resonance,
            sessionDeck.filterResonance
          ),
          eqLow: ensureTrack(sessionDeck.automation.eqLow, sessionDeck.eqLowGain),
          eqMid: ensureTrack(sessionDeck.automation.eqMid, sessionDeck.eqMidGain),
          eqHigh: ensureTrack(sessionDeck.automation.eqHigh, sessionDeck.eqHighGain),
          balance: ensureTrack(
            sessionDeck.automation.balance,
            sessionDeck.balance ?? 0
          ),
          pitch: ensureTrack(
            sessionDeck.automation.pitch,
            sessionDeck.pitchShift ?? 0
          ),
        };

        automationRef.current.set(sessionDeck.id, automation);
        automationPlayheadRef.current.set(sessionDeck.id, {
          djFilter: 0,
          resonance: 0,
          eqLow: 0,
          eqMid: 0,
          eqHigh: 0,
          balance: 0,
          pitch: 0,
        });
        nextAutomationState.set(sessionDeck.id, {
          djFilter: toAutomationView(automation.djFilter),
          resonance: toAutomationView(automation.resonance),
          eqLow: toAutomationView(automation.eqLow),
          eqMid: toAutomationView(automation.eqMid),
          eqHigh: toAutomationView(automation.eqHigh),
          balance: toAutomationView(automation.balance),
          pitch: toAutomationView(automation.pitch),
        });

        maxDeckId = Math.max(maxDeckId, sessionDeck.id);

        return {
          id: sessionDeck.id,
          status: buffer ? "paused" : "idle",
          fileName: sessionDeck.fileName,
          buffer,
          duration: duration || undefined,
          gain: sessionDeck.gain,
          djFilter: sessionDeck.djFilter,
          filterResonance: sessionDeck.filterResonance,
          eqLowGain: sessionDeck.eqLowGain,
          eqMidGain: sessionDeck.eqMidGain,
          eqHighGain: sessionDeck.eqHighGain,
          balance: sessionDeck.balance ?? 0,
          pitchShift: sessionDeck.pitchShift ?? 0,
          offsetSeconds,
          zoom: sessionDeck.zoom,
        loopEnabled: sessionDeck.loopEnabled,
        loopStartSeconds: loopStart,
        loopEndSeconds: loopEnd,
        tempoOffset: sessionDeck.tempoOffset,
        tempoPitchSync: sessionDeck.tempoPitchSync ?? false,
        stretchRatio: sessionDeck.stretchRatio ?? 2,
        startedAtMs: undefined,
      };
      });

      nextDeckId.current = Math.max(2, maxDeckId + 1);
      historyRef.current = { past: [], future: [] };
      syncHistoryState();
      setDecksNoHistory(() => nextDecks);
      setAutomationState(nextAutomationState);
      updateAutomationTickEnabled();
    },
    [decks, removeDeckNodes, setDecksNoHistory, stop, syncHistoryState, updateAutomationTickEnabled]
  );

  return {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    setDeckGain: setDeckGainValue,
    setDeckFilter: setDeckFilterValue,
    setDeckResonance: setDeckResonanceValue,
    setDeckEqLow: setDeckEqLowValue,
    setDeckEqMid: setDeckEqMidValue,
    setDeckEqHigh: setDeckEqHighValue,
    setDeckBalance: setDeckBalanceValue,
    setDeckPitchShift: setDeckPitchShiftValue,
    seekDeck,
    setDeckZoom: setDeckZoomValue,
    setDeckLoop: setDeckLoopValue,
    setDeckLoopBounds,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
    setDeckStretchRatio,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
    getDeckPosition,
    getDeckPlaybackSnapshot: getDeckPlaybackSnapshotSafe,
    setFileInputRef,
    loadDeckBuffer,
    getSessionDecks,
    loadSessionDecks,
    undo,
    redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
  };
};

export default useDecks;
