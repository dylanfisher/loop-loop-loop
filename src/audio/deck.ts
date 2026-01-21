type DeckEndedCallback = () => void;

type DeckNodes = {
  gain: GainNode;
  source?: AudioBufferSourceNode;
};

type DeckPlaybackState = {
  startTime: number;
  offsetSeconds: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  duration: number;
  playing: boolean;
};

const deckNodes = new Map<number, DeckNodes>();
const deckPlayback = new Map<number, DeckPlaybackState>();
const pendingGains = new Map<number, number>();

const ensureDeckNodes = (
  context: AudioContext,
  output: AudioNode,
  deckId: number,
  gain: number
) => {
  let nodes = deckNodes.get(deckId);
  if (!nodes) {
    const deckGain = context.createGain();
    deckGain.gain.value = pendingGains.get(deckId) ?? gain;
    deckGain.connect(output);
    nodes = { gain: deckGain };
    deckNodes.set(deckId, nodes);
  } else {
    nodes.gain.gain.value = gain;
  }

  pendingGains.delete(deckId);
  return nodes;
};

export const playDeckBuffer = (
  context: AudioContext,
  output: AudioNode,
  deckId: number,
  buffer: AudioBuffer,
  gain: number,
  offsetSeconds: number,
  loopEnabled: boolean,
  loopStartSeconds: number,
  loopEndSeconds: number,
  onEnded?: DeckEndedCallback
) => {
  stopDeckPlayback(deckId, true);
  const nodes = ensureDeckNodes(context, output, deckId, gain);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = loopEnabled;
  if (loopEnabled) {
    const safeStart = Math.max(0, loopStartSeconds);
    const safeEnd =
      loopEndSeconds > safeStart + 0.01 ? loopEndSeconds : buffer.duration;
    source.loopStart = safeStart;
    source.loopEnd = Math.min(safeEnd, buffer.duration);
  }
  source.connect(nodes.gain);
  source.onended = () => {
    if (nodes.source === source) {
      nodes.source = undefined;
    }
    onEnded?.();
  };
  nodes.source = source;
  const clampedOffset = Math.min(
    Math.max(0, offsetSeconds),
    Math.max(0, buffer.duration - 0.01)
  );
  deckPlayback.set(deckId, {
    startTime: context.currentTime,
    offsetSeconds: clampedOffset,
    loopEnabled,
    loopStart: loopStartSeconds,
    loopEnd: loopEndSeconds,
    duration: buffer.duration,
    playing: true,
  });
  source.start(0, clampedOffset);
};

export const stopDeckPlayback = (
  deckId: number,
  suppressEnded = true,
  currentTime?: number
) => {
  const nodes = deckNodes.get(deckId);
  if (nodes?.source) {
    if (suppressEnded) {
      nodes.source.onended = null;
    }
    nodes.source.stop();
    nodes.source.disconnect();
    nodes.source = undefined;
  }

  const playback = deckPlayback.get(deckId);
  if (playback && playback.playing && currentTime !== undefined) {
    const elapsed = Math.max(0, currentTime - playback.startTime);
    const nextOffset = Math.min(playback.offsetSeconds + elapsed, playback.duration);
    deckPlayback.set(deckId, { ...playback, offsetSeconds: nextOffset, playing: false });
  }
};

export const setDeckGainValue = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.gain.gain.value = value;
    pendingGains.delete(deckId);
  } else {
    pendingGains.set(deckId, value);
  }
};

export const removeDeckNodes = (deckId: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    if (nodes.source) {
      nodes.source.onended = null;
    }
    nodes.source?.stop();
    nodes.source?.disconnect();
    nodes.gain.disconnect();
    deckNodes.delete(deckId);
  }
  deckPlayback.delete(deckId);
  pendingGains.delete(deckId);
};

export const getDeckPlaybackPosition = (deckId: number, currentTime: number) => {
  const playback = deckPlayback.get(deckId);
  if (!playback) return null;

  const elapsed = playback.playing ? Math.max(0, currentTime - playback.startTime) : 0;
  let position = Math.min(playback.offsetSeconds + elapsed, playback.duration);

  if (playback.loopEnabled && playback.loopEnd > playback.loopStart) {
    const loopDuration = playback.loopEnd - playback.loopStart;
    const loopOffset = position - playback.loopStart;
    const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
    position = playback.loopStart + wrapped;
  }

  return position;
};
