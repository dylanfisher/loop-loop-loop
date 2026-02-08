import type { DeckState } from "../types/deck";
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

const MAX_EXPORT_AUTO_REARRANGE_CYCLES = 4096;

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
  const activeDecks = decks.filter((deck) => deck.buffer);
  if (activeDecks.length === 0) {
    throw new Error("NO_ACTIVE_DECKS");
  }

  const sampleRate = activeDecks[0].buffer?.sampleRate ?? 44100;
  const length = Math.max(1, Math.ceil(durationSec * sampleRate));
  const offline = new OfflineAudioContext(2, length, sampleRate);

  try {
    await ensurePitchShiftWorklet(offline);
  } catch (error) {
    console.warn("Pitch shift worklet unavailable for export", error);
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
    if (!deck.buffer) return;
    const tempoRatio = Math.min(Math.max(1 + deck.tempoOffset / 100, 0.01), 16);
    const pitchValue = (automationState.get(deck.id)?.pitch?.active
      ? automationState.get(deck.id)?.pitch?.currentValue
      : deck.pitchShift) ?? deck.pitchShift;
    const delayTime = Math.min(Math.max(deck.delayTime ?? 0.35, 0.01), 1.5);
    const delayFeedback = Math.min(Math.max(deck.delayFeedback ?? 0.35, 0), 0.99);
    const delayMix = Math.min(Math.max(deck.delayMix ?? 0, 0), 1);
    const delayTone = Math.min(Math.max(deck.delayTone ?? 6000, 400), 12000);
    const delaySaturation = Math.min(Math.max(deck.delaySaturation ?? 0, 0), 1);
    const delayDamping = Math.min(Math.max(deck.delayDamping ?? 0, 0), 1);
    const delaySafety = Math.min(Math.max(deck.delaySafety ?? 0.35, 0), 1);
    const delayPingPong = deck.delayPingPong ?? false;
    const modulatorOutputGain = getDeckModulatorOutputGain(deck.id);

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
    const pingPongAmount = Math.min(Math.max(deck.rearrangerPingPong ?? 0, 0), 1);

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
    if (deck.vocoderMix > 1e-3 && hasSelectedVocoderSource) {
      const vocoder = createChannelVocoder(offline, {
        mix: deck.vocoderMix,
        modDrive: deck.vocoderModDrive ?? 2,
        bandCount: deck.vocoderBandCount,
        bandSpread: deck.vocoderBandSpread,
        attackMs: deck.vocoderAttackMs,
        releaseMs: deck.vocoderReleaseMs,
        noiseMix: deck.vocoderNoiseMix,
        gateThreshold: deck.vocoderGateThreshold,
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
            deck.rearrangerSwapCount,
            deck.rearrangerChaos,
            deck.rearrangerReverse,
            deck.rearrangerSliceFadeMs,
            deck.rearrangerSliceDelaySec,
            durationSec.toFixed(6),
          ].join("|")
        );
        let currentBuffer = loopSegment;
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
            swapCount: deck.rearrangerSwapCount,
            chaos: deck.rearrangerChaos,
            reverse: deck.rearrangerReverse,
            regions: currentRegions,
            sliceFadeMs: deck.rearrangerSliceFadeMs,
            sliceDelaySec: deck.rearrangerSliceDelaySec,
          };
          const nextBuffer = rearrangeBufferSegment(
            currentBuffer,
            0,
            currentBuffer.duration,
            rearrangerParams,
            { chaosSeed }
          );
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
        return;
      }
      if (pingPongAmount > 0.001 && (deck.rearrangerSlices ?? 0) > 1) {
        const cycleDurationSec = Math.max(0.001, (loopEnd - loopStart) / tempoRatio);
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
    source.buffer = deck.buffer;
    source.playbackRate.value = tempoRatio;
    source.connect(deckInput);
    if (deck.loopEnabled && loopEnd > loopStart + 0.01) {
      source.loop = true;
      source.loopStart = Math.max(0, loopStart);
      source.loopEnd = Math.min(loopEnd, deck.buffer.duration);
    }
    source.start(0, Math.max(0, loopStart));
  });

  const rendered = await offline.startRendering();
  return encodeWavOffThread(rendered);
};
