import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { DeckState } from "../types/deck";
import {
  deriveRearrangedRegionIds,
  deriveRearrangedRegions,
  normalizeRearrangerRegions,
  rearrangeBufferSegment,
} from "../utils/rearranger";
import { approxEqual } from "../utils/appHelpers";

type RearrangePrecomputed = { buffer: AudioBuffer; regions: number[]; regionIds: number[] };

type UseRearrangerRuntimeArgs = {
  decks: DeckState[];
  getDeckPlaybackSnapshot: (deckId: number) => {
    playing: boolean;
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
    playbackRate: number;
    position: number;
  } | null;
  getAudioCurrentTime: () => number | null;
  handleRearrangeLoop: (
    deckId: number,
    options?: {
      transient?: boolean;
      precomputed?: RearrangePrecomputed;
    }
  ) => void;
  rearrangeBusyByDeckRef: MutableRefObject<Map<number, boolean>>;
  setDeckPlaybackRateTransient: (deckId: number, value: number) => void;
  setDeckDelayTimeTransient: (deckId: number, value: number) => void;
  setDeckRearrangerPanTransient: (deckId: number, value: number) => void;
  setDeckRearrangerPingPongLive: (
    deckId: number,
    value: number,
    config: {
      enabled: boolean;
      loopStart: number;
      loopEnd: number;
      playbackRate: number;
      regions: number[];
      sliceDelaySec: number;
      anchorTime: number;
      anchorPosition: number;
    } | null
  ) => void;
};

type SliceDelayHoldState = {
  lastSliceIndex: number;
  holdEndMs: number;
  holdSliceIndex: number;
  heldSliceIndex: number;
  appliedRate: number;
};

type RearrangerPingPongState = {
  signature: string;
};

type PendingAutoRearrange = {
  sourceBuffer: AudioBuffer;
  signature: string;
  buffer: AudioBuffer;
  regions: number[];
  regionIds: number[];
};

const HIDDEN_TICK_INTERVAL_MS = 10;

