import {
  getDeckPlaybackPosition,
  playDeckBuffer,
  removeDeckNodes,
  setDeckGainValue,
  setDeckLoopParams,
  stopDeckPlayback,
} from "./deck";

type DeckEndedCallback = () => void;

type AudioEngine = {
  decodeFile: (file: File) => Promise<AudioBuffer>;
  playBuffer: (
    deckId: number,
    buffer: AudioBuffer,
    onEnded?: DeckEndedCallback,
    gain?: number,
    offsetSeconds?: number,
    loopEnabled?: boolean,
    loopStartSeconds?: number,
    loopEndSeconds?: number
  ) => Promise<void>;
  stop: (deckId: number) => void;
  setDeckGain: (deckId: number, value: number) => void;
  removeDeck: (deckId: number) => void;
  getDeckPosition: (deckId: number) => number | null;
  setDeckLoopParams: (deckId: number, loopEnabled: boolean, start: number, end: number) => void;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

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

const playBuffer = async (
  deckId: number,
  buffer: AudioBuffer,
  onEnded?: DeckEndedCallback,
  gain = 0.9,
  offsetSeconds = 0,
  loopEnabled = false,
  loopStartSeconds = 0,
  loopEndSeconds = buffer.duration
) => {
  const context = await ensureContext();
  const output = masterGain ?? context.destination;
  playDeckBuffer(
    context,
    output,
    deckId,
    buffer,
    gain,
    offsetSeconds,
    loopEnabled,
    loopStartSeconds,
    loopEndSeconds,
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

export const getAudioEngine = (): AudioEngine => {
  return {
    decodeFile,
    playBuffer,
    stop,
    setDeckGain,
    removeDeck,
    getDeckPosition,
    setDeckLoopParams: updateDeckLoopParams,
  };
};
