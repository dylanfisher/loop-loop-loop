import type { MutableRefObject } from "react";
import type { DeckState } from "../types/deck";
import {
  DEFAULT_DELAY_DAMPING,
  DEFAULT_DELAY_DUCK_DEPTH,
  DEFAULT_DELAY_DUCK_RESPONSE_MS,
  DEFAULT_DELAY_DUCK_THRESHOLD,
  DEFAULT_DELAY_RHYTHM_MORPH,
  DEFAULT_DELAY_RHYTHM_RATE_HZ,
  DEFAULT_DELAY_RHYTHM_SWING,
  DEFAULT_DELAY_SAFETY,
  DEFAULT_DELAY_SATURATION,
  DEFAULT_DELAY_SPECTRAL_MIX,
  DEFAULT_DELAY_SPECTRAL_SPREAD,
  TEMPO_SNAP_STEP,
  TEMPO_SNAP_THRESHOLD,
  approxEqual,
  clampPlaybackRate,
  regionsEqual,
  type AutomationDeck,
} from "./useDecksShared";
import { normalizeRearrangerRegions } from "../utils/rearranger";

type Args = {
  decks: DeckState[];
  setDecksNoHistory: (updater: (prev: DeckState[]) => DeckState[]) => void;
  setDeckLoopParams: (id: number, enabled: boolean, startSeconds: number, endSeconds: number) => void;
  setDeckPlaybackRate: (id: number, value: number) => void;
  setDeckPitchShift: (id: number, value: number) => void;
  getDeckPosition: (id: number) => number | null;
  getDeckPlaybackRate: (deck: DeckState) => number;
  getFilterTargets: (djFilter: number) => { lowpass: number; highpass: number };
  getTempoSyncedPitch: (tempoOffset: number) => number;
  playBuffer: (
    deckId: number,
    buffer: AudioBuffer,
    onEnded: () => void,
    gain: number,
    offsetSeconds: number,
    playbackRate: number,
    loop: boolean,
    loopStartSeconds: number,
    loopEndSeconds: number,
    lowpassHz: number,
    highpassHz: number,
    filterResonance: number,
    eqMode: DeckState["eqMode"],
    eqLowGain: number,
    eqMidGain: number,
    eqHighGain: number,
    parametricEqBands: DeckState["parametricEqBands"],
    delayTime: number,
    delayFeedback: number,
    delayMix: number,
    delayTone: number,
    delayPingPong: boolean,
    delaySaturation: number,
    delayDamping: number,
    delaySafety: number,
    delayRhythmMorph: number,
    delayRhythmRateHz: number,
    delayRhythmSwing: number,
    delayDuckDepth: number,
    delayDuckThreshold: number,
    delayDuckResponseMs: number,
    delaySpectralMix: number,
    delaySpectralSpread: number,
    vocoderMix: number,
    vocoderCarrierDeckId: number | null,
    vocoderModulatorMonitor: number,
    vocoderModDrive: number,
    vocoderBandCount: number,
    vocoderBandSpread: number,
    vocoderAttackMs: number,
    vocoderReleaseMs: number,
    vocoderNoiseMix: number,
    vocoderGateThreshold: number,
    includeInRecordExport: boolean,
    balance: number,
    pitchShift: number,
    vocoderPostDelay?: boolean
  ) => Promise<void>;
  updateDeck: (id: number, patch: Partial<DeckState>, recordHistory?: boolean) => void;
  playbackStartRef: MutableRefObject<Map<number, number>>;
  loopBoundsHistorySnapshotRef: MutableRefObject<Map<number, DeckState[]>>;
  historyDisabledRef: MutableRefObject<boolean>;
  recordHistory: (snapshot: DeckState[]) => void;
  snapshotDecks: (source: DeckState[]) => DeckState[];
  automationRef: MutableRefObject<Map<number, AutomationDeck>>;
  updateAutomationView: (deckId: number) => void;
  updateAutomationTickEnabled: () => void;
};

