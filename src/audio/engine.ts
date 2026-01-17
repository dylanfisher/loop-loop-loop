type DeckEndedCallback = () => void;

type AudioEngine = {
  decodeFile: (file: File) => Promise<AudioBuffer>;
  playBuffer: (
    deckId: number,
    buffer: AudioBuffer,
    onEnded?: DeckEndedCallback,
    gain?: number
  ) => Promise<void>;
  stop: (deckId: number) => void;
  setDeckGain: (deckId: number, value: number) => void;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
const sources = new Map<number, AudioBufferSourceNode>();
const deckGains = new Map<number, GainNode>();
const pendingGains = new Map<number, number>();

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
  gain = 0.9
) => {
  const context = await ensureContext();
  stop(deckId);

  let deckGain = deckGains.get(deckId);
  if (!deckGain) {
    deckGain = context.createGain();
    deckGain.gain.value = pendingGains.get(deckId) ?? gain;
    deckGain.connect(masterGain ?? context.destination);
    deckGains.set(deckId, deckGain);
  } else {
    deckGain.gain.value = gain;
  }
  pendingGains.delete(deckId);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(deckGain);
  source.onended = () => {
    sources.delete(deckId);
    onEnded?.();
  };
  sources.set(deckId, source);
  source.start();
};

const stop = (deckId: number) => {
  const source = sources.get(deckId);
  if (source) {
    source.stop();
    source.disconnect();
    sources.delete(deckId);
  }
};

const setDeckGain = (deckId: number, value: number) => {
  const gain = deckGains.get(deckId);
  if (gain) {
    gain.gain.value = value;
    pendingGains.delete(deckId);
  } else {
    pendingGains.set(deckId, value);
  }
};

export const getAudioEngine = (): AudioEngine => {
  return { decodeFile, playBuffer, stop, setDeckGain };
};
