import type { MutableRefObject } from "react";
import type { ParametricEqBand, DeckState } from "../types/deck";
import { normalizeParametricEqBands } from "../audio/effects/parametricEq";
import { clamp, type AutomationDeck } from "./useDecksShared";

type Args = {
  decks: DeckState[];
  automationRef: MutableRefObject<Map<number, AutomationDeck>>;
  getFilterTargets: (djFilter: number) => { lowpass: number; highpass: number };
  updateDeck: (id: number, patch: Partial<DeckState>, recordHistory?: boolean) => void;
  updateAutomationView: (deckId: number) => void;
  updateAutomationTickEnabled: () => void;
  setDeckGain: (id: number, value: number) => void;
  setDeckFilter: (id: number, value: number) => void;
  setDeckHighpass: (id: number, value: number) => void;
  setDeckResonance: (id: number, value: number) => void;
  setDeckParametricEqBands: (id: number, bands: ParametricEqBand[]) => void;
  setDeckPitchShift: (id: number, value: number) => void;
  setDeckDelayTime: (id: number, value: number) => void;
  setDeckDelayFeedback: (id: number, value: number) => void;
  setDeckDelayMix: (id: number, value: number) => void;
  setDeckDelayTone: (id: number, value: number) => void;
  setDeckDelayPingPong: (id: number, value: boolean) => void;
  setDeckDelaySaturation: (id: number, value: number) => void;
  setDeckDelayDamping: (id: number, value: number) => void;
  setDeckDelaySafety: (id: number, value: number) => void;
  setDeckDelayRhythmMorph: (id: number, value: number) => void;
  setDeckDelayRhythmRateHz: (id: number, value: number) => void;
  setDeckDelayRhythmSwing: (id: number, value: number) => void;
  setDeckDelayDuckDepth: (id: number, value: number) => void;
  setDeckDelayDuckThreshold: (id: number, value: number) => void;
  setDeckDelayDuckResponseMs: (id: number, value: number) => void;
  setDeckDelaySpectralMix: (id: number, value: number) => void;
  setDeckDelaySpectralSpread: (id: number, value: number) => void;
  setDeckDelaySpectralMotion: (id: number, value: number) => void;
  setDeckSpectralSpaceMix: (id: number, value: number) => void;
  setDeckSpectralSpaceSpread: (id: number, value: number) => void;
  setDeckSpectralSpaceMotion: (id: number, value: number) => void;
  setDeckSpectralSpaceTilt: (id: number, value: number) => void;
  setDeckSpectralSpaceLowMono: (id: number, value: number) => void;
  setDeckSpectralSpaceTransientProtect: (id: number, value: number) => void;
  setDeckVocoderMix: (id: number, value: number) => void;
  setDeckVocoderCarrierDeckId: (id: number, value: number | null) => void;
  setDeckVocoderModulatorMonitor: (id: number, value: number) => void;
  setDeckVocoderModDrive: (id: number, value: number) => void;
  setDeckVocoderBandCount: (id: number, value: number) => void;
  setDeckVocoderBandSpread: (id: number, value: number) => void;
  setDeckVocoderVocalCharacter: (id: number, value: number) => void;
  setDeckVocoderFormantShift: (id: number, value: number) => void;
  setDeckVocoderConsonantBoost: (id: number, value: number) => void;
  setDeckVocoderPreEmphasis: (id: number, value: number) => void;
  setDeckVocoderTightness: (id: number, value: number) => void;
  setDeckVocoderAttackMs: (id: number, value: number) => void;
  setDeckVocoderReleaseMs: (id: number, value: number) => void;
  setDeckVocoderNoiseMix: (id: number, value: number) => void;
  setDeckVocoderGateThreshold: (id: number, value: number) => void;
  setDeckVocoderPostDelay: (id: number, value: boolean) => void;
  setDeckPlaybackRate: (id: number, value: number) => void;
  setDeckPlaybackOffset: (id: number, value: number) => void;
  setDeckRearrangerPan: (id: number, value: number) => void;
  setDeckRearrangerPingPongAmount: (id: number, value: number) => void;
  setDeckRearrangerPingPongConfig: (
    id: number,
    config: {
      enabled: boolean;
      loopStart: number;
      loopEnd: number;
      playbackRate: number;
      regions: number[];
      sliceDelaySec?: number;
      anchorTime: number;
      anchorPosition: number;
    } | null
  ) => void;
  clearDeckRearrangerPanAutomation: (id: number, fromTime: number) => void;
  scheduleDeckRearrangerPan: (id: number, value: number, atTime: number, rampSeconds: number) => void;
};

