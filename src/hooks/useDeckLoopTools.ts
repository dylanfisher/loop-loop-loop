import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DeckState } from "../types/deck";
import type { AutomationParam } from "../types/session";
import type { AutomationView } from "./useDecksShared";
import { ensurePitchShiftWorklet } from "../audio/pitchShift";
import { createPaulStretchNode, ensurePaulStretchWorklet } from "../audio/paulStretch";
import { applyPitchShiftOffline } from "../audio/effects/pitchShift";
import { applyDjFilterOffline } from "../audio/effects/djFilter";
import { applyEq3Offline } from "../audio/effects/eq3";
import { applyParametricEqOffline } from "../audio/effects/parametricEq";
import { applyBalanceOffline } from "../audio/effects/balance";
import { applyGainOffline } from "../audio/effects/gain";
import { applyMasterProtectOffline } from "../audio/effects/masterProtect";
import {
  applyStretchCalibration,
  estimateStretchRenderSeconds,
  formatStretchEstimateLabel,
  loadStretchCalibrationState,
  updateStretchCalibrationState,
} from "../utils/stretchEstimate";
import {
  detectRearrangerRegionsFromBufferSegment,
  deriveRearrangedRegionIds,
  deriveRearrangedRegions,
  normalizeRearrangerRegionIds,
  normalizeRearrangerRegions,
  rearrangeBufferSegment,
} from "../utils/rearranger";
import {
  applyBufferGain,
  approxEqual,
  buildDerivedDeckName,
  computeRms,
  detectQuietRangesInSegment,
  findLeadingSilenceSamples,
  findTrailingNonSilenceSample,
  removeBufferRanges,
  removeBufferSegment,
  trimBufferLeadingSamples,
} from "../utils/appHelpers";

type UseDeckLoopToolsArgs = {
  decks: DeckState[];
  automationState: Map<number, Record<AutomationParam, AutomationView>>;
  loadDeckBuffer: (deckId: number, buffer: AudioBuffer, options: Record<string, unknown>) => void;
  getDeckPlaybackSnapshot: (deckId: number) => { position?: number } | null | undefined;
  markSkipNextAutosave: () => void;
  setDeckRearrangerRegions: (deckId: number, regions: number[]) => void;
  stretchCalibration: ReturnType<typeof loadStretchCalibrationState>;
  setStretchEstimateByDeckId: Dispatch<SetStateAction<Record<number, string>>>;
  setStretchCalibration: Dispatch<SetStateAction<ReturnType<typeof loadStretchCalibrationState>>>;
};

type UseDeckLoopToolsResult = {
  rearrangeBusyByDeckRef: MutableRefObject<Map<number, boolean>>;
  handleStretchLoop: (deckId: number) => Promise<void>;
  handleRearrangeLoop: (
    deckId: number,
    options?: {
      transient?: boolean;
      precomputed?: { buffer: AudioBuffer; regions: number[]; regionIds: number[] };
    }
  ) => void;
  handleDeleteRearrangerSlice: (deckId: number, sliceIndex: number) => void;
  handleAutoSliceRearranger: (deckId: number) => void;
  handleTrimQuietRearranger: (deckId: number) => void;
};

