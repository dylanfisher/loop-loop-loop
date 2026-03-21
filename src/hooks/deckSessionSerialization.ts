import type { DeckState, DeckStatus } from "../types/deck";
import type { AutomationParam, AutomationSnapshot, DeckSession } from "../types/session";
import { normalizeParametricEqBands } from "../audio/effects/parametricEq";
import {
  AUTOMATION_SAMPLE_RATE,
  DEFAULT_DELAY_DAMPING,
  DEFAULT_DELAY_FEEDBACK,
  DEFAULT_DELAY_MIX,
  DEFAULT_DELAY_PINGPONG,
  DEFAULT_LOOP_DELAY_SEC,
  DEFAULT_DELAY_DUCK_DEPTH,
  DEFAULT_DELAY_DUCK_RESPONSE_MS,
  DEFAULT_DELAY_DUCK_THRESHOLD,
  DEFAULT_DELAY_RHYTHM_MORPH,
  DEFAULT_DELAY_RHYTHM_RATE_HZ,
  DEFAULT_DELAY_RHYTHM_SWING,
  DEFAULT_DELAY_SAFETY,
  DEFAULT_DELAY_SATURATION,
  DEFAULT_DELAY_SPECTRAL_MIX,
  DEFAULT_DELAY_SPECTRAL_MOTION,
  DEFAULT_DELAY_SPECTRAL_SPREAD,
  DEFAULT_SPECTRAL_SPACE_LOW_MONO,
  DEFAULT_SPECTRAL_SPACE_MIX,
  DEFAULT_SPECTRAL_SPACE_MOTION,
  DEFAULT_SPECTRAL_SPACE_SPREAD,
  DEFAULT_SPECTRAL_SPACE_TILT,
  DEFAULT_SPECTRAL_SPACE_TRANSIENT_PROTECT,
  DEFAULT_DELAY_SLICE_SYNC,
  DEFAULT_DELAY_TIME,
  DEFAULT_DELAY_TONE,
  DEFAULT_PARAMETRIC_EQ_MOTION_STATE,
  DEFAULT_REARRANGER_AUTO,
  DEFAULT_REARRANGER_CHAOS,
  DEFAULT_REARRANGER_PINGPONG,
  DEFAULT_REARRANGER_QUIET_THRESHOLD,
  DEFAULT_REARRANGER_REVERSE,
  DEFAULT_REARRANGER_SENSITIVITY,
  DEFAULT_REARRANGER_SLICE_DELAY_SEC,
  DEFAULT_REARRANGER_SLICE_FADE_MS,
  DEFAULT_REARRANGER_SLICES,
  DEFAULT_REARRANGER_SWAP_COUNT,
  DEFAULT_STRETCH_PHASE_RANDOMNESS,
  DEFAULT_STRETCH_RATIO,
  DEFAULT_STRETCH_SCATTER,
  DEFAULT_STRETCH_STEREO_WIDTH,
  DEFAULT_STRETCH_TILT_DB,
  DEFAULT_STRETCH_WINDOW_SIZE,
  DEFAULT_VOCODER_ATTACK_MS,
  DEFAULT_VOCODER_BAND_COUNT,
  DEFAULT_VOCODER_BAND_SPREAD,
  DEFAULT_VOCODER_VOCAL_CHARACTER,
  DEFAULT_VOCODER_CONSONANT_BOOST,
  DEFAULT_VOCODER_CARRIER_DECK_ID,
  DEFAULT_VOCODER_FORMANT_SHIFT,
  DEFAULT_VOCODER_GATE_THRESHOLD,
  DEFAULT_VOCODER_MIX,
  DEFAULT_VOCODER_MOD_DRIVE,
  DEFAULT_VOCODER_MODULATOR_MONITOR,
  DEFAULT_VOCODER_NOISE_MIX,
  DEFAULT_VOCODER_PRE_EMPHASIS,
  DEFAULT_VOCODER_POST_DELAY,
  DEFAULT_VOCODER_RELEASE_MS,
  DEFAULT_VOCODER_TIGHTNESS,
  sanitizeRearrangerRegions,
  toAutomationView,
  normalizeParametricEqMotionState,
  normalizeSimpleAutomation,
  type AutomationDeck,
  type AutomationTrack,
  type AutomationView,
  withDefaultFxPanelOpen,
} from "./useDecksShared";

