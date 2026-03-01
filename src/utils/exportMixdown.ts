import type { DeckState, SimpleAutomationParam } from "../types/deck";
import { ensurePitchShiftWorklet } from "../audio/pitchShift";
import { applyPostEqEffectsOffline } from "../audio/effects/postEqPipeline";
import { applyPitchShiftOffline } from "../audio/effects/pitchShift";
import { applyDjFilterOffline } from "../audio/effects/djFilter";
import { applyEq3Offline } from "../audio/effects/eq3";
import { applyParametricEqOffline } from "../audio/effects/parametricEq";
import { applyBalanceOffline } from "../audio/effects/balance";
import { applyGainOffline } from "../audio/effects/gain";
import { applyMasterProtectOffline } from "../audio/effects/masterProtect";
import {
  createChannelVocoder,
  setChannelVocoderCarrierActive,
} from "../audio/effects/vocoder";
import {
  deriveRearrangedRegionIds,
  deriveRearrangedRegions,
  normalizeRearrangerRegionIds,
  normalizeRearrangerRegions,
  rearrangeBufferSegment,
} from "./rearranger";
import { hashStringToUint32, seededUnitFloat, trimBufferLeadingSamples } from "./appHelpers";
import { encodeWavOffThread } from "./wavWorkerClient";
import { setPerfCounter, setPerfTiming } from "./perf";

const MAX_EXPORT_AUTO_REARRANGE_CYCLES = 4096;
const EXPORT_PROFILE_ENABLED = import.meta.env.DEV;

type AutomationTrackView = {
  active: boolean;
  currentValue: number;
  samples: Float32Array;
  durationSec: number;
};

type DeckAutomationView = {
  djFilter?: AutomationTrackView;
  resonance?: AutomationTrackView;
  eqLow?: AutomationTrackView;
  eqMid?: AutomationTrackView;
  eqHigh?: AutomationTrackView;
  balance?: AutomationTrackView;
  pitch?: AutomationTrackView;
};

type RenderMixdownArgs = {
  decks: DeckState[];
  automationState: Map<number, DeckAutomationView>;
  durationSec: number;
  sessionName: string;
};