const useDeckLoopTools = ({
  decks,
  automationState,
  loadDeckBuffer,
  getDeckPlaybackSnapshot,
  markSkipNextAutosave,
  setDeckRearrangerRegions,
  stretchCalibration,
  setStretchEstimateByDeckId,
  setStretchCalibration,
}: UseDeckLoopToolsArgs): UseDeckLoopToolsResult => {
  const rearrangeBusyByDeckRef = useRef<Map<number, boolean>>(new Map());

  const handleStretchLoop = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const startedAtMs = performance.now();
      let renderCompleted = false;
      let baseEstimateSeconds = 0;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, deck.buffer.duration)
          : deck.buffer.duration;
      if (loopEnd <= loopStart + 0.01) return;
      const ratio = Math.min(Math.max(deck.stretchRatio ?? 2, 1), 16);
      const windowSize = Math.min(Math.max(deck.stretchWindowSize ?? 16384, 2048), 16384);
      const loopSamples = Math.max(1, Math.floor((loopEnd - loopStart) * deck.buffer.sampleRate));
      const maxWindow = Math.max(
        1024,
        Math.pow(2, Math.floor(Math.log2(Math.max(1, Math.floor(loopSamples / 2)))))
      );
      const effectiveWindowSize = Math.min(windowSize, maxWindow);
      baseEstimateSeconds = estimateStretchRenderSeconds({
        loopDurationSec: loopEnd - loopStart,
        stretchRatio: ratio,
        windowSize: effectiveWindowSize,
      });
      const calibratedEstimateSeconds = applyStretchCalibration(baseEstimateSeconds, stretchCalibration);
      setStretchEstimateByDeckId((prev) => ({
        ...prev,
        [deckId]: formatStretchEstimateLabel(
          calibratedEstimateSeconds,
          stretchCalibration.sampleCount
        ),
      }));
      try {
        const stereoWidth = Math.min(Math.max(deck.stretchStereoWidth ?? 1, 0), 2);
        const phaseRandomness = Math.min(Math.max(deck.stretchPhaseRandomness ?? 1, 0), 1);
        const tiltDb = Math.min(Math.max(deck.stretchTiltDb ?? 0, -18), 18);
        const scatter = Math.min(Math.max(deck.stretchScatter ?? 1, 1), 16);
        const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
        const sliceDuration = Math.max(0.01, loopEnd - loopStart);
        const inputDurationSource = sliceDuration * tempoRatio;
        const sampleRate = deck.buffer.sampleRate;
        const hopOut = effectiveWindowSize / 2;
        const inputSamples = Math.max(1, Math.ceil(sliceDuration * sampleRate * Math.max(1, scatter)));
        const effectiveRatio = Math.min(ratio * scatter, 128);
        const outputSamples = Math.max(1, Math.ceil(sliceDuration * effectiveRatio * sampleRate));
        const maxSilenceTrimSamples = Math.ceil(0.05 * sampleRate);
        const length = Math.max(1, outputSamples + maxSilenceTrimSamples + hopOut);
        const offline = new OfflineAudioContext(deck.buffer.numberOfChannels, length, sampleRate);
        try {
          await ensurePaulStretchWorklet(offline);
        } catch (error) {
          console.warn("Paulstretch worklet unavailable", error);
          return;
        }
        const stretchNode = createPaulStretchNode(offline, {
          ratio,
          winSize: effectiveWindowSize,
          inputSamples,
          outputSamples,
          stereoWidth,
          phaseRandomness,
          tilt: tiltDb,
          scatter,
        });
        stretchNode.port.onmessage = null;
        const source = offline.createBufferSource();
        const keepAlive = offline.createConstantSource();
        keepAlive.offset.value = 1e-6;
        source.buffer = deck.buffer;
        source.playbackRate.value = tempoRatio;

        const automation = automationState.get(deckId);
        const djFilterTrack = automation?.djFilter;
        const resonanceTrack = automation?.resonance;
        const eqLowTrack = automation?.eqLow;
        const eqMidTrack = automation?.eqMid;
        const eqHighTrack = automation?.eqHigh;
        const balanceTrack = automation?.balance;
        const pitchTrack = automation?.pitch;

        const djFilterValue = djFilterTrack?.active ? djFilterTrack.currentValue : deck.djFilter;
        const resonanceValue = resonanceTrack?.active
          ? resonanceTrack.currentValue
          : deck.filterResonance;
        const eqLowValue = eqLowTrack?.active ? eqLowTrack.currentValue : deck.eqLowGain;
        const eqMidValue = eqMidTrack?.active ? eqMidTrack.currentValue : deck.eqMidGain;
        const eqHighValue = eqHighTrack?.active ? eqHighTrack.currentValue : deck.eqHighGain;
        const balanceValue = balanceTrack?.active ? balanceTrack.currentValue : deck.balance;
        const pitchValue = pitchTrack?.active ? pitchTrack.currentValue : deck.pitchShift;

        const needsPitch = Math.abs(pitchValue) >= 0.001 || pitchTrack?.active === true;
        const needsFilter =
          Math.abs(djFilterValue) >= 0.001 ||
          !approxEqual(resonanceValue, 0) ||
          djFilterTrack?.active === true ||
          resonanceTrack?.active === true;
        const needsEq =
          deck.eqMode === "parametric"
            ? deck.parametricEqBands.some((band) => band.enabled && Math.abs(band.gain) > 1e-3)
            : !approxEqual(eqLowValue, 0) ||
              !approxEqual(eqMidValue, 0) ||
              !approxEqual(eqHighValue, 0) ||
              eqLowTrack?.active === true ||
              eqMidTrack?.active === true ||
              eqHighTrack?.active === true;
        const needsGain = !approxEqual(deck.gain, 0.9);

        if (needsPitch) {
          try {
            await ensurePitchShiftWorklet(offline);
          } catch (error) {
            console.warn("Pitch shift worklet unavailable for stretch render", error);
          }
        }

        const limiterNeeded = needsGain || needsEq || needsFilter || needsPitch;

        const renderDuration = sliceDuration;
        let chain: AudioNode = source;
        chain = applyBalanceOffline(offline, chain, {
          balance: balanceValue,
          renderDuration,
          automation: balanceTrack
            ? {
                active: balanceTrack.active,
                samples: balanceTrack.samples,
                durationSec: balanceTrack.durationSec,
              }
            : undefined,
        });
        chain = applyPitchShiftOffline(offline, chain, {
          pitch: pitchValue,
          renderDuration,
          automation: pitchTrack
            ? {
                active: pitchTrack.active,
                samples: pitchTrack.samples,
                durationSec: pitchTrack.durationSec,
              }
            : undefined,
        });
        chain = applyDjFilterOffline(offline, chain, {
          djFilter: djFilterValue,
          resonance: resonanceValue,
          renderDuration,
          djAutomation: djFilterTrack
            ? {
                active: djFilterTrack.active,
                samples: djFilterTrack.samples,
                durationSec: djFilterTrack.durationSec,
              }
            : undefined,
          resonanceAutomation: resonanceTrack
            ? {
                active: resonanceTrack.active,
                samples: resonanceTrack.samples,
                durationSec: resonanceTrack.durationSec,
              }
            : undefined,
        });
        chain =
          deck.eqMode === "parametric"
            ? applyParametricEqOffline(
                offline,
                chain,
                deck.eqMode,
                deck.parametricEqBands,
                renderDuration
              )
            : applyEq3Offline(offline, chain, {
                low: eqLowValue,
                mid: eqMidValue,
                high: eqHighValue,
                renderDuration,
                lowAutomation: eqLowTrack
                  ? {
                      active: eqLowTrack.active,
                      samples: eqLowTrack.samples,
                      durationSec: eqLowTrack.durationSec,
                    }
                  : undefined,
                midAutomation: eqMidTrack
                  ? {
                      active: eqMidTrack.active,
                      samples: eqMidTrack.samples,
                      durationSec: eqMidTrack.durationSec,
                    }
                  : undefined,
                highAutomation: eqHighTrack
                  ? {
                      active: eqHighTrack.active,
                      samples: eqHighTrack.samples,
                      durationSec: eqHighTrack.durationSec,
                    }
                  : undefined,
              });
        chain = applyGainOffline(offline, chain, { gain: deck.gain, bypassAt: 0.9 });
        chain = applyMasterProtectOffline(offline, chain, { enabled: limiterNeeded });
        chain.connect(stretchNode, 0, 0);
        keepAlive.connect(stretchNode, 0, 1);
        let stretchChain: AudioNode = stretchNode;
        if (stereoWidth !== 1 && deck.buffer.numberOfChannels > 1) {
          const splitter = offline.createChannelSplitter(2);
          const merger = offline.createChannelMerger(2);
          const midL = offline.createGain();
          const midR = offline.createGain();
          const sideL = offline.createGain();
          const sideR = offline.createGain();
          const midSum = offline.createGain();
          const sideSum = offline.createGain();
          const left = offline.createGain();
          const right = offline.createGain();
          const sideToRight = offline.createGain();

          midL.gain.value = 0.5;
          midR.gain.value = 0.5;
          sideL.gain.value = 0.5;
          sideR.gain.value = -0.5;
          sideSum.gain.value = stereoWidth;
          sideToRight.gain.value = -1;

          stretchChain.connect(splitter);
          splitter.connect(midL, 0);
          splitter.connect(midR, 1);
          midL.connect(midSum);
          midR.connect(midSum);

          splitter.connect(sideL, 0);
          splitter.connect(sideR, 1);
          sideL.connect(sideSum);
          sideR.connect(sideSum);

          midSum.connect(left);
          sideSum.connect(left);
          midSum.connect(right);
          sideSum.connect(sideToRight);
          sideToRight.connect(right);

          left.connect(merger, 0, 0);
          right.connect(merger, 0, 1);
          stretchChain = merger;
        }
        stretchChain.connect(offline.destination);

        if (scatter > 1) {
          source.loop = true;
          source.loopStart = loopStart;
          source.loopEnd = loopEnd;
          source.start(0, loopStart);
        } else {
          source.start(0, loopStart, inputDurationSource);
        }
        keepAlive.start(0);
        keepAlive.stop(length / sampleRate);

        const rendered = await offline.startRendering();
        findTrailingNonSilenceSample(rendered, 1e-4);
        const silenceTrimSamples = findLeadingSilenceSamples(rendered, maxSilenceTrimSamples, 1e-4);
        const totalTrim = Math.min(silenceTrimSamples, maxSilenceTrimSamples + hopOut);
        const trimmed = trimBufferLeadingSamples(offline, rendered, totalTrim, outputSamples);
        const sourceStartSample = Math.floor(loopStart * sampleRate);
        const sourceLengthSamples = Math.max(1, Math.floor(sliceDuration * sampleRate));
        const sourceRms = computeRms(deck.buffer, sourceStartSample, sourceLengthSamples);
        const stretchedRms = computeRms(trimmed, 0, trimmed.length);
        if (sourceRms > 0 && stretchedRms > 0) {
          const gain = Math.min(4, Math.max(0.25, sourceRms / stretchedRms));
          applyBufferGain(trimmed, gain);
        }
        const name = buildDerivedDeckName(deck.fileName, `Stretch ${ratio.toFixed(1)}x`);
        const wasPlaying = deck.status === "playing";
        loadDeckBuffer(deckId, trimmed, { name, autoplay: wasPlaying });
        renderCompleted = true;
      } finally {
        setStretchEstimateByDeckId((prev) => {
          if (!(deckId in prev)) return prev;
          const next = { ...prev };
          delete next[deckId];
          return next;
        });
        if (renderCompleted && baseEstimateSeconds > 0) {
          const actualSeconds = Math.max(0.001, (performance.now() - startedAtMs) / 1000);
          setStretchCalibration((prev) =>
            updateStretchCalibrationState(prev, baseEstimateSeconds, actualSeconds)
          );
        }
      }
    },
    [automationState, decks, loadDeckBuffer, setStretchCalibration, setStretchEstimateByDeckId, stretchCalibration]
  );

  const handleRearrangeLoop = useCallback(
    (
      deckId: number,
      options?: {
        transient?: boolean;
        precomputed?: { buffer: AudioBuffer; regions: number[]; regionIds: number[] };
      }
    ) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      if ((deck.rearrangerSlices ?? 0) <= 1) return;
      if (rearrangeBusyByDeckRef.current.get(deckId)) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const playbackSnapshot = getDeckPlaybackSnapshot(deckId);
      const currentPosition = playbackSnapshot?.position ?? deck.offsetSeconds ?? 0;
      const nextOffsetSeconds = Math.min(Math.max(0, currentPosition), duration);
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return;

      rearrangeBusyByDeckRef.current.set(deckId, true);
      try {
        let rearranged: AudioBuffer;
        let nextRegions: number[];
        let nextRegionIds: number[];
        if (options?.precomputed) {
          rearranged = options.precomputed.buffer;
          nextRegions = options.precomputed.regions;
          nextRegionIds = options.precomputed.regionIds;
        } else {
          const chaosSeed = Math.random() * 1_000_000_000;
          const loopDuration = loopEnd - loopStart;
          const sampleRate = deck.buffer.sampleRate;
          const startSample = Math.max(
            0,
            Math.min(deck.buffer.length - 1, Math.round(loopStart * sampleRate))
          );
          const endSample = Math.max(
            startSample + 1,
            Math.min(deck.buffer.length, Math.round((loopStart + loopDuration) * sampleRate))
          );
          const segmentSamples = Math.max(1, endSample - startSample);
          rearranged = rearrangeBufferSegment(
            deck.buffer,
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
          nextRegions = deriveRearrangedRegions(
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
          nextRegionIds = deriveRearrangedRegionIds(
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
        }
        const name = buildDerivedDeckName(deck.fileName, "Rearranged");
        const wasPlaying = deck.status === "playing";
        if (options?.transient) {
          markSkipNextAutosave();
        }
        loadDeckBuffer(deckId, rearranged, {
          name,
          autoplay: wasPlaying,
          recordHistory: !options?.transient,
          preserveNodes: options?.transient,
          preserveFxState: true,
          offsetSeconds: nextOffsetSeconds,
          rearrangerRegions: nextRegions,
          rearrangerRegionIds: nextRegionIds,
        });
      } finally {
        rearrangeBusyByDeckRef.current.set(deckId, false);
      }
    },
    [decks, getDeckPlaybackSnapshot, loadDeckBuffer, markSkipNextAutosave]
  );

  const handleDeleteRearrangerSlice = useCallback(
    (deckId: number, sliceIndex: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const sliceCount = Math.max(0, Math.round(deck.rearrangerSlices ?? 0));
      if (sliceCount <= 1) return;
      const clampedIndex = Math.max(0, Math.min(sliceCount - 1, Math.round(sliceIndex)));

      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration <= 0.01) return;

      const regions = normalizeRearrangerRegions(deck.rearrangerRegions, sliceCount);
      if (regions.length !== sliceCount + 1) return;
      const sliceStartSeconds = loopStart + loopDuration * regions[clampedIndex];
      const sliceEndSeconds = loopStart + loopDuration * regions[clampedIndex + 1];
      const sampleRate = deck.buffer.sampleRate;
      const startSample = Math.max(
        0,
        Math.min(deck.buffer.length - 1, Math.round(sliceStartSeconds * sampleRate))
      );
      const endSample = Math.max(
        startSample + 1,
        Math.min(deck.buffer.length, Math.round(sliceEndSeconds * sampleRate))
      );
      const removed = removeBufferSegment(deck.buffer, startSample, endSample);
      if (!removed) return;

      const removedDuration = removed.removedLength / sampleRate;
      const nextLoopStart = Math.min(loopStart, removed.buffer.duration);
      const nextLoopEnd = Math.min(
        removed.buffer.duration,
        Math.max(nextLoopStart + 0.01, loopEnd - removedDuration)
      );
      const nextLoopDuration = Math.max(0.01, nextLoopEnd - nextLoopStart);

      const absoluteBounds = regions.map((value) => loopStart + value * loopDuration);
      const nextAbsoluteBounds = absoluteBounds
        .filter((_, boundaryIndex) => boundaryIndex !== clampedIndex + 1)
        .map((seconds, boundaryIndex) => {
          if (boundaryIndex > clampedIndex) {
            return seconds - removedDuration;
          }
          return seconds;
        });
      const nextRegions =
        nextAbsoluteBounds.length > 2
          ? nextAbsoluteBounds.map((seconds, boundaryIndex, array) => {
              if (boundaryIndex === 0) return 0;
              if (boundaryIndex === array.length - 1) return 1;
              return Math.min(Math.max((seconds - nextLoopStart) / nextLoopDuration, 0), 1);
            })
          : undefined;
      const nextSlices = Math.max(0, sliceCount - 1);
      const currentIds = normalizeRearrangerRegionIds(deck.rearrangerRegionIds, sliceCount);
      const nextIds = [...currentIds];
      nextIds.splice(clampedIndex, 1);
      const wasPlaying = deck.status === "playing";

      loadDeckBuffer(deckId, removed.buffer, {
        name: buildDerivedDeckName(deck.fileName, "Edited"),
        autoplay: wasPlaying,
        preserveFxState: true,
        loopStartSeconds: nextLoopStart,
        loopEndSeconds: nextLoopEnd,
        rearrangerSlices: nextSlices,
        rearrangerRegions: nextRegions,
        rearrangerRegionIds: nextIds.slice(0, nextSlices),
        rearrangerRegionsManual: Boolean(nextRegions),
      });
    },
    [decks, loadDeckBuffer]
  );

  const handleAutoSliceRearranger = useCallback(
    (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration <= 0.01) return;
      const frameDurationMs = loopDuration > 180 ? 24 : loopDuration > 90 ? 20 : loopDuration > 45 ? 16 : 10;
      const currentSlices = Math.max(0, Math.round(deck.rearrangerSlices ?? 0));
      const maxSlices = currentSlices > 1 ? currentSlices : 16;
      const nextRegions = detectRearrangerRegionsFromBufferSegment(deck.buffer, loopStart, loopDuration, {
        maxSlices,
        frameDurationMs,
        sensitivity: deck.rearrangerSensitivity,
      });
      setDeckRearrangerRegions(deckId, nextRegions);
    },
    [decks, setDeckRearrangerRegions]
  );

  const handleTrimQuietRearranger = useCallback(
    (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration <= 0.01) return;
      const sampleRate = deck.buffer.sampleRate;
      const loopStartSample = Math.max(
        0,
        Math.min(deck.buffer.length - 1, Math.round(loopStart * sampleRate))
      );
      const loopEndSample = Math.max(
        loopStartSample + 1,
        Math.min(deck.buffer.length, Math.round(loopEnd * sampleRate))
      );
      const quietRanges = detectQuietRangesInSegment(
        deck.buffer,
        loopStartSample,
        loopEndSample,
        deck.rearrangerQuietThreshold
      );
      if (quietRanges.length === 0) return;
      const removed = removeBufferRanges(deck.buffer, quietRanges);
      if (!removed) return;
      const removedDuration = removed.removedLength / sampleRate;
      const nextLoopStart = Math.min(loopStart, removed.buffer.duration);
      const nextLoopEnd = Math.min(
        removed.buffer.duration,
        Math.max(nextLoopStart + 0.01, loopEnd - removedDuration)
      );
      const wasPlaying = deck.status === "playing";
      loadDeckBuffer(deckId, removed.buffer, {
        name: buildDerivedDeckName(deck.fileName, "Trimmed"),
        autoplay: wasPlaying,
        preserveFxState: true,
        loopStartSeconds: nextLoopStart,
        loopEndSeconds: nextLoopEnd,
        rearrangerRegions: undefined,
        rearrangerRegionIds: undefined,
        rearrangerRegionsManual: false,
      });
    },
    [decks, loadDeckBuffer]
  );

  return {
    rearrangeBusyByDeckRef,
    handleStretchLoop,
    handleRearrangeLoop,
    handleDeleteRearrangerSlice,
    handleAutoSliceRearranger,
    handleTrimQuietRearranger,
  };
};

export default useDeckLoopTools;