const buildAutomationSnapshot = (
  track: AutomationTrack | undefined,
  fallbackValue: number
): AutomationSnapshot => ({
  samples: Array.from(track?.samples ?? []),
  sampleRate: track?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
  durationSec: track?.durationSec ?? 0,
  active: track?.active ?? false,
  currentValue: track?.currentValue ?? fallbackValue,
});

const toAutomationTrack = (
  snapshot: DeckSession["automation"][AutomationParam] | undefined,
  fallbackValue: number
): AutomationTrack => {
  const isActive = snapshot?.active ?? false;
  return {
    samples: new Float32Array(snapshot?.samples ?? []),
    sampleRate: snapshot?.sampleRate ?? AUTOMATION_SAMPLE_RATE,
    durationSec: snapshot?.durationSec ?? 0,
    recording: false,
    active: isActive,
    paused: isActive,
    pausedPositionSec: 0,
    currentValue: snapshot?.currentValue ?? fallbackValue,
    amplitudeScale: 1,
    lastIndex: -1,
    lastPreviewLength: 0,
    recordBuffer: [],
    recordStartMs: 0,
    lastSampleMs: 0,
    playbackStartMs: 0,
  };
};

export const serializeDeckSession = (
  deck: DeckState,
  automation: AutomationDeck | undefined
): DeckSession => ({
  id: deck.id,
  fileName: deck.fileName,
  gain: deck.gain,
  djFilter: deck.djFilter,
  filterResonance: deck.filterResonance,
  parametricEqBands: normalizeParametricEqBands(deck.parametricEqBands),
  parametricEqMotion: normalizeParametricEqMotionState(deck.parametricEqMotion),
  simpleAutomation: normalizeSimpleAutomation(deck.simpleAutomation),
  balance: deck.balance,
  pitchShift: deck.pitchShift,
  vocoderMix: deck.vocoderMix,
  vocoderCarrierDeckId: deck.vocoderCarrierDeckId,
  vocoderModulatorMonitor: deck.vocoderModulatorMonitor,
  vocoderModDrive: deck.vocoderModDrive,
  vocoderBandCount: deck.vocoderBandCount,
  vocoderBandSpread: deck.vocoderBandSpread,
  vocoderVocalCharacter: deck.vocoderVocalCharacter,
  vocoderFormantShift: deck.vocoderFormantShift,
  vocoderConsonantBoost: deck.vocoderConsonantBoost,
  vocoderPreEmphasis: deck.vocoderPreEmphasis,
  vocoderTightness: deck.vocoderTightness,
  vocoderAttackMs: deck.vocoderAttackMs,
  vocoderReleaseMs: deck.vocoderReleaseMs,
  vocoderNoiseMix: deck.vocoderNoiseMix,
  vocoderGateThreshold: deck.vocoderGateThreshold,
  vocoderPostDelay: deck.vocoderPostDelay,
  includeInRecordExport: deck.includeInRecordExport,
  deckWidthOverride: deck.deckWidthOverride,
  offsetSeconds: deck.offsetSeconds ?? 0,
  zoom: deck.zoom,
  loopEnabled: deck.loopEnabled,
  loopStartSeconds: deck.loopStartSeconds,
  loopEndSeconds: deck.loopEndSeconds,
  loopDelaySec: deck.loopDelaySec,
  tempoOffset: deck.tempoOffset,
  tempoPitchSync: deck.tempoPitchSync,
  stretchRatio: deck.stretchRatio,
  stretchWindowSize: deck.stretchWindowSize,
  stretchStereoWidth: deck.stretchStereoWidth,
  stretchPhaseRandomness: deck.stretchPhaseRandomness,
  stretchTiltDb: deck.stretchTiltDb,
  stretchScatter: deck.stretchScatter,
  delayTime: deck.delayTime,
  delayFeedback: deck.delayFeedback,
  delayMix: deck.delayMix,
  delayTone: deck.delayTone,
  delayPingPong: deck.delayPingPong,
  delaySliceSync: deck.delaySliceSync,
  delaySaturation: deck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
  delayDamping: deck.delayDamping ?? DEFAULT_DELAY_DAMPING,
  delaySafety: deck.delaySafety ?? DEFAULT_DELAY_SAFETY,
  delayRhythmMorph: deck.delayRhythmMorph ?? DEFAULT_DELAY_RHYTHM_MORPH,
  delayRhythmRateHz: deck.delayRhythmRateHz ?? DEFAULT_DELAY_RHYTHM_RATE_HZ,
  delayRhythmSwing: deck.delayRhythmSwing ?? DEFAULT_DELAY_RHYTHM_SWING,
  delayDuckDepth: deck.delayDuckDepth ?? DEFAULT_DELAY_DUCK_DEPTH,
  delayDuckThreshold: deck.delayDuckThreshold ?? DEFAULT_DELAY_DUCK_THRESHOLD,
  delayDuckResponseMs: deck.delayDuckResponseMs ?? DEFAULT_DELAY_DUCK_RESPONSE_MS,
  delaySpectralMix: deck.delaySpectralMix ?? DEFAULT_DELAY_SPECTRAL_MIX,
  delaySpectralSpread: deck.delaySpectralSpread ?? DEFAULT_DELAY_SPECTRAL_SPREAD,
  delaySpectralMotion: deck.delaySpectralMotion ?? DEFAULT_DELAY_SPECTRAL_MOTION,
  spectralSpaceMix: deck.spectralSpaceMix ?? DEFAULT_SPECTRAL_SPACE_MIX,
  spectralSpaceSpread: deck.spectralSpaceSpread ?? DEFAULT_SPECTRAL_SPACE_SPREAD,
  spectralSpaceMotion: deck.spectralSpaceMotion ?? DEFAULT_SPECTRAL_SPACE_MOTION,
  spectralSpaceTilt: deck.spectralSpaceTilt ?? DEFAULT_SPECTRAL_SPACE_TILT,
  spectralSpaceLowMono: deck.spectralSpaceLowMono ?? DEFAULT_SPECTRAL_SPACE_LOW_MONO,
  spectralSpaceTransientProtect:
    deck.spectralSpaceTransientProtect ?? DEFAULT_SPECTRAL_SPACE_TRANSIENT_PROTECT,
  rearrangerSlices: deck.rearrangerSlices,
  rearrangerSwapCount: deck.rearrangerSwapCount,
  rearrangerChaos: deck.rearrangerChaos,
  rearrangerReverse: deck.rearrangerReverse,
  rearrangerSensitivity: deck.rearrangerSensitivity,
  rearrangerQuietThreshold: deck.rearrangerQuietThreshold,
  rearrangerSliceFadeMs: deck.rearrangerSliceFadeMs,
  rearrangerSliceDelaySec: deck.rearrangerSliceDelaySec,
  rearrangerPingPong: deck.rearrangerPingPong,
  rearrangerAuto: deck.rearrangerAuto,
  rearrangerRegions: sanitizeRearrangerRegions(deck.rearrangerRegions),
  rearrangerRegionIds: deck.rearrangerRegionIds,
  rearrangerRegionsManual: deck.rearrangerRegionsManual ?? false,
  fxPanelOpen: withDefaultFxPanelOpen(deck.fxPanelOpen),
  automation: {
    gain: buildAutomationSnapshot(automation?.gain, deck.gain),
    djFilter: buildAutomationSnapshot(automation?.djFilter, deck.djFilter),
    resonance: buildAutomationSnapshot(automation?.resonance, deck.filterResonance),
    balance: buildAutomationSnapshot(automation?.balance, deck.balance),
    pitch: buildAutomationSnapshot(automation?.pitch, deck.pitchShift),
  },
});

