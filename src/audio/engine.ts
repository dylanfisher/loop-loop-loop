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
  setDeckBalanceValue,
  setDeckRearrangerPanValue,
  setDeckRearrangerPingPongAmountValue,
  setDeckRearrangerPingPongConfigValue,
  setDeckDelayTimeValue,
  setDeckDelayFeedbackValue,
  setDeckDelayMixValue,
  setDeckDelayToneValue,
  setDeckDelayPingPongValue,
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
    eqLowGain?: number,
    eqMidGain?: number,
    eqHighGain?: number,
    delayTime?: number,
    delayFeedback?: number,
    delayMix?: number,
    delayTone?: number,
    delayPingPong?: boolean,
    balance?: number,
    pitchShift?: number
  ) => Promise<void>;
  stop: (deckId: number) => void;
  setDeckGain: (deckId: number, value: number) => void;
  setDeckFilter: (deckId: number, value: number) => void;
  setDeckHighpass: (deckId: number, value: number) => void;
  setDeckResonance: (deckId: number, value: number) => void;
  setDeckEqLow: (deckId: number, value: number) => void;
  setDeckEqMid: (deckId: number, value: number) => void;
  setDeckEqHigh: (deckId: number, value: number) => void;
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
  setDeckPitchShift: (deckId: number, value: number) => void;
  setMasterGain: (value: number) => void;
  removeDeck: (deckId: number) => void;
  getDeckPosition: (deckId: number) => number | null;
  setDeckLoopParams: (deckId: number, loopEnabled: boolean, start: number, end: number) => void;
  setDeckPlaybackRate: (deckId: number, value: number) => void;
  setDeckPlaybackOffset: (deckId: number, offsetSeconds: number) => void;
  getMasterStream: () => MediaStream | null;
  getDeckPlaybackSnapshot: (deckId: number) => import("./deck").DeckPlaybackSnapshot | null;
  getAudioContextState: () => AudioContextState | "uninitialized";
  getCurrentTime: () => number | null;
  suspendContext: () => Promise<void>;
  resumeContext: () => Promise<void>;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterStreamDest: MediaStreamAudioDestinationNode | null = null;
let masterGainValue = 0.9;

const ensureContextSync = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterGainValue;
    masterGain.connect(audioContext.destination);
    masterStreamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(masterStreamDest);
  }
  return audioContext;
};

const ensureContext = async () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterGainValue;
    masterGain.connect(audioContext.destination);
    masterStreamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(masterStreamDest);
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

const playBuffer = async (
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
  eqLowGain = 0,
  eqMidGain = 0,
  eqHighGain = 0,
  delayTime = 0.35,
  delayFeedback = 0.35,
  delayMix = 0,
  delayTone = 6000,
  delayPingPong = false,
  balance = 0,
  pitchShift = 0
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
  playDeckBuffer(
    context,
    output,
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
    eqLowGain,
    eqMidGain,
    eqHighGain,
    delayTime,
    delayFeedback,
    delayMix,
    delayTone,
    delayPingPong,
    balance,
    pitchShift,
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

const setDeckPitchShift = (deckId: number, value: number) => {
  setDeckPitchShiftValue(deckId, value);
};

const setMasterGain = (value: number) => {
  const nextValue = Math.min(Math.max(value, 0), 1.5);
  masterGainValue = nextValue;
  if (masterGain) {
    masterGain.gain.value = nextValue;
  }
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
    setDeckPitchShift,
    setMasterGain,
    removeDeck,
    getDeckPosition,
    setDeckLoopParams: updateDeckLoopParams,
    setDeckPlaybackRate: updateDeckPlaybackRate,
    setDeckPlaybackOffset: updateDeckPlaybackOffset,
    getMasterStream,
    getDeckPlaybackSnapshot: getDeckSnapshot,
    getAudioContextState,
    getCurrentTime,
    suspendContext,
    resumeContext,
  };
};
