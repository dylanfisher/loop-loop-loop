import {
  clearDeckRearrangerPanAutomation,
  getDeckPlaybackPosition,
  getDeckPlaybackSnapshot,
  hasDeckPlayback,
  playDeckBuffer,
  removeDeckNodes,
  scheduleDeckRearrangerPanValue,
  setDeckGainValue,
  setDeckFilterValue,
  setDeckHighpassValue,
  setDeckResonanceValue,
  setDeckEqLowGain,
  setDeckEqMidGain,
  setDeckEqHighGain,
  setDeckEqModeValue,
  setDeckParametricEqBandsValue,
  setDeckBalanceValue,
  setDeckRearrangerPanValue,
  setDeckRearrangerPingPongAmountValue,
  setDeckRearrangerPingPongConfigValue,
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
  setDeckRecordExportSendValue,
  setDeckLoopParams,
  setDeckPlaybackOffsetValue,
  setDeckPitchShiftValue,
  setDeckPlaybackRate,
  stopDeckPlayback,
} from "./deck";
import { ensurePitchShiftWorklet } from "./pitchShift";
import {
  ensureRearrangerPingPongWorklet,
  type RearrangerPingPongConfig,
} from "./rearrangerPingPong";
import type { EqMode, ParametricEqBand } from "../types/deck";

type DeckEndedCallback = () => void;