export const createDeckLoopTempoControls = ({
  decks,
  setDecksNoHistory,
  setDeckLoopParams,
  setDeckPlaybackRate,
  setDeckPitchShift,
  getDeckPosition,
  getDeckPlaybackRate,
  getFilterTargets,
  getTempoSyncedPitch,
  playBuffer,
  updateDeck,
  playbackStartRef,
  loopBoundsHistorySnapshotRef,
  historyDisabledRef,
  recordHistory,
  snapshotDecks,
  automationRef,
  updateAutomationView,
  updateAutomationTickEnabled,
}: Args) => {
  const setDeckLoopValue = (id: number, value: boolean) => {
    setDecksNoHistory((prev) =>
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
          deck.eqMode,
          deck.eqLowGain,
          deck.eqMidGain,
          deck.eqHighGain,
          deck.parametricEqBands,
          deck.delayTime,
          deck.delayFeedback,
          deck.delayMix,
          deck.delayTone,
          deck.delayPingPong,
          deck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
          deck.delayDamping ?? DEFAULT_DELAY_DAMPING,
          deck.delaySafety ?? DEFAULT_DELAY_SAFETY,
          deck.delayRhythmMorph ?? DEFAULT_DELAY_RHYTHM_MORPH,
          deck.delayRhythmRateHz ?? DEFAULT_DELAY_RHYTHM_RATE_HZ,
          deck.delayRhythmSwing ?? DEFAULT_DELAY_RHYTHM_SWING,
          deck.delayDuckDepth ?? DEFAULT_DELAY_DUCK_DEPTH,
          deck.delayDuckThreshold ?? DEFAULT_DELAY_DUCK_THRESHOLD,
          deck.delayDuckResponseMs ?? DEFAULT_DELAY_DUCK_RESPONSE_MS,
          deck.delaySpectralMix ?? DEFAULT_DELAY_SPECTRAL_MIX,
          deck.delaySpectralSpread ?? DEFAULT_DELAY_SPECTRAL_SPREAD,
          deck.vocoderMix,
          deck.vocoderCarrierDeckId,
          deck.vocoderModulatorMonitor,
          deck.vocoderModDrive,
          deck.vocoderBandCount,
          deck.vocoderBandSpread,
          deck.vocoderAttackMs,
          deck.vocoderReleaseMs,
          deck.vocoderNoiseMix,
          deck.vocoderGateThreshold,
          deck.includeInRecordExport,
          deck.balance,
          deck.pitchShift,
          deck.vocoderPostDelay
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
    setDecksNoHistory((prev) =>
      prev.map((deck) => {
        if (deck.id !== id || !deck.buffer) return deck;
        const duration = deck.duration ?? deck.buffer.duration;
        const minGap = Math.min(0.05, Math.max(0.005, duration * 0.25));
        const nextStart = Math.min(Math.max(0, startSeconds), duration);
        const nextEnd = Math.min(Math.max(nextStart + minGap, endSeconds), duration);
        const prevLoopStart = Math.max(0, deck.loopStartSeconds ?? 0);
        const prevLoopEnd =
          deck.loopEndSeconds && deck.loopEndSeconds > prevLoopStart + 0.01
            ? Math.min(deck.loopEndSeconds, duration)
            : duration;
        const prevLoopDuration = Math.max(0.001, prevLoopEnd - prevLoopStart);
        const nextLoopDuration = Math.max(0.001, nextEnd - nextStart);
        const nextRearrangerRegions = (() => {
          if ((deck.rearrangerSlices ?? 0) <= 1) return deck.rearrangerRegions;
          const normalized = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
          const remapped = normalized.map((point, index) => {
            if (index === 0) return 0;
            if (index === normalized.length - 1) return 1;
            const absolute = prevLoopStart + point * prevLoopDuration;
            return Math.min(Math.max((absolute - nextStart) / nextLoopDuration, 0), 1);
          });
          for (let i = 1; i < remapped.length; i += 1) {
            remapped[i] = Math.max(remapped[i], remapped[i - 1]);
          }
          for (let i = remapped.length - 2; i >= 0; i -= 1) {
            remapped[i] = Math.min(remapped[i], remapped[i + 1]);
          }
          remapped[0] = 0;
          remapped[remapped.length - 1] = 1;
          return remapped;
        })();
        if (
          approxEqual(nextStart, deck.loopStartSeconds ?? 0) &&
          approxEqual(nextEnd, deck.loopEndSeconds ?? duration) &&
          regionsEqual(nextRearrangerRegions, deck.rearrangerRegions)
        ) {
          return deck;
        }
        if (!loopBoundsHistorySnapshotRef.current.has(id)) {
          loopBoundsHistorySnapshotRef.current.set(id, snapshotDecks(prev));
        }

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
              rearrangerRegions: nextRearrangerRegions,
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
              playbackStartRef.current.delete(deck.id);
              updateDeck(
                deck.id,
                { status: "ready", startedAtMs: undefined, offsetSeconds: 0 },
                false
              );
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
            deck.eqMode,
            deck.eqLowGain,
            deck.eqMidGain,
            deck.eqHighGain,
            deck.parametricEqBands,
            deck.delayTime,
            deck.delayFeedback,
            deck.delayMix,
            deck.delayTone,
            deck.delayPingPong,
            deck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
            deck.delayDamping ?? DEFAULT_DELAY_DAMPING,
            deck.delaySafety ?? DEFAULT_DELAY_SAFETY,
          deck.delayRhythmMorph ?? DEFAULT_DELAY_RHYTHM_MORPH,
          deck.delayRhythmRateHz ?? DEFAULT_DELAY_RHYTHM_RATE_HZ,
          deck.delayRhythmSwing ?? DEFAULT_DELAY_RHYTHM_SWING,
          deck.delayDuckDepth ?? DEFAULT_DELAY_DUCK_DEPTH,
          deck.delayDuckThreshold ?? DEFAULT_DELAY_DUCK_THRESHOLD,
          deck.delayDuckResponseMs ?? DEFAULT_DELAY_DUCK_RESPONSE_MS,
          deck.delaySpectralMix ?? DEFAULT_DELAY_SPECTRAL_MIX,
          deck.delaySpectralSpread ?? DEFAULT_DELAY_SPECTRAL_SPREAD,
          deck.vocoderMix,
            deck.vocoderCarrierDeckId,
            deck.vocoderModulatorMonitor,
            deck.vocoderModDrive,
            deck.vocoderBandCount,
            deck.vocoderBandSpread,
            deck.vocoderAttackMs,
            deck.vocoderReleaseMs,
            deck.vocoderNoiseMix,
            deck.vocoderGateThreshold,
            deck.includeInRecordExport,
            deck.balance,
            deck.pitchShift,
            deck.vocoderPostDelay
          );
          const startedAtMs = performance.now();
          playbackStartRef.current.set(id, startedAtMs);
          return {
            ...deck,
            loopStartSeconds: nextStart,
            loopEndSeconds: nextEnd,
            rearrangerRegions: nextRearrangerRegions,
            startedAtMs,
            offsetSeconds: clampedOffset,
          };
        }

        if (deck.loopEnabled) {
          setDeckLoopParams(deck.id, true, nextStart, nextEnd);
        }
        return {
          ...deck,
          loopStartSeconds: nextStart,
          loopEndSeconds: nextEnd,
          rearrangerRegions: nextRearrangerRegions,
        };
      })
    );
  };

  const commitDeckLoopBoundsHistory = (id: number) => {
    const tryCommit = (attempt: number) => {
      if (historyDisabledRef.current) return;
      const snapshot = loopBoundsHistorySnapshotRef.current.get(id);
      if (!snapshot) {
        if (attempt === 0) {
          window.setTimeout(() => tryCommit(1), 0);
        }
        return;
      }
      loopBoundsHistorySnapshotRef.current.delete(id);
      recordHistory(snapshot);
    };
    tryCommit(0);
  };

  const setDeckTempoOffset = (
    id: number,
    value: number,
    options?: { disableSnap?: boolean }
  ) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    const disableSnap = options?.disableSnap ?? false;
    let nextValue = safeValue;
    if (!disableSnap) {
      const snapped =
        Math.abs(safeValue) > 100
          ? safeValue
          : Math.round(safeValue / TEMPO_SNAP_STEP) * TEMPO_SNAP_STEP;
      nextValue =
        Math.abs(safeValue - snapped) <= TEMPO_SNAP_THRESHOLD ? snapped : safeValue;
    }
    let nextPitch = 0;
    let shouldSyncPitch = false;
    const currentDeck = decks.find((deck) => deck.id === id);
    setDecksNoHistory((prev) =>
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
    if (currentDeck?.status === "playing") {
      const position = getDeckPosition(id);
      if (position !== null) {
        const startedAtMs = performance.now();
        playbackStartRef.current.set(id, startedAtMs);
        updateDeck(id, { offsetSeconds: position, startedAtMs }, false);
      }
    }
  };

  const setDeckTempoPitchSync = (id: number, enabled: boolean) => {
    let nextPitch = 0;
    setDecksNoHistory((prev) =>
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

  return {
    setDeckLoopValue,
    setDeckLoopBounds,
    commitDeckLoopBoundsHistory,
    setDeckTempoOffset,
    setDeckTempoPitchSync,
  };
};
