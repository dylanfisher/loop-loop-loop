type DeckEndedCallback = () => void;

type DeckNodes = {
  gain: GainNode;
  source?: AudioBufferSourceNode;
};

const deckNodes = new Map<number, DeckNodes>();
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
  onEnded?: DeckEndedCallback
) => {
  stopDeckPlayback(deckId, true);
  const nodes = ensureDeckNodes(context, output, deckId, gain);

  const source = context.createBufferSource();
  source.buffer = buffer;
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
  source.start(0, clampedOffset);
};

export const stopDeckPlayback = (deckId: number, suppressEnded = true) => {
  const nodes = deckNodes.get(deckId);
  if (nodes?.source) {
    if (suppressEnded) {
      nodes.source.onended = null;
    }
    nodes.source.stop();
    nodes.source.disconnect();
    nodes.source = undefined;
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
  pendingGains.delete(deckId);
};