type AudioEngine = {
  decodeFile: (file: File) => Promise<AudioBuffer>;
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer;
  playBuffer: (
    deckId: number,
    buffer: AudioBuffer,
    onEnded?: DeckEndedCallback,
    gain?: number,
    offsetSeconds?: number,
    playbackRate?: number,
    loopEnabled?: boolean,
    loopStartSeconds?: number,
    loopEndSeconds?: number,
    filterCutoff?: number,
    highpassCutoff?: number,
    resonance?: number,
    eqMode?: EqMode,
    eqLowGain?: number,
    eqMidGain?: number,
    eqHighGain?: number,
    parametricEqBands?: ParametricEqBand[],
    delayTime?: number,
    delayFeedback?: number,
    delayMix?: number,
    delayTone?: number,
    delayPingPong?: boolean,
    delaySaturation?: number,
    delayDamping?: number,
    delaySafety?: number,
    delayRhythmMorph?: number,
    delayRhythmRateHz?: number,
    delayRhythmSwing?: number,
    delayDuckDepth?: number,
    delayDuckThreshold?: number,
    delayDuckResponseMs?: number,
    delaySpectralMix?: number,
    delaySpectralSpread?: number,
    delaySpectralMotion?: number,
    spectralSpaceMix?: number,
    spectralSpaceSpread?: number,
    spectralSpaceMotion?: number,
    spectralSpaceTilt?: number,
    spectralSpaceLowMono?: number,
    spectralSpaceTransientProtect?: number,
    vocoderMix?: number,
    vocoderCarrierDeckId?: number | null,
    vocoderModulatorMonitor?: number,
    vocoderModDrive?: number,
    vocoderBandCount?: number,
    vocoderBandSpread?: number,
    vocoderVocalCharacter?: number,
    vocoderFormantShift?: number,
    vocoderConsonantBoost?: number,
    vocoderPreEmphasis?: number,
    vocoderTightness?: number,
    vocoderAttackMs?: number,
    vocoderReleaseMs?: number,
    vocoderNoiseMix?: number,
    vocoderGateThreshold?: number,
    includeInRecordExport?: boolean,
    balance?: number,
    pitchShift?: number,
    vocoderPostDelay?: boolean,
    playbackEndSeconds?: number
  ) => Promise<void>;
  stop: (deckId: number) => void;
  setDeckGain: (deckId: number, value: number) => void;
  setDeckFilter: (deckId: number, value: number) => void;
  setDeckHighpass: (deckId: number, value: number) => void;
  setDeckResonance: (deckId: number, value: number) => void;
  setDeckEqLow: (deckId: number, value: number) => void;
  setDeckEqMid: (deckId: number, value: number) => void;
  setDeckEqHigh: (deckId: number, value: number) => void;
  setDeckEqMode: (deckId: number, value: EqMode) => void;
  setDeckParametricEqBands: (deckId: number, bands: ParametricEqBand[]) => void;
  setDeckBalance: (deckId: number, value: number) => void;
  setDeckRearrangerPan: (deckId: number, value: number) => void;
  setDeckRearrangerPingPongAmount: (deckId: number, value: number) => void;
  setDeckRearrangerPingPongConfig: (
    deckId: number,
    config: RearrangerPingPongConfig | null
  ) => void;
  clearDeckRearrangerPanAutomation: (deckId: number, fromTime: number) => void;
  scheduleDeckRearrangerPan: (
    deckId: number,
    value: number,
    atTime: number,
    rampSeconds?: number
  ) => void;
  setDeckDelayTime: (deckId: number, value: number) => void;
  setDeckDelayFeedback: (deckId: number, value: number) => void;
  setDeckDelayMix: (deckId: number, value: number) => void;
  setDeckDelayTone: (deckId: number, value: number) => void;
  setDeckDelayPingPong: (deckId: number, value: boolean) => void;
  setDeckDelaySaturation: (deckId: number, value: number) => void;
  setDeckDelayDamping: (deckId: number, value: number) => void;
  setDeckDelaySafety: (deckId: number, value: number) => void;
  setDeckDelayRhythmMorph: (deckId: number, value: number) => void;
  setDeckDelayRhythmRateHz: (deckId: number, value: number) => void;
  setDeckDelayRhythmSwing: (deckId: number, value: number) => void;
  setDeckDelayDuckDepth: (deckId: number, value: number) => void;
  setDeckDelayDuckThreshold: (deckId: number, value: number) => void;
  setDeckDelayDuckResponseMs: (deckId: number, value: number) => void;
  setDeckDelaySpectralMix: (deckId: number, value: number) => void;
  setDeckDelaySpectralSpread: (deckId: number, value: number) => void;
  setDeckDelaySpectralMotion: (deckId: number, value: number) => void;
  setDeckSpectralSpaceMix: (deckId: number, value: number) => void;
  setDeckSpectralSpaceSpread: (deckId: number, value: number) => void;
  setDeckSpectralSpaceMotion: (deckId: number, value: number) => void;
  setDeckSpectralSpaceTilt: (deckId: number, value: number) => void;
  setDeckSpectralSpaceLowMono: (deckId: number, value: number) => void;
  setDeckSpectralSpaceTransientProtect: (deckId: number, value: number) => void;
  setDeckVocoderMix: (deckId: number, value: number) => void;
  setDeckVocoderCarrierDeckId: (deckId: number, value: number | null) => void;
  setDeckVocoderModulatorMonitor: (deckId: number, value: number) => void;
  setDeckVocoderModDrive: (deckId: number, value: number) => void;
  setDeckVocoderBandCount: (deckId: number, value: number) => void;
  setDeckVocoderBandSpread: (deckId: number, value: number) => void;
  setDeckVocoderVocalCharacter: (deckId: number, value: number) => void;
  setDeckVocoderFormantShift: (deckId: number, value: number) => void;
  setDeckVocoderConsonantBoost: (deckId: number, value: number) => void;
  setDeckVocoderPreEmphasis: (deckId: number, value: number) => void;
  setDeckVocoderTightness: (deckId: number, value: number) => void;
  setDeckVocoderAttackMs: (deckId: number, value: number) => void;
  setDeckVocoderReleaseMs: (deckId: number, value: number) => void;
  setDeckVocoderNoiseMix: (deckId: number, value: number) => void;
  setDeckVocoderGateThreshold: (deckId: number, value: number) => void;
  setDeckVocoderPostDelay: (deckId: number, value: boolean) => void;
  setDeckPitchShift: (deckId: number, value: number) => void;
  setDeckRecordExportSend: (deckId: number, active: boolean) => void;
  setMasterGain: (value: number) => void;
  removeDeck: (deckId: number) => void;
  getDeckPosition: (deckId: number) => number | null;
  setDeckLoopParams: (deckId: number, loopEnabled: boolean, start: number, end: number) => void;
  setDeckPlaybackRate: (deckId: number, value: number) => void;
  setDeckPlaybackOffset: (deckId: number, offsetSeconds: number) => void;
  getMasterStream: () => MediaStream | null;
  getRecordStream: () => MediaStream | null;
  getDeckPlaybackSnapshot: (deckId: number) => import("./deck").DeckPlaybackSnapshot | null;
  getAudioContextState: () => AudioContextState | "uninitialized";
  getCurrentTime: () => number | null;
  suspendContext: () => Promise<void>;
  resumeContext: () => Promise<void>;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let recordExportMix: GainNode | null = null;
let recordExportMasterGain: GainNode | null = null;
let masterStreamDest: MediaStreamAudioDestinationNode | null = null;
let recordStreamDest: MediaStreamAudioDestinationNode | null = null;
let masterGainValue = 0.9;

const ensureContextSync = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterGainValue;
    masterGain.connect(audioContext.destination);
    recordExportMix = audioContext.createGain();
    recordExportMasterGain = audioContext.createGain();
    recordExportMasterGain.gain.value = masterGainValue;
    recordExportMix.connect(recordExportMasterGain);
    masterStreamDest = audioContext.createMediaStreamDestination();
    recordStreamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(masterStreamDest);
    recordExportMasterGain.connect(recordStreamDest);
  }
  return audioContext;
};