export type HydratedDeckSession = {
  deck: DeckState;
  automation: AutomationDeck;
  automationView: Record<AutomationParam, AutomationView>;
};

export const hydrateDeckFromSession = (
  sessionDeck: DeckSession,
  buffer: AudioBuffer | null | undefined
): HydratedDeckSession => {
  const duration = buffer
    ? Number.isFinite(buffer.duration)
      ? buffer.duration
      : buffer.length / buffer.sampleRate
    : 0;
  const loopStart = sessionDeck.loopStartSeconds ?? 0;
  const loopEnd = duration
    ? Math.min(Math.max(loopStart + 0.01, sessionDeck.loopEndSeconds ?? duration), duration)
    : (sessionDeck.loopEndSeconds ?? 0);
  const offsetSeconds = duration
    ? Math.min(Math.max(0, sessionDeck.offsetSeconds ?? 0), duration)
    : 0;

  const automation: AutomationDeck = {
    gain: toAutomationTrack(sessionDeck.automation.gain, sessionDeck.gain),
    djFilter: toAutomationTrack(sessionDeck.automation.djFilter, sessionDeck.djFilter),
    resonance: toAutomationTrack(sessionDeck.automation.resonance, sessionDeck.filterResonance),
    balance: toAutomationTrack(sessionDeck.automation.balance, sessionDeck.balance ?? 0),
    pitch: toAutomationTrack(sessionDeck.automation.pitch, sessionDeck.pitchShift ?? 0),
  };

  const status: DeckStatus = buffer ? "paused" : "idle";
  const deck: DeckState = {
    id: sessionDeck.id,
    status,
    fileName: sessionDeck.fileName,
    buffer: buffer ?? undefined,
    duration: duration || undefined,
    gain: sessionDeck.gain,
    djFilter: sessionDeck.djFilter,
    filterResonance: sessionDeck.filterResonance,
    parametricEqBands: normalizeParametricEqBands(sessionDeck.parametricEqBands),
    parametricEqMotion: normalizeParametricEqMotionState(
      sessionDeck.parametricEqMotion ?? DEFAULT_PARAMETRIC_EQ_MOTION_STATE
    ),
    simpleAutomation: normalizeSimpleAutomation(sessionDeck.simpleAutomation),
    balance: sessionDeck.balance ?? 0,
    pitchShift: sessionDeck.pitchShift ?? 0,
    vocoderMix: sessionDeck.vocoderMix ?? DEFAULT_VOCODER_MIX,
    vocoderCarrierDeckId:
      sessionDeck.vocoderCarrierDeckId === sessionDeck.id
        ? DEFAULT_VOCODER_CARRIER_DECK_ID
        : (sessionDeck.vocoderCarrierDeckId ?? DEFAULT_VOCODER_CARRIER_DECK_ID),
    vocoderModulatorMonitor:
      sessionDeck.vocoderModulatorMonitor ?? DEFAULT_VOCODER_MODULATOR_MONITOR,
    vocoderModDrive: sessionDeck.vocoderModDrive ?? DEFAULT_VOCODER_MOD_DRIVE,
    vocoderBandCount: sessionDeck.vocoderBandCount ?? DEFAULT_VOCODER_BAND_COUNT,
    vocoderBandSpread: sessionDeck.vocoderBandSpread ?? DEFAULT_VOCODER_BAND_SPREAD,
    vocoderVocalCharacter:
      sessionDeck.vocoderVocalCharacter ?? DEFAULT_VOCODER_VOCAL_CHARACTER,
    vocoderFormantShift:
      sessionDeck.vocoderFormantShift ?? DEFAULT_VOCODER_FORMANT_SHIFT,
    vocoderConsonantBoost:
      sessionDeck.vocoderConsonantBoost ?? DEFAULT_VOCODER_CONSONANT_BOOST,
    vocoderPreEmphasis:
      sessionDeck.vocoderPreEmphasis ?? DEFAULT_VOCODER_PRE_EMPHASIS,
    vocoderTightness:
      sessionDeck.vocoderTightness ?? DEFAULT_VOCODER_TIGHTNESS,
    vocoderAttackMs: sessionDeck.vocoderAttackMs ?? DEFAULT_VOCODER_ATTACK_MS,
    vocoderReleaseMs: sessionDeck.vocoderReleaseMs ?? DEFAULT_VOCODER_RELEASE_MS,
    vocoderNoiseMix: sessionDeck.vocoderNoiseMix ?? DEFAULT_VOCODER_NOISE_MIX,
    vocoderGateThreshold: sessionDeck.vocoderGateThreshold ?? DEFAULT_VOCODER_GATE_THRESHOLD,
    vocoderPostDelay: sessionDeck.vocoderPostDelay ?? DEFAULT_VOCODER_POST_DELAY,
    includeInRecordExport: sessionDeck.includeInRecordExport ?? true,
    deckWidthOverride: sessionDeck.deckWidthOverride,
    offsetSeconds,
    zoom: sessionDeck.zoom,
    loopEnabled: sessionDeck.loopEnabled,
    loopStartSeconds: loopStart,
    loopEndSeconds: loopEnd,
    loopDelaySec: sessionDeck.loopDelaySec ?? DEFAULT_LOOP_DELAY_SEC,
    tempoOffset: sessionDeck.tempoOffset,
    tempoPitchSync: sessionDeck.tempoPitchSync ?? false,
    stretchRatio: sessionDeck.stretchRatio ?? DEFAULT_STRETCH_RATIO,
    stretchWindowSize: sessionDeck.stretchWindowSize ?? DEFAULT_STRETCH_WINDOW_SIZE,
    stretchStereoWidth: sessionDeck.stretchStereoWidth ?? DEFAULT_STRETCH_STEREO_WIDTH,
    stretchPhaseRandomness:
      sessionDeck.stretchPhaseRandomness ?? DEFAULT_STRETCH_PHASE_RANDOMNESS,
    stretchTiltDb: sessionDeck.stretchTiltDb ?? DEFAULT_STRETCH_TILT_DB,
    stretchScatter: sessionDeck.stretchScatter ?? DEFAULT_STRETCH_SCATTER,
    delayTime: sessionDeck.delayTime ?? DEFAULT_DELAY_TIME,
    delayFeedback: sessionDeck.delayFeedback ?? DEFAULT_DELAY_FEEDBACK,
    delayMix: sessionDeck.delayMix ?? DEFAULT_DELAY_MIX,
    delayTone: sessionDeck.delayTone ?? DEFAULT_DELAY_TONE,
    delayPingPong: sessionDeck.delayPingPong ?? DEFAULT_DELAY_PINGPONG,
    delaySliceSync: sessionDeck.delaySliceSync ?? DEFAULT_DELAY_SLICE_SYNC,
    delaySaturation: sessionDeck.delaySaturation ?? DEFAULT_DELAY_SATURATION,
    delayDamping: sessionDeck.delayDamping ?? DEFAULT_DELAY_DAMPING,
    delaySafety: sessionDeck.delaySafety ?? DEFAULT_DELAY_SAFETY,
    delayRhythmMorph: sessionDeck.delayRhythmMorph ?? DEFAULT_DELAY_RHYTHM_MORPH,
    delayRhythmRateHz: sessionDeck.delayRhythmRateHz ?? DEFAULT_DELAY_RHYTHM_RATE_HZ,
    delayRhythmSwing: sessionDeck.delayRhythmSwing ?? DEFAULT_DELAY_RHYTHM_SWING,
    delayDuckDepth: sessionDeck.delayDuckDepth ?? DEFAULT_DELAY_DUCK_DEPTH,
    delayDuckThreshold: sessionDeck.delayDuckThreshold ?? DEFAULT_DELAY_DUCK_THRESHOLD,
    delayDuckResponseMs: sessionDeck.delayDuckResponseMs ?? DEFAULT_DELAY_DUCK_RESPONSE_MS,
    delaySpectralMix: sessionDeck.delaySpectralMix ?? DEFAULT_DELAY_SPECTRAL_MIX,
    delaySpectralSpread: sessionDeck.delaySpectralSpread ?? DEFAULT_DELAY_SPECTRAL_SPREAD,
    delaySpectralMotion: sessionDeck.delaySpectralMotion ?? DEFAULT_DELAY_SPECTRAL_MOTION,
    spectralSpaceMix: sessionDeck.spectralSpaceMix ?? DEFAULT_SPECTRAL_SPACE_MIX,
    spectralSpaceSpread: sessionDeck.spectralSpaceSpread ?? DEFAULT_SPECTRAL_SPACE_SPREAD,
    spectralSpaceMotion: sessionDeck.spectralSpaceMotion ?? DEFAULT_SPECTRAL_SPACE_MOTION,
    spectralSpaceTilt: sessionDeck.spectralSpaceTilt ?? DEFAULT_SPECTRAL_SPACE_TILT,
    spectralSpaceLowMono: sessionDeck.spectralSpaceLowMono ?? DEFAULT_SPECTRAL_SPACE_LOW_MONO,
    spectralSpaceTransientProtect:
      sessionDeck.spectralSpaceTransientProtect ?? DEFAULT_SPECTRAL_SPACE_TRANSIENT_PROTECT,
    rearrangerSlices: sessionDeck.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES,
    rearrangerSwapCount: sessionDeck.rearrangerSwapCount ?? DEFAULT_REARRANGER_SWAP_COUNT,
    rearrangerChaos: sessionDeck.rearrangerChaos ?? DEFAULT_REARRANGER_CHAOS,
    rearrangerReverse: sessionDeck.rearrangerReverse ?? DEFAULT_REARRANGER_REVERSE,
    rearrangerSensitivity:
      sessionDeck.rearrangerSensitivity ?? DEFAULT_REARRANGER_SENSITIVITY,
    rearrangerQuietThreshold:
      sessionDeck.rearrangerQuietThreshold ?? DEFAULT_REARRANGER_QUIET_THRESHOLD,
    rearrangerSliceFadeMs:
      sessionDeck.rearrangerSliceFadeMs ?? DEFAULT_REARRANGER_SLICE_FADE_MS,
    rearrangerSliceDelaySec:
      sessionDeck.rearrangerSliceDelaySec ?? DEFAULT_REARRANGER_SLICE_DELAY_SEC,
    rearrangerPingPong: sessionDeck.rearrangerPingPong ?? DEFAULT_REARRANGER_PINGPONG,
    rearrangerAuto: sessionDeck.rearrangerAuto ?? DEFAULT_REARRANGER_AUTO,
    rearrangerRegions: sanitizeRearrangerRegions(sessionDeck.rearrangerRegions),
    rearrangerRegionIds:
      sessionDeck.rearrangerRegionIds ??
      Array.from(
        { length: Math.max(0, sessionDeck.rearrangerSlices ?? DEFAULT_REARRANGER_SLICES) },
        (_, index) => index
      ),
    rearrangerRegionsManual: sessionDeck.rearrangerRegionsManual ?? false,
    fxPanelOpen: withDefaultFxPanelOpen(sessionDeck.fxPanelOpen),
    startedAtMs: undefined,
  };

  return {
    deck,
    automation,
    automationView: {
      gain: toAutomationView(automation.gain),
      djFilter: toAutomationView(automation.djFilter),
      resonance: toAutomationView(automation.resonance),
      balance: toAutomationView(automation.balance),
      pitch: toAutomationView(automation.pitch),
    },
  };
};
