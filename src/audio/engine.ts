import {
  getDeckPlaybackPosition,
  getDeckPlaybackSnapshot,
  hasDeckPlayback,
  playDeckBuffer,
  removeDeckNodes,
  setDeckGainValue,
  setDeckFilterValue,
  setDeckHighpassValue,
  setDeckResonanceValue,
  setDeckEqLowGain,
  setDeckEqMidGain,
  setDeckEqHighGain,
  setDeckBalanceValue,
  setDeckLoopParams,
  setDeckPitchShiftValue,
  setDeckPlaybackRate,
  stopDeckPlayback,
} from "./deck";
import { ensurePitchShiftWorklet } from "./pitchShift";

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
  setDeckPitchShift: (deckId: number, value: number) => void;
  removeDeck: (deckId: number) => void;
  getDeckPosition: (deckId: number) => number | null;
  setDeckLoopParams: (deckId: number, loopEnabled: boolean, start: number, end: number) => void;
  setDeckPlaybackRate: (deckId: number, value: number) => void;
  getMasterStream: () => MediaStream | null;
  getDeckPlaybackSnapshot: (deckId: number) => import("./deck").DeckPlaybackSnapshot | null;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterStreamDest: MediaStreamAudioDestinationNode | null = null;

const ensureContextSync = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.9;
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
    masterGain.gain.value = 0.9;
    masterGain.connect(audioContext.destination);
    masterStreamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(masterStreamDest);
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
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
  resonance = 0.7,
  eqLowGain = 0,
  eqMidGain = 0,
  eqHighGain = 0,
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

const setDeckPitchShift = (deckId: number, value: number) => {
  setDeckPitchShiftValue(deckId, value);
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
  if (!snapshot && import.meta.env.DEV) {
    console.info("Audio snapshot missing", {
      deckId,
      hasPlayback: hasDeckPlayback(deckId),
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

const getMasterStream = () => {
  const context = ensureContextSync();
  if (!masterStreamDest) {
    masterStreamDest = context.createMediaStreamDestination();
    masterGain?.connect(masterStreamDest);
  }
  return masterStreamDest?.stream ?? null;
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
    setDeckPitchShift,
    removeDeck,
    getDeckPosition,
    setDeckLoopParams: updateDeckLoopParams,
    setDeckPlaybackRate: updateDeckPlaybackRate,
    getMasterStream,
    getDeckPlaybackSnapshot: getDeckSnapshot,
  };
};