const ensureContext = async () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterGainValue;
    masterGain.connect(audioContext.destination);
    recordExportMix = audioContext.createGain();
    recordExportMasterGain = audioContext.createGain();
    recordExportMasterGain.gain.value = masterGainValue;
    recordExportMix.connect(recordExportMasterGain);
    masterStreamDest = audioContext.createMediaStreamDestination();
    recordStreamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(masterStreamDest);
    recordExportMasterGain.connect(recordStreamDest);
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
};

const suspendContext = async () => {
  if (audioContext && audioContext.state === "running") {
    await audioContext.suspend();
  }
};

const resumeContext = async () => {
  if (!audioContext) {
    await ensureContext();
    return;
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
};


const decodeFile = async (file: File) => {
  const context = await ensureContext();
  const arrayBuffer = await file.arrayBuffer();
  return context.decodeAudioData(arrayBuffer);
};

const createBuffer = (channels: number, length: number, sampleRate: number) => {
  const context = ensureContextSync();
  return context.createBuffer(channels, length, sampleRate);
};

const playBuffer: AudioEngine["playBuffer"] = async (
  deckId: number,
  buffer: AudioBuffer,
  onEnded?: DeckEndedCallback,
  gain = 0.9,
  offsetSeconds = 0,
  playbackRate = 1,
  loopEnabled = false,
  loopStartSeconds = 0,
  loopEndSeconds = buffer.duration,
  filterCutoff = 20000,
  highpassCutoff = 60,
  resonance = 0,
  eqMode: EqMode = "eq3",
  eqLowGain = 0,
  eqMidGain = 0,
  eqHighGain = 0,
  parametricEqBands: ParametricEqBand[] = [],
  delayTime = 0.35,
  delayFeedback = 0.35,
  delayMix = 0,
  delayTone = 6000,
  delayPingPong = false,
  delaySaturation = 0,
  delayDamping = 0,
  delaySafety = 0.35,
  delayRhythmMorph = 0,
  delayRhythmRateHz = 0.35,
  delayRhythmSwing = 0.5,
  delayDuckDepth = 0,
  delayDuckThreshold = 0.2,
  delayDuckResponseMs = 80,
  delaySpectralMix = 0,
  delaySpectralSpread = 0.35,
  delaySpectralMotion = 0.2,
  spectralSpaceMix = 0,
  spectralSpaceSpread = 0.35,
  spectralSpaceMotion = 0.25,
  spectralSpaceTilt = 0,
  spectralSpaceLowMono = 0.6,
  spectralSpaceTransientProtect = 0.35,
  vocoderMix = 0,
  vocoderCarrierDeckId = null,
  vocoderModulatorMonitor = 0,
  vocoderModDrive = 2,
  vocoderBandCount = 12,
  vocoderBandSpread = 1,
  vocoderVocalCharacter = 1,
  vocoderFormantShift = 0,
  vocoderConsonantBoost = 0,
  vocoderPreEmphasis = 0.45,
  vocoderTightness = 0.35,
  vocoderAttackMs = 8,
  vocoderReleaseMs = 5,
  vocoderNoiseMix = 0,
  vocoderGateThreshold = 0.5,
  includeInRecordExport = true,
  balance = 0,
  pitchShift = 0,
  vocoderPostDelay = false,
  playbackEndSeconds
) => {
  const context = await ensureContext();
  try {
    await ensurePitchShiftWorklet(context);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Pitch shift worklet failed to load", error);
    }
  }
  try {
    await ensureRearrangerPingPongWorklet(context);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Rearranger ping pong worklet failed to load", error);
    }
  }
  const output = masterGain ?? context.destination;
  const recordOutput = recordExportMix ?? output;
  playDeckBuffer(
    context,
    output,
    recordOutput,
    deckId,
    buffer,
    gain,
    offsetSeconds,
    playbackRate,
    loopEnabled,
    loopStartSeconds,
    loopEndSeconds,
    filterCutoff,
    highpassCutoff,
    resonance,
    eqMode,
    eqLowGain,
    eqMidGain,
    eqHighGain,
    parametricEqBands,
    delayTime,
    delayFeedback,
    delayMix,
    delayTone,
    delayPingPong,
    delaySaturation,
    delayDamping,
    delaySafety,
    delayRhythmMorph,
    delayRhythmRateHz,
    delayRhythmSwing,
    delayDuckDepth,
    delayDuckThreshold,
    delayDuckResponseMs,
    delaySpectralMix,
    delaySpectralSpread,
    delaySpectralMotion,
    spectralSpaceMix,
    spectralSpaceSpread,
    spectralSpaceMotion,
    spectralSpaceTilt,
    spectralSpaceLowMono,
    spectralSpaceTransientProtect,
    vocoderMix,
    vocoderCarrierDeckId,
    vocoderModulatorMonitor,
    vocoderModDrive,
    vocoderBandCount,
    vocoderBandSpread,
    vocoderVocalCharacter,
    vocoderFormantShift,
    vocoderConsonantBoost,
    vocoderPreEmphasis,
    vocoderTightness,
    vocoderAttackMs,
    vocoderReleaseMs,
    vocoderNoiseMix,
    vocoderGateThreshold,
    includeInRecordExport,
    balance,
    pitchShift,
    vocoderPostDelay,
    playbackEndSeconds,
    onEnded
  );
};