const useRearrangerRuntime = ({
  decks,
  getDeckPlaybackSnapshot,
  getAudioCurrentTime,
  handleRearrangeLoop,
  rearrangeBusyByDeckRef,
  setDeckPlaybackRateTransient,
  setDeckDelayTimeTransient,
  setDeckRearrangerPanTransient,
  setDeckRearrangerPingPongLive,
}: UseRearrangerRuntimeArgs) => {
  const decksRef = useRef<DeckState[]>(decks);
  const rearrangeLoopTrackerRef = useRef<Map<number, { lastPosition: number; lastTriggerMs: number }>>(
    new Map()
  );
  const sliceDelayHoldStateRef = useRef<Map<number, SliceDelayHoldState>>(new Map());
  const delaySliceSyncTrackerRef = useRef<Map<number, number>>(new Map());
  const rearrangerPingPongStateRef = useRef<Map<number, RearrangerPingPongState>>(new Map());
  const pendingAutoRearrangeRef = useRef<Map<number, PendingAutoRearrange>>(new Map());

  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    let disposed = false;
    let raf = 0;
    let hiddenTick = 0;
    const tick = () => {
      if (disposed) return;
      const decks = decksRef.current;
      const now = performance.now();
      const tracker = rearrangeLoopTrackerRef.current;
      const sliceDelayHoldState = sliceDelayHoldStateRef.current;
      const delaySyncTracker = delaySliceSyncTrackerRef.current;
      const pingPongSchedule = rearrangerPingPongStateRef.current;
      const pendingAuto = pendingAutoRearrangeRef.current;
      const busyByDeck = rearrangeBusyByDeckRef.current;
      const activeDecks = new Set(decks.map((deck) => deck.id));
      tracker.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          tracker.delete(deckId);
        }
      });
      sliceDelayHoldState.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          sliceDelayHoldState.delete(deckId);
        }
      });
      busyByDeck.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          busyByDeck.delete(deckId);
        }
      });
      delaySyncTracker.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          delaySyncTracker.delete(deckId);
        }
      });
      pingPongSchedule.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          pingPongSchedule.delete(deckId);
        }
      });
      pendingAuto.forEach((_, deckId) => {
        if (!activeDecks.has(deckId)) {
          pendingAuto.delete(deckId);
        }
      });

      decks.forEach((deck) => {
        const snapshot = getDeckPlaybackSnapshot(deck.id);
        const currentPosition = snapshot?.position ?? deck.offsetSeconds ?? 0;
        const basePlaybackRate = Math.max(0.01, 1 + (deck.tempoOffset ?? 0) / 100);
        const sliceDelaySec = Math.min(Math.max(deck.rearrangerSliceDelaySec ?? 0, 0), 5);
        const sliceDelayEnabled = sliceDelaySec >= 0.01;
        const applySliceDelayRate = (value: number) => {
          const state = sliceDelayHoldState.get(deck.id);
          if (state) {
            if (approxEqual(state.appliedRate, value, 1e-4)) return;
            state.appliedRate = value;
          }
          setDeckPlaybackRateTransient(deck.id, value);
        };
        const clearSliceDelayHold = () => {
          const state = sliceDelayHoldState.get(deck.id);
          if (!state) return;
          if (!approxEqual(state.appliedRate, basePlaybackRate, 1e-4)) {
            setDeckPlaybackRateTransient(deck.id, basePlaybackRate);
          }
          sliceDelayHoldState.delete(deck.id);
        };
        const lastSyncedSlice = delaySyncTracker.get(deck.id) ?? -1;
        const restoreManualDelayTime = () => {
          if (lastSyncedSlice !== -1) {
            setDeckDelayTimeTransient(deck.id, deck.delayTime);
            delaySyncTracker.set(deck.id, -1);
          }
        };
        if (
          !deck.delaySliceSync ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled ||
          (deck.rearrangerSlices ?? 0) <= 1
        ) {
          restoreManualDelayTime();
        } else {
          const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
          if (loopLength <= 0.001) {
            restoreManualDelayTime();
          } else {
            const regions = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
            const sliceCount = Math.max(0, regions.length - 1);
            if (sliceCount <= 1) {
              restoreManualDelayTime();
            } else {
              const clampedPosition = Math.min(
                snapshot.loopEnd - 1e-6,
                Math.max(snapshot.loopStart, currentPosition)
              );
              const progress = Math.min(
                1 - 1e-6,
                Math.max(0, (clampedPosition - snapshot.loopStart) / loopLength)
              );
              let sliceIndex = sliceCount - 1;
              for (let i = 0; i < sliceCount; i += 1) {
                if (progress >= regions[i] && progress < regions[i + 1]) {
                  sliceIndex = i;
                  break;
                }
              }
              if (sliceIndex !== lastSyncedSlice) {
                const sliceDuration =
                  loopLength * Math.max(0, (regions[sliceIndex + 1] ?? 1) - (regions[sliceIndex] ?? 0));
                if (sliceDuration > 0.001) {
                  setDeckDelayTimeTransient(deck.id, Math.min(1.5, Math.max(0.01, sliceDuration)));
                }
                delaySyncTracker.set(deck.id, sliceIndex);
              }
            }
          }
        }
        const audioNow = getAudioCurrentTime();
        if (
          !sliceDelayEnabled ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled ||
          (deck.rearrangerSlices ?? 0) <= 1
        ) {
          clearSliceDelayHold();
        } else {
          const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
          const regions = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
          const sliceCount = Math.max(0, regions.length - 1);
          if (loopLength <= 0.001 || sliceCount <= 1) {
            clearSliceDelayHold();
          } else {
            const clampedPosition = Math.min(
              snapshot.loopEnd - 1e-6,
              Math.max(snapshot.loopStart, currentPosition)
            );
            const progress = Math.min(
              1 - 1e-6,
              Math.max(0, (clampedPosition - snapshot.loopStart) / loopLength)
            );
            let sliceIndex = sliceCount - 1;
            for (let i = 0; i < sliceCount; i += 1) {
              if (progress >= regions[i] && progress < regions[i + 1]) {
                sliceIndex = i;
                break;
              }
            }
            let holdState = sliceDelayHoldState.get(deck.id);
            if (!holdState) {
              holdState = {
                lastSliceIndex: -1,
                holdEndMs: -1,
                holdSliceIndex: -1,
                heldSliceIndex: -1,
                appliedRate: basePlaybackRate,
              };
              sliceDelayHoldState.set(deck.id, holdState);
            }
            if (sliceIndex !== holdState.lastSliceIndex) {
              holdState.lastSliceIndex = sliceIndex;
              holdState.heldSliceIndex = -1;
              if (holdState.holdSliceIndex !== sliceIndex) {
                holdState.holdSliceIndex = -1;
                holdState.holdEndMs = -1;
              }
            }
            if (holdState.holdSliceIndex === sliceIndex) {
              if (now < holdState.holdEndMs) {
                applySliceDelayRate(0);
              } else {
                holdState.holdSliceIndex = -1;
                holdState.holdEndMs = -1;
                applySliceDelayRate(basePlaybackRate);
              }
            } else if (holdState.holdSliceIndex >= 0) {
              holdState.holdSliceIndex = -1;
              holdState.holdEndMs = -1;
              applySliceDelayRate(basePlaybackRate);
            } else {
              applySliceDelayRate(basePlaybackRate);
            }

            if (holdState.holdSliceIndex < 0 && holdState.heldSliceIndex !== sliceIndex) {
              const sliceStartNorm = regions[sliceIndex] ?? 0;
              const sliceEndNorm = regions[sliceIndex + 1] ?? 1;
              const normLength = Math.max(1e-6, sliceEndNorm - sliceStartNorm);
              const sliceDurationSec = loopLength * normLength;
              const positionInSliceNorm = Math.min(
                1,
                Math.max(0, (progress - sliceStartNorm) / normLength)
              );
              const timeUntilSliceEndSec = (1 - positionInSliceNorm) * sliceDurationSec;
              const holdTriggerWindowSec = Math.min(0.02, Math.max(0.006, sliceDurationSec * 0.5));
              if (timeUntilSliceEndSec <= holdTriggerWindowSec) {
                holdState.holdSliceIndex = sliceIndex;
                holdState.heldSliceIndex = sliceIndex;
                holdState.holdEndMs = now + sliceDelaySec * 1000;
                applySliceDelayRate(0);
              }
            }
          }
        }
        const resetPingPongPan = () => {
          setDeckRearrangerPanTransient(deck.id, 0);
          setDeckRearrangerPingPongLive(deck.id, 0, null);
          pingPongSchedule.delete(deck.id);
        };
        const pingPongAmount = Math.min(Math.max(deck.rearrangerPingPong ?? 0, 0), 1);
        const hasRearrangerRealtimeFx = pingPongAmount > 1e-3;
        if (
          !hasRearrangerRealtimeFx ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled ||
          (deck.rearrangerSlices ?? 0) <= 1
        ) {
          resetPingPongPan();
        } else {
          const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
          if (loopLength <= 0.001) {
            resetPingPongPan();
          } else {
            const regions = normalizeRearrangerRegions(deck.rearrangerRegions, deck.rearrangerSlices);
            const sliceCount = Math.max(0, regions.length - 1);
            if (sliceCount <= 1) {
              resetPingPongPan();
            } else {
              if (audioNow === null) {
                resetPingPongPan();
              } else {
                const clampedPosition = Math.min(
                  snapshot.loopEnd - 1e-6,
                  Math.max(snapshot.loopStart, currentPosition)
                );
                const playbackRate = Math.max(0.01, snapshot.playbackRate || 1);
                const regionsSignature = regions.map((value) => value.toFixed(6)).join(",");
                const signature = [
                  pingPongAmount.toFixed(4),
                  snapshot.loopStart.toFixed(5),
                  snapshot.loopEnd.toFixed(5),
                  clampedPosition.toFixed(5),
                  playbackRate.toFixed(5),
                  regionsSignature,
                ].join("|");
                const current = pingPongSchedule.get(deck.id);
                if (!current || current.signature !== signature) {
                  setDeckRearrangerPingPongLive(deck.id, pingPongAmount, {
                    enabled: true,
                    loopStart: snapshot.loopStart,
                    loopEnd: snapshot.loopEnd,
                    playbackRate,
                    regions,
                    sliceDelaySec: 0,
                    anchorTime: audioNow,
                    anchorPosition: clampedPosition,
                  });
                  pingPongSchedule.set(deck.id, { signature });
                }
              }
            }
          }
        }
        const state = tracker.get(deck.id) ?? {
          lastPosition: currentPosition,
          lastTriggerMs: 0,
        };

        if (
          !deck.rearrangerAuto ||
          deck.status !== "playing" ||
          !snapshot?.playing ||
          !snapshot.loopEnabled
        ) {
          pendingAuto.delete(deck.id);
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const loopLength = Math.max(0, snapshot.loopEnd - snapshot.loopStart);
        if (loopLength < 0.08) {
          pendingAuto.delete(deck.id);
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const sourceBuffer = deck.buffer;
        if (!sourceBuffer) {
          pendingAuto.delete(deck.id);
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: state.lastTriggerMs,
          });
          return;
        }

        const loopStart = Math.max(0, snapshot.loopStart);
        const loopEnd = Math.max(loopStart + 0.01, snapshot.loopEnd);
        const playbackRate = Math.max(0.01, snapshot.playbackRate || 1);
        const loopDuration = Math.max(0.01, loopEnd - loopStart);
        const clampedPosition = Math.min(loopEnd - 1e-6, Math.max(loopStart, currentPosition));
        const progress = Math.min(1 - 1e-6, Math.max(0, (clampedPosition - loopStart) / loopDuration));
        const timeUntilWrapSec = ((1 - progress) * loopDuration) / playbackRate;
        const rearrangerSignature = [
          deck.rearrangerSlices,
          deck.rearrangerSwapCount,
          deck.rearrangerChaos,
          deck.rearrangerReverse,
          deck.rearrangerSliceFadeMs,
          loopStart.toFixed(6),
          loopEnd.toFixed(6),
          (deck.rearrangerRegions ?? []).map((value) => value.toFixed(6)).join(","),
          (deck.rearrangerRegionIds ?? []).join(","),
          sourceBuffer.length,
        ].join("|");
        const cached = pendingAuto.get(deck.id);
        if (
          cached &&
          (cached.sourceBuffer !== sourceBuffer || cached.signature !== rearrangerSignature)
        ) {
          pendingAuto.delete(deck.id);
        }
        if (
          !pendingAuto.has(deck.id) &&
          !rearrangeBusyByDeckRef.current.get(deck.id) &&
          timeUntilWrapSec > 0.06
        ) {
          const chaosSeed = Math.random() * 1_000_000_000;
          const sampleRate = sourceBuffer.sampleRate;
          const startSample = Math.max(
            0,
            Math.min(sourceBuffer.length - 1, Math.round(loopStart * sampleRate))
          );
          const endSample = Math.max(
            startSample + 1,
            Math.min(sourceBuffer.length, Math.round(loopEnd * sampleRate))
          );
          const segmentSamples = Math.max(1, endSample - startSample);
          const buffer = rearrangeBufferSegment(
            sourceBuffer,
            loopStart,
            loopDuration,
            {
              slices: deck.rearrangerSlices,
              swapCount: deck.rearrangerSwapCount,
              chaos: deck.rearrangerChaos,
              reverse: deck.rearrangerReverse,
              regions: deck.rearrangerRegions,
              sliceFadeMs: deck.rearrangerSliceFadeMs,
            },
            { chaosSeed }
          );
          const regions = deriveRearrangedRegions(
            {
              slices: deck.rearrangerSlices,
              swapCount: deck.rearrangerSwapCount,
              chaos: deck.rearrangerChaos,
              reverse: deck.rearrangerReverse,
              regions: deck.rearrangerRegions,
              sliceFadeMs: deck.rearrangerSliceFadeMs,
            },
            { chaosSeed, segmentSamples }
          );
          const regionIds = deriveRearrangedRegionIds(
            {
              slices: deck.rearrangerSlices,
              swapCount: deck.rearrangerSwapCount,
              chaos: deck.rearrangerChaos,
              reverse: deck.rearrangerReverse,
              regions: deck.rearrangerRegions,
              sliceFadeMs: deck.rearrangerSliceFadeMs,
            },
            deck.rearrangerRegionIds,
            { chaosSeed }
          );
          pendingAuto.set(deck.id, {
            sourceBuffer,
            signature: rearrangerSignature,
            buffer,
            regions,
            regionIds,
          });
        }

        const triggerWindow = Math.min(0.12, loopLength * 0.25);
        const wrapped =
          state.lastPosition > currentPosition + 0.03 &&
          state.lastPosition > snapshot.loopStart + triggerWindow &&
          currentPosition <= snapshot.loopStart + triggerWindow;
        const cooldownMs = Math.max(120, Math.min(1000, loopLength * 500));

        if (wrapped && now - state.lastTriggerMs > cooldownMs) {
          const prepared = pendingAuto.get(deck.id);
          if (
            prepared &&
            prepared.sourceBuffer === sourceBuffer &&
            prepared.signature === rearrangerSignature
          ) {
            handleRearrangeLoop(deck.id, {
              transient: true,
              precomputed: {
                buffer: prepared.buffer,
                regions: prepared.regions,
                regionIds: prepared.regionIds,
              },
            });
            pendingAuto.delete(deck.id);
          } else {
            handleRearrangeLoop(deck.id, { transient: true });
          }
          tracker.set(deck.id, {
            lastPosition: currentPosition,
            lastTriggerMs: now,
          });
          return;
        }

        tracker.set(deck.id, {
          lastPosition: currentPosition,
          lastTriggerMs: state.lastTriggerMs,
        });
      });

      if (disposed) return;
      scheduleNextTick();
    };

    const scheduleNextTick = () => {
      if (disposed) return;
      if (hiddenTick !== 0) {
        window.clearTimeout(hiddenTick);
        hiddenTick = 0;
      }
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const shouldUseTimeout =
        document.visibilityState === "hidden" ||
        (typeof document.hasFocus === "function" && !document.hasFocus());
      if (shouldUseTimeout) {
        hiddenTick = window.setTimeout(tick, HIDDEN_TICK_INTERVAL_MS);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };

    const refreshSchedule = () => {
      if (disposed) return;
      scheduleNextTick();
    };

    window.addEventListener("blur", refreshSchedule, { passive: true });
    window.addEventListener("focus", refreshSchedule, { passive: true });
    document.addEventListener("visibilitychange", refreshSchedule, { passive: true });
    scheduleNextTick();

    return () => {
      disposed = true;
      window.removeEventListener("blur", refreshSchedule);
      window.removeEventListener("focus", refreshSchedule);
      document.removeEventListener("visibilitychange", refreshSchedule);
      if (hiddenTick !== 0) {
        window.clearTimeout(hiddenTick);
      }
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [
    getAudioCurrentTime,
    getDeckPlaybackSnapshot,
    handleRearrangeLoop,
    rearrangeBusyByDeckRef,
    setDeckPlaybackRateTransient,
    setDeckDelayTimeTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
  ]);
};

export default useRearrangerRuntime;
