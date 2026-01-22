import {
  getDeckPlaybackPosition,
  playDeckBuffer,
  removeDeckNodes,
  setDeckGainValue,
  setDeckLoopParams,
  setDeckPlaybackRate,
  setDeckTempoRatio,
  stopDeckPlayback,
  setTimeStretchWasmBytes,
} from "./deck";
import wasmUrl from "rubberband-wasm/dist/rubberband.wasm?url";

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
    preservePitch?: boolean,
    tempoRatio?: number
  ) => Promise<void>;
  stop: (deckId: number) => void;
  setDeckGain: (deckId: number, value: number) => void;
  removeDeck: (deckId: number) => void;
  getDeckPosition: (deckId: number) => number | null;
  setDeckLoopParams: (deckId: number, loopEnabled: boolean, start: number, end: number) => void;
  setDeckPlaybackRate: (deckId: number, value: number) => void;
  setDeckTempoRatio: (deckId: number, value: number) => void;
  ensureTimeStretchWorklet: () => Promise<void>;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let timeStretchWorkletPromise: Promise<void> | null = null;
let timeStretchWasmPromise: Promise<ArrayBuffer> | null = null;

const ensureContextSync = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
};

const ensureContext = async () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioContext.destination);
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

const ensureTimeStretchWorklet = async () => {
  const context = await ensureContext();
  if (!timeStretchWorkletPromise) {
    timeStretchWorkletPromise = context.audioWorklet.addModule(
      new URL("./worklets/timeStretchProcessor.ts", import.meta.url)
    );
  }
  if (!timeStretchWasmPromise) {
    timeStretchWasmPromise = fetch(wasmUrl).then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load Rubber Band wasm");
      }
      return response.arrayBuffer();
    });
  }
  const wasmBytes = await timeStretchWasmPromise;
  setTimeStretchWasmBytes(wasmBytes);
  await timeStretchWorkletPromise;
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
  preservePitch = false,
  tempoRatio = 1
) => {
  const context = await ensureContext();
  if (preservePitch) {
    await ensureTimeStretchWorklet();
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
    preservePitch,
    tempoRatio,
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

const removeDeck = (deckId: number) => {
  removeDeckNodes(deckId);
};

const getDeckPosition = (deckId: number) => {
  if (!audioContext) return null;
  return getDeckPlaybackPosition(deckId, audioContext.currentTime);
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

const updateDeckTempoRatio = (deckId: number, value: number) => {
  if (!audioContext) {
    setDeckTempoRatio(deckId, value);
    return;
  }
  setDeckTempoRatio(deckId, value, audioContext.currentTime);
};

export const getAudioEngine = (): AudioEngine => {
  return {
    decodeFile,
    createBuffer,
    playBuffer,
    stop,
    setDeckGain,
    removeDeck,
    getDeckPosition,
    setDeckLoopParams: updateDeckLoopParams,
    setDeckPlaybackRate: updateDeckPlaybackRate,
    setDeckTempoRatio: updateDeckTempoRatio,
    ensureTimeStretchWorklet,
  };
};