const stop = (deckId: number) => {
  if (!audioContext) {
    stopDeckPlayback(deckId);
    return;
  }
  stopDeckPlayback(deckId, true, audioContext.currentTime);
};

const setDeckGain = (deckId: number, value: number) => {
  setDeckGainValue(deckId, value);
};

const setDeckFilter = (deckId: number, value: number) => {
  setDeckFilterValue(deckId, value);
};

const setDeckHighpass = (deckId: number, value: number) => {
  setDeckHighpassValue(deckId, value);
};

const setDeckResonance = (deckId: number, value: number) => {
  setDeckResonanceValue(deckId, value);
};

const setDeckEqLow = (deckId: number, value: number) => {
  setDeckEqLowGain(deckId, value);
};

const setDeckEqMid = (deckId: number, value: number) => {
  setDeckEqMidGain(deckId, value);
};

const setDeckEqHigh = (deckId: number, value: number) => {
  setDeckEqHighGain(deckId, value);
};

const setDeckEqMode = (deckId: number, value: EqMode) => {
  setDeckEqModeValue(deckId, value);
};

const setDeckParametricEqBands = (deckId: number, bands: ParametricEqBand[]) => {
  setDeckParametricEqBandsValue(deckId, bands);
};

const setDeckBalance = (deckId: number, value: number) => {
  setDeckBalanceValue(deckId, value);
};

const setDeckRearrangerPan = (deckId: number, value: number) => {
  setDeckRearrangerPanValue(deckId, value);
};

const setDeckRearrangerPingPongAmount = (deckId: number, value: number) => {
  setDeckRearrangerPingPongAmountValue(deckId, value);
};

const setDeckRearrangerPingPongConfig = (
  deckId: number,
  config: RearrangerPingPongConfig | null
) => {
  setDeckRearrangerPingPongConfigValue(deckId, config);
};

const clearRearrangerPanAutomation = (deckId: number, fromTime: number) => {
  clearDeckRearrangerPanAutomation(deckId, fromTime);
};

const scheduleRearrangerPan = (
  deckId: number,
  value: number,
  atTime: number,
  rampSeconds = 0
) => {
  scheduleDeckRearrangerPanValue(deckId, value, atTime, rampSeconds);
};

const setDeckDelayTime = (deckId: number, value: number) => {
  setDeckDelayTimeValue(deckId, value);
};

const setDeckDelayFeedback = (deckId: number, value: number) => {
  setDeckDelayFeedbackValue(deckId, value);
};

const setDeckDelayMix = (deckId: number, value: number) => {
  setDeckDelayMixValue(deckId, value);
};