const deactivateAutomationTrack = (
  automationRef: Args["automationRef"],
  deckId: number,
  param: keyof AutomationDeck,
  updateAutomationView: Args["updateAutomationView"],
  updateAutomationTickEnabled: Args["updateAutomationTickEnabled"]
) => {
  const automation = automationRef.current.get(deckId);
  const track = automation?.[param];
  if (track && track.active && !track.recording) {
    track.active = false;
    track.playbackStartMs = 0;
    updateAutomationView(deckId);
  }
  updateAutomationTickEnabled();
};

export const createDeckParameterSetters = ({
  decks,
  automationRef,
  getFilterTargets,
  updateDeck,
  updateAutomationView,
  updateAutomationTickEnabled,
  setDeckGain,
  setDeckFilter,
  setDeckHighpass,
  setDeckResonance,
  setDeckParametricEqBands,
  setDeckPitchShift,
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
  setDeckDelaySpectralMotion,
  setDeckSpectralSpaceMix,
  setDeckSpectralSpaceSpread,
  setDeckSpectralSpaceMotion,
  setDeckSpectralSpaceTilt,
  setDeckSpectralSpaceLowMono,
  setDeckSpectralSpaceTransientProtect,
  setDeckVocoderMix,
  setDeckVocoderCarrierDeckId,
  setDeckVocoderModulatorMonitor,
  setDeckVocoderModDrive,
  setDeckVocoderBandCount,
  setDeckVocoderBandSpread,
  setDeckVocoderVocalCharacter,
  setDeckVocoderFormantShift,
  setDeckVocoderConsonantBoost,
  setDeckVocoderPreEmphasis,
  setDeckVocoderTightness,
  setDeckVocoderAttackMs,
  setDeckVocoderReleaseMs,
  setDeckVocoderNoiseMix,
  setDeckVocoderGateThreshold,
  setDeckVocoderPostDelay,
  setDeckPlaybackRate,
  setDeckPlaybackOffset,
  setDeckRearrangerPan,
  setDeckRearrangerPingPongAmount,
  setDeckRearrangerPingPongConfig,
  clearDeckRearrangerPanAutomation,
  scheduleDeckRearrangerPan,
}: Args) => {
  const setDeckGainValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1.5);
    setDeckGain(id, clamped);
    updateDeck(id, { gain: clamped }, false);
    deactivateAutomationTrack(
      automationRef,
      id,
      "gain",
      updateAutomationView,
      updateAutomationTickEnabled
    );
  };

  const setDeckFilterValue = (id: number, value: number) => {
    const targets = getFilterTargets(value);
    setDeckFilter(id, targets.lowpass);
    setDeckHighpass(id, targets.highpass);
    updateDeck(id, { djFilter: clamp(value, -1, 1) }, false);
    deactivateAutomationTrack(
      automationRef,
      id,
      "djFilter",
      updateAutomationView,
      updateAutomationTickEnabled
    );
  };

  const setDeckResonanceValue = (id: number, value: number) => {
    setDeckResonance(id, value);
    updateDeck(id, { filterResonance: value }, false);
    deactivateAutomationTrack(
      automationRef,
      id,
      "resonance",
      updateAutomationView,
      updateAutomationTickEnabled
    );
  };

  const setDeckParametricEqBandsValue = (id: number, bands: ParametricEqBand[]) => {
    const normalized = normalizeParametricEqBands(bands);
    setDeckParametricEqBands(id, normalized);
    updateDeck(id, { parametricEqBands: normalized }, false);
  };

  const setDeckPitchShiftValue = (id: number, value: number) => {
    const deck = decks.find((item) => item.id === id);
    if (deck?.tempoPitchSync) return;
    const clamped = Math.min(Math.max(value, -24), 24);
    setDeckPitchShift(id, clamped);
    updateDeck(id, { pitchShift: clamped }, false);
    deactivateAutomationTrack(
      automationRef,
      id,
      "pitch",
      updateAutomationView,
      updateAutomationTickEnabled
    );
  };

  const setDeckDelayTimeValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0.01), 1.5);
    setDeckDelayTime(id, clamped);
    updateDeck(id, { delayTime: clamped }, false);
  };

  const setDeckDelayFeedbackValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 0.99);
    setDeckDelayFeedback(id, clamped);
    updateDeck(id, { delayFeedback: clamped }, false);
  };

  const setDeckDelayMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayMix(id, clamped);
    updateDeck(id, { delayMix: clamped }, false);
  };

  const setDeckDelayToneValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 400), 12000);
    setDeckDelayTone(id, clamped);
    updateDeck(id, { delayTone: clamped }, false);
  };

  const setDeckDelayPingPongValue = (id: number, value: boolean) => {
    setDeckDelayPingPong(id, value);
    updateDeck(id, { delayPingPong: value }, false);
  };

  const setDeckDelaySaturationValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelaySaturation(id, clamped);
    updateDeck(id, { delaySaturation: clamped }, false);
  };

  const setDeckDelayDampingValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayDamping(id, clamped);
    updateDeck(id, { delayDamping: clamped }, false);
  };

  const setDeckDelaySafetyValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelaySafety(id, clamped);
    updateDeck(id, { delaySafety: clamped }, false);
  };

  const setDeckDelayRhythmMorphValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayRhythmMorph(id, clamped);
    updateDeck(id, { delayRhythmMorph: clamped }, false);
  };

  const setDeckDelayRhythmRateHzValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, -12), 12);
    setDeckDelayRhythmRateHz(id, clamped);
    updateDeck(id, { delayRhythmRateHz: clamped }, false);
  };

  const setDeckDelayRhythmSwingValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayRhythmSwing(id, clamped);
    updateDeck(id, { delayRhythmSwing: clamped }, false);
  };

  const setDeckDelayDuckDepthValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayDuckDepth(id, clamped);
    updateDeck(id, { delayDuckDepth: clamped }, false);
  };

  const setDeckDelayDuckThresholdValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelayDuckThreshold(id, clamped);
    updateDeck(id, { delayDuckThreshold: clamped }, false);
  };

  const setDeckDelayDuckResponseMsValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 8), 800);
    setDeckDelayDuckResponseMs(id, clamped);
    updateDeck(id, { delayDuckResponseMs: clamped }, false);
  };

  const setDeckDelaySpectralMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelaySpectralMix(id, clamped);
    updateDeck(id, { delaySpectralMix: clamped }, false);
  };

  const setDeckDelaySpectralSpreadValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelaySpectralSpread(id, clamped);
    updateDeck(id, { delaySpectralSpread: clamped }, false);
  };

  const setDeckDelaySpectralMotionValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckDelaySpectralMotion(id, clamped);
    updateDeck(id, { delaySpectralMotion: clamped }, false);
  };

  const setDeckSpectralSpaceMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckSpectralSpaceMix(id, clamped);
    updateDeck(id, { spectralSpaceMix: clamped }, false);
  };

  const setDeckSpectralSpaceSpreadValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckSpectralSpaceSpread(id, clamped);
    updateDeck(id, { spectralSpaceSpread: clamped }, false);
  };

  const setDeckSpectralSpaceMotionValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckSpectralSpaceMotion(id, clamped);
    updateDeck(id, { spectralSpaceMotion: clamped }, false);
  };

  const setDeckSpectralSpaceTiltValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, -1), 1);
    setDeckSpectralSpaceTilt(id, clamped);
    updateDeck(id, { spectralSpaceTilt: clamped }, false);
  };

  const setDeckSpectralSpaceLowMonoValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckSpectralSpaceLowMono(id, clamped);
    updateDeck(id, { spectralSpaceLowMono: clamped }, false);
  };

  const setDeckSpectralSpaceTransientProtectValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckSpectralSpaceTransientProtect(id, clamped);
    updateDeck(id, { spectralSpaceTransientProtect: clamped }, false);
  };

  const setDeckVocoderMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderMix(id, clamped);
    updateDeck(id, { vocoderMix: clamped }, false);
  };

  const setDeckVocoderCarrierDeckIdValue = (id: number, value: number | null) => {
    const deck = decks.find((item) => item.id === id);
    const previous = deck?.vocoderCarrierDeckId ?? null;
    const normalized = value === id ? null : value;
    setDeckVocoderCarrierDeckId(id, normalized);
    let nextMixPatch: number | undefined;
    if (previous === null && normalized !== null) {
      nextMixPatch = 0.5;
      setDeckVocoderMix(id, nextMixPatch);
    } else if (normalized === null) {
      nextMixPatch = 0;
      setDeckVocoderMix(id, nextMixPatch);
    }
    updateDeck(
      id,
      {
        vocoderCarrierDeckId: normalized,
        ...(nextMixPatch === undefined ? {} : { vocoderMix: nextMixPatch }),
      },
      false
    );
  };

  const setDeckVocoderModulatorMonitorValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderModulatorMonitor(id, clamped);
    updateDeck(id, { vocoderModulatorMonitor: clamped }, false);
  };

  const setDeckVocoderModDriveValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0.5), 10);
    setDeckVocoderModDrive(id, clamped);
    updateDeck(id, { vocoderModDrive: clamped }, false);
  };

  const setDeckVocoderBandCountValue = (id: number, value: number) => {
    const clamped = Math.round(Math.min(Math.max(value, 4), 24));
    setDeckVocoderBandCount(id, clamped);
    updateDeck(id, { vocoderBandCount: clamped }, false);
  };

  const setDeckVocoderBandSpreadValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderBandSpread(id, clamped);
    updateDeck(id, { vocoderBandSpread: clamped }, false);
  };

  const setDeckVocoderVocalCharacterValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 3);
    setDeckVocoderVocalCharacter(id, clamped);
    updateDeck(id, { vocoderVocalCharacter: clamped }, false);
  };

  const setDeckVocoderFormantShiftValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, -12), 12);
    setDeckVocoderFormantShift(id, clamped);
    updateDeck(id, { vocoderFormantShift: clamped }, false);
  };

  const setDeckVocoderConsonantBoostValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderConsonantBoost(id, clamped);
    updateDeck(id, { vocoderConsonantBoost: clamped }, false);
  };

  const setDeckVocoderPreEmphasisValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderPreEmphasis(id, clamped);
    updateDeck(id, { vocoderPreEmphasis: clamped }, false);
  };

  const setDeckVocoderTightnessValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderTightness(id, clamped);
    updateDeck(id, { vocoderTightness: clamped }, false);
  };

  const setDeckVocoderAttackMsValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 1), 160);
    setDeckVocoderAttackMs(id, clamped);
    updateDeck(id, { vocoderAttackMs: clamped }, false);
  };

  const setDeckVocoderReleaseMsValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 1), 1200);
    setDeckVocoderReleaseMs(id, clamped);
    updateDeck(id, { vocoderReleaseMs: clamped }, false);
  };

  const setDeckVocoderNoiseMixValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderNoiseMix(id, clamped);
    updateDeck(id, { vocoderNoiseMix: clamped }, false);
  };

  const setDeckVocoderGateThresholdValue = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setDeckVocoderGateThreshold(id, clamped);
    updateDeck(id, { vocoderGateThreshold: clamped }, false);
  };

  const setDeckVocoderPostDelayValue = (id: number, value: boolean) => {
    const normalized = value === true;
    setDeckVocoderPostDelay(id, normalized);
    updateDeck(id, { vocoderPostDelay: normalized }, false);
  };

  const setDeckDelaySliceSyncValue = (id: number, value: boolean) => {
    updateDeck(id, { delaySliceSync: value }, false);
  };

  const setDeckDelayTimeTransient = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0.01), 1.5);
    setDeckDelayTime(id, clamped);
  };

  const setDeckPlaybackRateTransient = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, 0), 16);
    setDeckPlaybackRate(id, clamped);
  };

  const setDeckPlaybackOffsetTransient = (id: number, value: number) => {
    const clamped = Math.max(0, value);
    setDeckPlaybackOffset(id, clamped);
  };

  const setDeckRearrangerPanTransient = (id: number, value: number) => {
    const clamped = Math.min(Math.max(value, -1), 1);
    setDeckRearrangerPan(id, clamped);
  };

  const setDeckRearrangerPingPongLive = (
    id: number,
    amount: number,
    config: {
      enabled: boolean;
      loopStart: number;
      loopEnd: number;
      playbackRate: number;
      regions: number[];
      sliceDelaySec?: number;
      anchorTime: number;
      anchorPosition: number;
    } | null
  ) => {
    const clampedAmount = Math.min(Math.max(amount, 0), 1);
    setDeckRearrangerPingPongAmount(id, clampedAmount);
    setDeckRearrangerPingPongConfig(id, config);
  };

  const clearDeckRearrangerPanAutomationTransient = (id: number, fromTime: number) => {
    clearDeckRearrangerPanAutomation(id, Math.max(0, fromTime));
  };

  const scheduleDeckRearrangerPanTransient = (
    id: number,
    value: number,
    atTime: number,
    rampSeconds = 0
  ) => {
    const clamped = Math.min(Math.max(value, -1), 1);
    scheduleDeckRearrangerPan(id, clamped, Math.max(0, atTime), Math.max(0, rampSeconds));
  };

  return {
    setDeckGainValue,
    setDeckFilterValue,
    setDeckResonanceValue,
    setDeckParametricEqBandsValue,
    setDeckPitchShiftValue,
    setDeckDelayTimeValue,
    setDeckDelayFeedbackValue,
    setDeckDelayMixValue,
    setDeckDelayToneValue,
    setDeckDelayPingPongValue,
    setDeckDelaySaturationValue,
    setDeckDelayDampingValue,
    setDeckDelaySafetyValue,
    setDeckDelayRhythmMorphValue,
    setDeckDelayRhythmRateHzValue,
    setDeckDelayRhythmSwingValue,
    setDeckDelayDuckDepthValue,
    setDeckDelayDuckThresholdValue,
    setDeckDelayDuckResponseMsValue,
    setDeckDelaySpectralMixValue,
    setDeckDelaySpectralSpreadValue,
    setDeckDelaySpectralMotionValue,
    setDeckSpectralSpaceMixValue,
    setDeckSpectralSpaceSpreadValue,
    setDeckSpectralSpaceMotionValue,
    setDeckSpectralSpaceTiltValue,
    setDeckSpectralSpaceLowMonoValue,
    setDeckSpectralSpaceTransientProtectValue,
    setDeckVocoderMixValue,
    setDeckVocoderCarrierDeckIdValue,
    setDeckVocoderModulatorMonitorValue,
    setDeckVocoderModDriveValue,
    setDeckVocoderBandCountValue,
    setDeckVocoderBandSpreadValue,
    setDeckVocoderVocalCharacterValue,
    setDeckVocoderFormantShiftValue,
    setDeckVocoderConsonantBoostValue,
    setDeckVocoderPreEmphasisValue,
    setDeckVocoderTightnessValue,
    setDeckVocoderAttackMsValue,
    setDeckVocoderReleaseMsValue,
    setDeckVocoderNoiseMixValue,
    setDeckVocoderGateThresholdValue,
    setDeckVocoderPostDelayValue,
    setDeckDelaySliceSyncValue,
    setDeckDelayTimeTransient,
    setDeckPlaybackRateTransient,
    setDeckPlaybackOffsetTransient,
    setDeckRearrangerPanTransient,
    setDeckRearrangerPingPongLive,
    clearDeckRearrangerPanAutomationTransient,
    scheduleDeckRearrangerPanTransient,
  };
};