export const renderMixdownBlob = async ({
  decks,
  automationState,
  durationSec,
  sessionName,
}: RenderMixdownArgs): Promise<Blob> => {
  const exportStartedAt = performance.now();
  const timings = new Map<string, number>();
  const counters = new Map<string, number>();
  const deckProfiles: Array<{
    deckId: number;
    totalMs: number;
    autoRearrangeMs: number;
    autoRearrangeCycles: number;
    hasDelay: boolean;
    hasVocoder: boolean;
    loopEnabled: boolean;
  }> = [];
  const addTiming = (name: string, deltaMs: number) => {
    const next = (timings.get(name) ?? 0) + deltaMs;
    timings.set(name, next);
    setPerfTiming(`export.${name}`, next);
  };
  const incCounter = (name: string, delta = 1) => {
    const next = (counters.get(name) ?? 0) + delta;
    counters.set(name, next);
    setPerfCounter(`export.${name}`, next);
  };

  const resolveSimpleValue = (
    deck: DeckState,
    param: SimpleAutomationParam,
    fallback: number,
    atSec = 0
  ) => {
    const entry = deck.simpleAutomation?.[param];
    if (!entry?.active) return fallback;
    if (
      Array.isArray(entry.samples) &&
      entry.samples.length > 1 &&
      Number.isFinite(entry.durationSec) &&
      (entry.durationSec ?? 0) > 0
    ) {
      const durationSec = Math.max(0.05, entry.durationSec ?? 0.05);
      const sampleRate = Math.max(
        5,
        entry.sampleRate ?? entry.samples.length / durationSec
      );
      const positionSec = atSec % durationSec;
      const index = Math.min(
        entry.samples.length - 1,
        Math.max(0, Math.floor(positionSec * sampleRate))
      );
      return entry.samples[index] ?? fallback;
    }
    const cycle = Math.max(0.25, entry.cycleSec);
    const phase = (atSec / cycle) % 1;
    const shape = (Math.sin(phase * Math.PI * 2) + 1) * 0.5;
    return entry.baseline + (entry.target - entry.baseline) * shape;
  };

  const selectDecksStartedAt = performance.now();
  const activeDecks = decks.filter(
    (deck) => deck.buffer && deck.includeInRecordExport !== false
  );
  addTiming("selectActiveDecksMs", performance.now() - selectDecksStartedAt);
  incCounter("activeDecks", activeDecks.length);
  if (activeDecks.length === 0) {
    throw new Error("NO_ACTIVE_DECKS");
  }

  const setupStartedAt = performance.now();
  const sampleRate = activeDecks[0].buffer?.sampleRate ?? 44100;
  const length = Math.max(1, Math.ceil(durationSec * sampleRate));
  const offline = new OfflineAudioContext(2, length, sampleRate);
  addTiming("setupContextMs", performance.now() - setupStartedAt);
  setPerfCounter("export.sampleRate", sampleRate);
  setPerfCounter("export.renderSamples", length);

  const exportNeedsPitchWorklet = activeDecks.some((deck) => {
    const pitchAutomationActive = automationState.get(deck.id)?.pitch?.active === true;
    const pitchValue = pitchAutomationActive
      ? automationState.get(deck.id)?.pitch?.currentValue ?? deck.pitchShift
      : deck.pitchShift;
    const delayMix = Math.min(
      Math.max(resolveSimpleValue(deck, "delayMix", deck.delayMix ?? 0), 0),
      1
    );
    const pitchMix = Math.min(
      Math.max(resolveSimpleValue(deck, "delayRhythmMorph", deck.delayRhythmMorph ?? 0), 0),
      1
    );
    const pitchStep = Math.min(
      Math.max(resolveSimpleValue(deck, "delayRhythmRateHz", deck.delayRhythmRateHz ?? 0), -12),
      12
    );
    return (
      Math.abs(pitchValue ?? 0) >= 1e-3 ||
      pitchAutomationActive ||
      (delayMix > 1e-3 && pitchMix > 1e-3 && Math.abs(pitchStep) > 1e-3)
    );
  });
  setPerfCounter("export.pitchWorkletNeeded", exportNeedsPitchWorklet ? 1 : 0);
  if (exportNeedsPitchWorklet) {
    try {
      const ensurePitchWorkletStartedAt = performance.now();
      await ensurePitchShiftWorklet(offline);
      addTiming("ensurePitchWorkletMs", performance.now() - ensurePitchWorkletStartedAt);
    } catch (error) {
      console.warn("Pitch shift worklet unavailable for export", error);
    }
  }

  const masterMix = offline.createGain();
  const masterGain = offline.createGain();
  masterGain.gain.value = 0.9;
  masterMix.connect(masterGain);
  masterGain.connect(offline.destination);

  const scheduleRearrangerPingPongSpan = (
    panner: StereoPannerNode,
    startTime: number,
    spanDuration: number,
    regions: number[],
    amount: number
  ) => {
    if (spanDuration <= 0.000001) return;
    const sliceCount = Math.max(0, regions.length - 1);
    if (sliceCount <= 1) return;
    for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
      const normalizedStart = regions[sliceIndex] ?? 0;
      const eventTime = startTime + Math.max(0, normalizedStart) * spanDuration;
      if (eventTime > durationSec) break;
      const targetPan = (sliceIndex % 2 === 0 ? -1 : 1) * amount;
      panner.pan.setValueAtTime(targetPan, Math.max(0, eventTime));
    }
  };

  const createCarrierDeckSource = (carrierDeck: DeckState) => {
    if (!carrierDeck.buffer) return null;
    const tempoRatio = Math.min(Math.max(1 + carrierDeck.tempoOffset / 100, 0.01), 16);
    const loopStart = carrierDeck.loopStartSeconds ?? 0;
    const loopEnd =
      carrierDeck.loopEndSeconds && carrierDeck.loopEndSeconds > loopStart + 0.01
        ? carrierDeck.loopEndSeconds
        : carrierDeck.buffer.duration;
    const source = offline.createBufferSource();
    source.buffer = carrierDeck.buffer;
    source.playbackRate.value = tempoRatio;
    if (carrierDeck.loopEnabled && loopEnd > loopStart + 0.01) {
      source.loop = true;
      source.loopStart = Math.max(0, loopStart);
      source.loopEnd = Math.min(loopEnd, carrierDeck.buffer.duration);
    }
    source.start(0, Math.max(0, loopStart));
    return source;
  };

  const createSliceDelayedLoopBuffer = (
    deck: DeckState,
    loopStart: number,
    loopEnd: number,
    sliceDelaySecOverride?: number,
    sliceFadeMsOverride?: number
  ) => {
    if (!deck.buffer) return null;
    const sliceCount = Math.max(0, Math.round(deck.rearrangerSlices ?? 0));
    const sliceDelaySec = Math.min(
      Math.max(sliceDelaySecOverride ?? deck.rearrangerSliceDelaySec ?? 0, 0),
      5
    );
    if (sliceCount <= 1 || sliceDelaySec < 0.01) return null;
    // Export path: add a tiny minimum fade when slice delay inserts silence to avoid clicks.
    const effectiveSliceFadeMs = Math.max(sliceFadeMsOverride ?? deck.rearrangerSliceFadeMs ?? 0, 1);
    const startSample = Math.max(
      0,
      Math.min(deck.buffer.length - 1, Math.round(loopStart * deck.buffer.sampleRate))
    );
    const endSample = Math.max(
      startSample + 1,
      Math.min(deck.buffer.length, Math.round(loopEnd * deck.buffer.sampleRate))
    );
    const segmentSamples = Math.max(1, endSample - startSample);
    const loopSegment = trimBufferLeadingSamples(
      offline,
      deck.buffer,
      startSample,
      segmentSamples
    );
    return rearrangeBufferSegment(
      loopSegment,
      0,
      loopSegment.duration,
      {
        slices: deck.rearrangerSlices,
        swapCount: 0,
        chaos: 0,
        reverse: 0,
        regions: deck.rearrangerRegions,
        sliceFadeMs: effectiveSliceFadeMs,
        sliceDelaySec,
      },
      { chaosSeed: 0 }
    );
  };

  const getDeckModulatorOutputGain = (deckId: number) => {
    let isLinkedAsModulator = false;
    let monitorGain = 0;
    activeDecks.forEach((candidate) => {
      if (candidate.id === deckId) return;
      if ((candidate.vocoderMix ?? 0) <= 1e-3) return;
      if (candidate.vocoderCarrierDeckId !== deckId) return;
      isLinkedAsModulator = true;
      monitorGain = Math.max(
        monitorGain,
        Math.min(Math.max(candidate.vocoderModulatorMonitor ?? 0, 0), 1)
      );
    });
    return isLinkedAsModulator ? monitorGain : 1;
  };

  activeDecks.forEach((deck) => {
    const deckStartedAt = performance.now();
    let deckAutoRearrangeMs = 0;
    let deckAutoRearrangeCycles = 0;
    if (!deck.buffer) return;
    const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
    const pitchValue = (automationState.get(deck.id)?.pitch?.active
      ? automationState.get(deck.id)?.pitch?.currentValue
      : deck.pitchShift) ?? deck.pitchShift;
    const delayTime = Math.min(Math.max(resolveSimpleValue(deck, "delayTime", deck.delayTime ?? 0.35), 0.01), 1.5);
    const delayFeedback = Math.min(Math.max(resolveSimpleValue(deck, "delayFeedback", deck.delayFeedback ?? 0.35), 0), 0.99);
    const delayMix = Math.min(Math.max(resolveSimpleValue(deck, "delayMix", deck.delayMix ?? 0), 0), 1);
    const delayTone = Math.min(Math.max(resolveSimpleValue(deck, "delayTone", deck.delayTone ?? 6000), 400), 12000);
    const delaySaturation = Math.min(Math.max(resolveSimpleValue(deck, "delaySaturation", deck.delaySaturation ?? 0), 0), 1);
    const delayDamping = Math.min(Math.max(resolveSimpleValue(deck, "delayDamping", deck.delayDamping ?? 0), 0), 1);
    const delaySafety = Math.min(Math.max(resolveSimpleValue(deck, "delaySafety", deck.delaySafety ?? 0.35), 0), 1);
    const delayRhythmMorph = Math.min(
      Math.max(resolveSimpleValue(deck, "delayRhythmMorph", deck.delayRhythmMorph ?? 0), 0),
      1
    );
    const delayRhythmRateHz = Math.min(
      Math.max(resolveSimpleValue(deck, "delayRhythmRateHz", deck.delayRhythmRateHz ?? 0), -12),
      12
    );
    const delayRhythmSwing = Math.min(
      Math.max(resolveSimpleValue(deck, "delayRhythmSwing", deck.delayRhythmSwing ?? 0.5), 0),
      1
    );
    const delayDuckDepth = Math.min(
      Math.max(resolveSimpleValue(deck, "delayDuckDepth", deck.delayDuckDepth ?? 0), 0),
      1
    );
    const delayDuckThreshold = Math.min(
      Math.max(resolveSimpleValue(deck, "delayDuckThreshold", deck.delayDuckThreshold ?? 0.2), 0),
      1
    );
    const delayDuckResponseMs = Math.min(
      Math.max(resolveSimpleValue(deck, "delayDuckResponseMs", deck.delayDuckResponseMs ?? 80), 8),
      800
    );
    const delaySpectralMix = Math.min(
      Math.max(resolveSimpleValue(deck, "delaySpectralMix", deck.delaySpectralMix ?? 0), 0),
      1
    );
    const delaySpectralSpread = Math.min(
      Math.max(resolveSimpleValue(deck, "delaySpectralSpread", deck.delaySpectralSpread ?? 0.35), 0),
      1
    );
    const delayPingPong = deck.delayPingPong ?? false;
    const hasDelay = delayMix > 1e-3;
    const modulatorOutputGain = getDeckModulatorOutputGain(deck.id);
    const finalizeDeckProfile = () => {
      const deckTotalMs = performance.now() - deckStartedAt;
      deckProfiles.push({
        deckId: deck.id,
        totalMs: deckTotalMs,
        autoRearrangeMs: deckAutoRearrangeMs,
        autoRearrangeCycles: deckAutoRearrangeCycles,
        hasDelay,
        hasVocoder,
        loopEnabled: deck.loopEnabled && loopEnd > loopStart + 0.01,
      });
      addTiming("deckBuildAndScheduleMs", deckTotalMs);
      addTiming("deckAutoRearrangeMs", deckAutoRearrangeMs);
    };

    const automation = automationState.get(deck.id);
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
    const loopStart = deck.loopStartSeconds ?? 0;
    const loopEnd =
      deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
        ? deck.loopEndSeconds
        : deck.buffer.duration;
    const rearrangerSliceFadeMs = Math.round(
      Math.min(
        Math.max(resolveSimpleValue(deck, "rearrangerSliceFadeMs", deck.rearrangerSliceFadeMs ?? 0), 0),
        12
      )
    );
    const rearrangerSliceDelaySec = Math.min(
      Math.max(resolveSimpleValue(deck, "rearrangerSliceDelaySec", deck.rearrangerSliceDelaySec ?? 0), 0),
      5
    );
    // Slice delay in live playback is wall-clock based. Export bakes delay into audio buffers
    // before playbackRate is applied, so compensate by tempo ratio to keep heard spacing aligned.
    const rearrangerSliceDelayRenderSec = Math.max(0, rearrangerSliceDelaySec * tempoRatio);
    const sliceDelayedLoopBuffer =
      deck.loopEnabled && loopEnd > loopStart + 0.01
        ? createSliceDelayedLoopBuffer(
            deck,
            loopStart,
            loopEnd,
            rearrangerSliceDelayRenderSec,
            rearrangerSliceFadeMs
          )
        : null;
    const rearrangerSwapCount = Math.round(
      Math.min(
        Math.max(resolveSimpleValue(deck, "rearrangerSwapCount", deck.rearrangerSwapCount ?? 0), 0),
        Math.max(64, Math.round(deck.rearrangerSlices || 0))
      )
    );
    const rearrangerChaos = Math.min(
      Math.max(resolveSimpleValue(deck, "rearrangerChaos", deck.rearrangerChaos ?? 0), 0),
      1
    );
    const rearrangerReverse = Math.min(
      Math.max(resolveSimpleValue(deck, "rearrangerReverse", deck.rearrangerReverse ?? 0), 0),
      1
    );
    const pingPongAmount = Math.min(
      Math.max(resolveSimpleValue(deck, "rearrangerPingPong", deck.rearrangerPingPong ?? 0), 0),
      1
    );

    const deckInput = offline.createGain();
    const balancedOut = applyBalanceOffline(offline, deckInput, {
      balance: balanceValue,
      renderDuration: durationSec,
      automation: balanceTrack
        ? {
            active: balanceTrack.active,
            samples: balanceTrack.samples,
            durationSec: balanceTrack.durationSec,
          }
        : undefined,
    });
    const rearrangerPanner = offline.createStereoPanner();
    balancedOut.connect(rearrangerPanner);
    rearrangerPanner.pan.setValueAtTime(0, 0);
    let preEq: AudioNode = rearrangerPanner;
    preEq = applyPitchShiftOffline(offline, preEq, {
      pitch: pitchValue,
      renderDuration: durationSec,
      automation: pitchTrack
        ? {
            active: pitchTrack.active,
            samples: pitchTrack.samples,
            durationSec: pitchTrack.durationSec,
          }
        : undefined,
    });
    const postFilter = applyDjFilterOffline(offline, preEq, {
      djFilter: djFilterValue,
      resonance: resonanceValue,
      renderDuration: durationSec,
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
    let postEq: AudioNode =
      deck.eqMode === "parametric"
        ? applyParametricEqOffline(
            offline,
            postFilter,
            deck.eqMode,
            deck.parametricEqBands,
            durationSec
          )
        : applyEq3Offline(offline, postFilter, {
            low: eqLowValue,
            mid: eqMidValue,
            high: eqHighValue,
            renderDuration: durationSec,
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
    let postFxInput: AudioNode = postEq;
    const hasSelectedVocoderSource =
      deck.vocoderCarrierDeckId !== null && deck.vocoderCarrierDeckId !== deck.id;
    const vocoderMixValue = Math.min(Math.max(resolveSimpleValue(deck, "vocoderMix", deck.vocoderMix ?? 0), 0), 1);
    const hasVocoder = vocoderMixValue > 1e-3 && hasSelectedVocoderSource;
    if (vocoderMixValue > 1e-3 && hasSelectedVocoderSource) {
      const vocoder = createChannelVocoder(offline, {
        mix: vocoderMixValue,
        modDrive: resolveSimpleValue(deck, "vocoderModDrive", deck.vocoderModDrive ?? 2),
        bandCount: Math.round(resolveSimpleValue(deck, "vocoderBandCount", deck.vocoderBandCount)),
        bandSpread: resolveSimpleValue(deck, "vocoderBandSpread", deck.vocoderBandSpread),
        attackMs: resolveSimpleValue(deck, "vocoderAttackMs", deck.vocoderAttackMs),
        releaseMs: resolveSimpleValue(deck, "vocoderReleaseMs", deck.vocoderReleaseMs),
        noiseMix: resolveSimpleValue(deck, "vocoderNoiseMix", deck.vocoderNoiseMix),
        gateThreshold: resolveSimpleValue(deck, "vocoderGateThreshold", deck.vocoderGateThreshold),
      });
      postEq.connect(vocoder.carrierInput);
      const carrierDeck =
        deck.vocoderCarrierDeckId === null || deck.vocoderCarrierDeckId === deck.id
          ? null
          : activeDecks.find((candidate) => candidate.id === deck.vocoderCarrierDeckId) ?? null;
      const carrierSource = carrierDeck ? createCarrierDeckSource(carrierDeck) : null;
      if (carrierSource) {
        carrierSource.connect(vocoder.input);
      }
      const hasCarrier = carrierSource !== null;
      setChannelVocoderCarrierActive(vocoder, hasCarrier);
      postFxInput = vocoder.output;
    }
    postEq = applyPostEqEffectsOffline(
      offline,
      postFxInput,
      {
        delay: {
          time: delayTime,
          feedback: delayFeedback,
          mix: delayMix,
          tone: delayTone,
          saturation: delaySaturation,
          damping: delayDamping,
          safety: delaySafety,
          pingPong: delayPingPong,
          rhythmMorph: delayRhythmMorph,
          rhythmRateHz: delayRhythmRateHz,
          rhythmSwing: delayRhythmSwing,
          duckDepth: delayDuckDepth,
          duckThreshold: delayDuckThreshold,
          duckResponseMs: delayDuckResponseMs,
          spectralMix: delaySpectralMix,
          spectralSpread: delaySpectralSpread,
        },
      },
      "exportMix"
    );
    const postGain = applyGainOffline(offline, postEq, {
      gain: deck.gain * modulatorOutputGain,
      bypassAt: 0.9,
    });
    const protectedOut = applyMasterProtectOffline(offline, postGain, { enabled: true });
    protectedOut.connect(masterMix);

    if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
      const hasAutoLoopRearrange =
        deck.rearrangerAuto && (deck.rearrangerSlices ?? 0) > 1;
      if (hasAutoLoopRearrange) {
        const autoRearrangeStartedAt = performance.now();
        const startSample = Math.max(
          0,
          Math.min(deck.buffer.length - 1, Math.round(loopStart * deck.buffer.sampleRate))
        );
        const endSample = Math.max(
          startSample + 1,
          Math.min(deck.buffer.length, Math.round(loopEnd * deck.buffer.sampleRate))
        );
        const segmentSamples = Math.max(1, endSample - startSample);
        const loopSegment = trimBufferLeadingSamples(
          offline,
          deck.buffer,
          startSample,
          segmentSamples
        );
        const cycleDurationSec = Math.max(0.001, loopSegment.duration / tempoRatio);
        const estimatedCycles = Math.ceil(durationSec / cycleDurationSec);
        const cyclesToRender = Math.min(
          MAX_EXPORT_AUTO_REARRANGE_CYCLES,
          Math.max(1, estimatedCycles)
        );
        const deckSeedBase = hashStringToUint32(
          [
            sessionName,
            deck.id,
            deck.fileName ?? "",
            loopStart.toFixed(6),
            loopEnd.toFixed(6),
            tempoRatio.toFixed(6),
            deck.rearrangerSlices,
            rearrangerSwapCount,
            rearrangerChaos,
            rearrangerReverse,
            rearrangerSliceFadeMs,
            rearrangerSliceDelaySec,
            durationSec.toFixed(6),
          ].join("|")
        );
        const effectiveSliceFadeMs =
          rearrangerSliceDelaySec >= 0.01
            ? Math.max(rearrangerSliceFadeMs, 1)
            : rearrangerSliceFadeMs;
        let currentBuffer = sliceDelayedLoopBuffer ?? loopSegment;
        let currentRegions = normalizeRearrangerRegions(
          deck.rearrangerRegions,
          deck.rearrangerSlices
        );
        let currentRegionIds = normalizeRearrangerRegionIds(
          deck.rearrangerRegionIds,
          deck.rearrangerSlices
        );
        let timelineSec = 0;

        for (let cycle = 0; cycle < cyclesToRender && timelineSec < durationSec; cycle += 1) {
          const cycleStartSec = timelineSec;
          const cycleDurationSec = Math.max(0.001, currentBuffer.duration / tempoRatio);
          if (pingPongAmount > 0.001) {
            scheduleRearrangerPingPongSpan(
              rearrangerPanner,
              cycleStartSec,
              cycleDurationSec,
              currentRegions,
              pingPongAmount
            );
          }
          const source = offline.createBufferSource();
          source.buffer = currentBuffer;
          source.playbackRate.value = tempoRatio;
          source.connect(deckInput);
          source.start(cycleStartSec, 0);
          timelineSec += cycleDurationSec;
          if (timelineSec >= durationSec) break;

          const cycleSeed = (deckSeedBase ^ Math.imul(cycle + 1, 2654435761)) >>> 0;
          const chaosSeed = seededUnitFloat(cycleSeed) * 1_000_000_000;
          const rearrangerParams = {
            slices: deck.rearrangerSlices,
            swapCount: rearrangerSwapCount,
            chaos: rearrangerChaos,
            reverse: rearrangerReverse,
            regions: currentRegions,
            sliceFadeMs: effectiveSliceFadeMs,
            sliceDelaySec: rearrangerSliceDelayRenderSec,
          };
          const nextBuffer = rearrangeBufferSegment(
            currentBuffer,
            0,
            currentBuffer.duration,
            rearrangerParams,
            { chaosSeed }
          );
          deckAutoRearrangeCycles += 1;
          incCounter("autoRearrangeCycles");
          currentRegions = deriveRearrangedRegions(rearrangerParams, {
            chaosSeed,
            segmentSamples: currentBuffer.length,
            sampleRate: currentBuffer.sampleRate,
          });
          currentRegionIds = deriveRearrangedRegionIds(
            rearrangerParams,
            currentRegionIds,
            { chaosSeed }
          );
          currentBuffer = nextBuffer;
        }

        if (timelineSec < durationSec) {
          if (pingPongAmount > 0.001) {
            const cycleDurationSec = Math.max(0.001, currentBuffer.duration / tempoRatio);
            let pingPongTime = timelineSec;
            while (pingPongTime < durationSec) {
              scheduleRearrangerPingPongSpan(
                rearrangerPanner,
                pingPongTime,
                cycleDurationSec,
                currentRegions,
                pingPongAmount
              );
              pingPongTime += cycleDurationSec;
            }
          }
          const tail = offline.createBufferSource();
          tail.buffer = currentBuffer;
          tail.playbackRate.value = tempoRatio;
          tail.loop = true;
          tail.loopStart = 0;
          tail.loopEnd = currentBuffer.duration;
          tail.connect(deckInput);
          tail.start(timelineSec, 0);
        }
        deckAutoRearrangeMs += performance.now() - autoRearrangeStartedAt;
        finalizeDeckProfile();
        return;
      }
      if (pingPongAmount > 0.001 && (deck.rearrangerSlices ?? 0) > 1) {
        const cycleDurationSec = Math.max(
          0.001,
          (sliceDelayedLoopBuffer?.duration ?? (loopEnd - loopStart)) / tempoRatio
        );
        const loopRegions = normalizeRearrangerRegions(
          deck.rearrangerRegions,
          deck.rearrangerSlices
        );
        let cycleStartSec = 0;
        while (cycleStartSec < durationSec) {
          scheduleRearrangerPingPongSpan(
            rearrangerPanner,
            cycleStartSec,
            cycleDurationSec,
            loopRegions,
            pingPongAmount
          );
          cycleStartSec += cycleDurationSec;
        }
      }
    }

    const source = offline.createBufferSource();
    source.buffer = sliceDelayedLoopBuffer ?? deck.buffer;
    source.playbackRate.value = tempoRatio;
    source.connect(deckInput);
    if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
      source.loop = true;
      if (sliceDelayedLoopBuffer) {
        source.loopStart = 0;
        source.loopEnd = sliceDelayedLoopBuffer.duration;
      } else {
        source.loopStart = Math.max(0, loopStart);
        source.loopEnd = Math.min(loopEnd, deck.buffer.duration);
      }
    }
    source.start(0, sliceDelayedLoopBuffer ? 0 : Math.max(0, loopStart));
    finalizeDeckProfile();
  });

  const renderStartedAt = performance.now();
  const rendered = await offline.startRendering();
  addTiming("offlineRenderMs", performance.now() - renderStartedAt);
  const encodeStartedAt = performance.now();
  const blob = await encodeWavOffThread(rendered);
  addTiming("encodeWavMs", performance.now() - encodeStartedAt);
  addTiming("totalMs", performance.now() - exportStartedAt);

  if (EXPORT_PROFILE_ENABLED) {
    const sortedTimings = Array.from(timings.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([phase, ms]) => ({ phase, ms: Number(ms.toFixed(2)) }));
    const sortedDecks = [...deckProfiles]
      .sort((a, b) => b.totalMs - a.totalMs)
      .map((deckProfile) => ({
        deckId: deckProfile.deckId,
        totalMs: Number(deckProfile.totalMs.toFixed(2)),
        autoRearrangeMs: Number(deckProfile.autoRearrangeMs.toFixed(2)),
        autoRearrangeCycles: deckProfile.autoRearrangeCycles,
        hasDelay: deckProfile.hasDelay,
        hasVocoder: deckProfile.hasVocoder,
        loopEnabled: deckProfile.loopEnabled,
      }));
    const countersSummary = Object.fromEntries(counters.entries());
    console.groupCollapsed(
      `[export-profile] ${sessionName || "session"} | ${durationSec.toFixed(2)}s | ${activeDecks.length} deck(s)`
    );
    console.table(sortedTimings);
    console.table(sortedDecks);
    console.info("counters", countersSummary);
    console.groupEnd();
  }

  return blob;
};