const setDeckDelayTone = (deckId: number, value: number) => {
  setDeckDelayToneValue(deckId, value);
};

const setDeckDelayPingPong = (deckId: number, value: boolean) => {
  setDeckDelayPingPongValue(deckId, value);
};

const setDeckDelaySaturation = (deckId: number, value: number) => {
  setDeckDelaySaturationValue(deckId, value);
};

const setDeckDelayDamping = (deckId: number, value: number) => {
  setDeckDelayDampingValue(deckId, value);
};

const setDeckDelaySafety = (deckId: number, value: number) => {
  setDeckDelaySafetyValue(deckId, value);
};

const setDeckDelayRhythmMorph = (deckId: number, value: number) => {
  setDeckDelayRhythmMorphValue(deckId, value);
};

const setDeckDelayRhythmRateHz = (deckId: number, value: number) => {
  setDeckDelayRhythmRateHzValue(deckId, value);
};

const setDeckDelayRhythmSwing = (deckId: number, value: number) => {
  setDeckDelayRhythmSwingValue(deckId, value);
};

const setDeckDelayDuckDepth = (deckId: number, value: number) => {
  setDeckDelayDuckDepthValue(deckId, value);
};

const setDeckDelayDuckThreshold = (deckId: number, value: number) => {
  setDeckDelayDuckThresholdValue(deckId, value);
};

const setDeckDelayDuckResponseMs = (deckId: number, value: number) => {
  setDeckDelayDuckResponseMsValue(deckId, value);
};

const setDeckDelaySpectralMix = (deckId: number, value: number) => {
  setDeckDelaySpectralMixValue(deckId, value);
};

const setDeckDelaySpectralSpread = (deckId: number, value: number) => {
  setDeckDelaySpectralSpreadValue(deckId, value);
};

const setDeckDelaySpectralMotion = (deckId: number, value: number) => {
  setDeckDelaySpectralMotionValue(deckId, value);
};

const setDeckSpectralSpaceMix = (deckId: number, value: number) => {
  setDeckSpectralSpaceMixValue(deckId, value);
};

const setDeckSpectralSpaceSpread = (deckId: number, value: number) => {
  setDeckSpectralSpaceSpreadValue(deckId, value);
};

const setDeckSpectralSpaceMotion = (deckId: number, value: number) => {
  setDeckSpectralSpaceMotionValue(deckId, value);
};

const setDeckSpectralSpaceTilt = (deckId: number, value: number) => {
  setDeckSpectralSpaceTiltValue(deckId, value);
};

const setDeckSpectralSpaceLowMono = (deckId: number, value: number) => {
  setDeckSpectralSpaceLowMonoValue(deckId, value);
};

const setDeckSpectralSpaceTransientProtect = (deckId: number, value: number) => {
  setDeckSpectralSpaceTransientProtectValue(deckId, value);
};

const setDeckVocoderMix = (deckId: number, value: number) => {
  setDeckVocoderMixValue(deckId, value);
};

const setDeckVocoderCarrierDeckId = (deckId: number, value: number | null) => {
  setDeckVocoderCarrierDeckIdValue(deckId, value);
};

const setDeckVocoderModulatorMonitor = (deckId: number, value: number) => {
  setDeckVocoderModulatorMonitorValue(deckId, value);
};

const setDeckVocoderModDrive = (deckId: number, value: number) => {
  setDeckVocoderModDriveValue(deckId, value);
};

const setDeckVocoderBandCount = (deckId: number, value: number) => {
  setDeckVocoderBandCountValue(deckId, value);
};

const setDeckVocoderBandSpread = (deckId: number, value: number) => {
  setDeckVocoderBandSpreadValue(deckId, value);
};

const setDeckVocoderVocalCharacter = (deckId: number, value: number) => {
  setDeckVocoderVocalCharacterValue(deckId, value);
};

const setDeckVocoderFormantShift = (deckId: number, value: number) => {
  setDeckVocoderFormantShiftValue(deckId, value);
};

const setDeckVocoderConsonantBoost = (deckId: number, value: number) => {
  setDeckVocoderConsonantBoostValue(deckId, value);
};

const setDeckVocoderPreEmphasis = (deckId: number, value: number) => {
  setDeckVocoderPreEmphasisValue(deckId, value);
};

const setDeckVocoderTightness = (deckId: number, value: number) => {
  setDeckVocoderTightnessValue(deckId, value);
};

const setDeckVocoderAttackMs = (deckId: number, value: number) => {
  setDeckVocoderAttackMsValue(deckId, value);
};

const setDeckVocoderReleaseMs = (deckId: number, value: number) => {
  setDeckVocoderReleaseMsValue(deckId, value);
};

const setDeckVocoderNoiseMix = (deckId: number, value: number) => {
  setDeckVocoderNoiseMixValue(deckId, value);
};

const setDeckVocoderGateThreshold = (deckId: number, value: number) => {
  setDeckVocoderGateThresholdValue(deckId, value);
};

const setDeckVocoderPostDelay = (deckId: number, value: boolean) => {
  setDeckVocoderPostDelayValue(deckId, value);
};

const setDeckPitchShift = (deckId: number, value: number) => {
  setDeckPitchShiftValue(deckId, value);
};

const setMasterGain = (value: number) => {
  const nextValue = Math.min(Math.max(value, 0), 1.5);
  masterGainValue = nextValue;
  if (masterGain) {
    masterGain.gain.value = nextValue;
  }
  if (recordExportMasterGain) {
    recordExportMasterGain.gain.value = nextValue;
  }
};

const setDeckRecordExportSend = (deckId: number, active: boolean) => {
  setDeckRecordExportSendValue(deckId, active);
};

const removeDeck = (deckId: number) => {
  removeDeckNodes(deckId);
};

const getDeckPosition = (deckId: number) => {
  if (!audioContext) return null;
  return getDeckPlaybackPosition(deckId, audioContext.currentTime);
};

const getDeckSnapshot = (deckId: number) => {
  if (!audioContext) return null;
  const snapshot = getDeckPlaybackSnapshot(deckId, audioContext.currentTime);
  if (!snapshot && import.meta.env.DEV && hasDeckPlayback(deckId)) {
    console.info("Audio snapshot missing", {
      deckId,
      hasPlayback: true,
      contextState: audioContext.state,
    });
  }
  return snapshot;
};


const updateDeckLoopParams = (deckId: number, loopEnabled: boolean, start: number, end: number) => {
  setDeckLoopParams(deckId, loopEnabled, start, end);
};

const updateDeckPlaybackRate = (deckId: number, value: number) => {
  if (!audioContext) {
    setDeckPlaybackRate(deckId, value);
    return;
  }
  setDeckPlaybackRate(deckId, value, audioContext.currentTime);
};

const updateDeckPlaybackOffset = (deckId: number, offsetSeconds: number) => {
  if (!audioContext) {
    setDeckPlaybackOffsetValue(deckId, offsetSeconds);
    return;
  }
  setDeckPlaybackOffsetValue(deckId, offsetSeconds, audioContext.currentTime);
};

const getMasterStream = () => {
  const context = ensureContextSync();
  if (!masterStreamDest) {
    masterStreamDest = context.createMediaStreamDestination();
    masterGain?.connect(masterStreamDest);
  }
  return masterStreamDest?.stream ?? null;
};

const getRecordStream = () => {
  const context = ensureContextSync();
  if (!recordStreamDest) {
    recordStreamDest = context.createMediaStreamDestination();
    recordExportMasterGain?.connect(recordStreamDest);
  }
  return recordStreamDest?.stream ?? null;
};

const getAudioContextState = (): AudioContextState | "uninitialized" => {
  if (!audioContext) return "uninitialized";
  return audioContext.state;
};

const getCurrentTime = () => {
  if (!audioContext) return null;
  return audioContext.currentTime;
};

export const getAudioEngine = (): AudioEngine => {
  return {
    decodeFile,
    createBuffer,
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
    clearDeckRearrangerPanAutomation: clearRearrangerPanAutomation,
    scheduleDeckRearrangerPan: scheduleRearrangerPan,
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
    setDeckPitchShift,
    setDeckRecordExportSend,
    setMasterGain,
    removeDeck,
    getDeckPosition,
    setDeckLoopParams: updateDeckLoopParams,
    setDeckPlaybackRate: updateDeckPlaybackRate,
    setDeckPlaybackOffset: updateDeckPlaybackOffset,
    getMasterStream,
    getRecordStream,
    getDeckPlaybackSnapshot: getDeckSnapshot,
    getAudioContextState,
    getCurrentTime,
    suspendContext,
    resumeContext,
  };
};
