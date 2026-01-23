type DeckEndedCallback = () => void;

type DeckNodes = {
  gain: GainNode;
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  source?: AudioBufferSourceNode;
};

type DeckPlaybackState = {
  startTime: number;
  offsetSeconds: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  duration: number;
  playbackRate: number;
  playing: boolean;
};

const deckNodes = new Map<number, DeckNodes>();
const deckPlayback = new Map<number, DeckPlaybackState>();
const pendingGains = new Map<number, number>();
const pendingPlaybackRates = new Map<number, number>();
const pendingFilters = new Map<number, number>();
const pendingHighpass = new Map<number, number>();
const pendingResonance = new Map<number, number>();
const pendingEqLow = new Map<number, number>();
const pendingEqMid = new Map<number, number>();
const pendingEqHigh = new Map<number, number>();

const ensureDeckNodes = (
  context: AudioContext,
  output: AudioNode,
  deckId: number,
  gain: number,
  filterCutoff: number,
  highpassCutoff: number,
  resonance: number,
  eqLowGain: number,
  eqMidGain: number,
  eqHighGain: number
) => {
  let nodes = deckNodes.get(deckId);
  if (!nodes) {
    const deckHighpass = context.createBiquadFilter();
    deckHighpass.type = "highpass";
    deckHighpass.frequency.value = pendingHighpass.get(deckId) ?? highpassCutoff;
    deckHighpass.Q.value = pendingResonance.get(deckId) ?? resonance;
    const deckLowpass = context.createBiquadFilter();
    deckLowpass.type = "lowpass";
    deckLowpass.frequency.value = pendingFilters.get(deckId) ?? filterCutoff;
    deckLowpass.Q.value = pendingResonance.get(deckId) ?? resonance;
    const eqLow = context.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.value = 120;
    eqLow.gain.value = pendingEqLow.get(deckId) ?? eqLowGain;
    const eqMid = context.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1000;
    eqMid.gain.value = pendingEqMid.get(deckId) ?? eqMidGain;
    const eqHigh = context.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.value = 8000;
    eqHigh.gain.value = pendingEqHigh.get(deckId) ?? eqHighGain;
    const deckGain = context.createGain();
    deckGain.gain.value = pendingGains.get(deckId) ?? gain;
    deckHighpass.connect(deckLowpass);
    deckLowpass.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(deckGain);
    deckGain.connect(output);
    nodes = { gain: deckGain, lowpass: deckLowpass, highpass: deckHighpass, eqLow, eqMid, eqHigh };
    deckNodes.set(deckId, nodes);
  } else {
    nodes.gain.gain.value = gain;
    nodes.lowpass.frequency.value = filterCutoff;
    nodes.highpass.frequency.value = highpassCutoff;
    nodes.lowpass.Q.value = resonance;
    nodes.highpass.Q.value = resonance;
    nodes.eqLow.gain.value = eqLowGain;
    nodes.eqMid.gain.value = eqMidGain;
    nodes.eqHigh.gain.value = eqHighGain;
  }

  pendingGains.delete(deckId);
  pendingFilters.delete(deckId);
  pendingHighpass.delete(deckId);
  pendingResonance.delete(deckId);
  pendingEqLow.delete(deckId);
  pendingEqMid.delete(deckId);
  pendingEqHigh.delete(deckId);
  return nodes;
};

export const playDeckBuffer = (
  context: AudioContext,
  output: AudioNode,
  deckId: number,
  buffer: AudioBuffer,
  gain: number,
  offsetSeconds: number,
  playbackRate: number,
  loopEnabled: boolean,
  loopStartSeconds: number,
  loopEndSeconds: number,
  filterCutoff: number,
  highpassCutoff: number,
  resonance: number,
  eqLowGain: number,
  eqMidGain: number,
  eqHighGain: number,
  onEnded?: DeckEndedCallback
) => {
  stopDeckPlayback(deckId, true);
  const nodes = ensureDeckNodes(
    context,
    output,
    deckId,
    gain,
    filterCutoff,
    highpassCutoff,
    resonance,
    eqLowGain,
    eqMidGain,
    eqHighGain
  );

  const source = context.createBufferSource();
  source.buffer = buffer;
  const nextRate = pendingPlaybackRates.get(deckId) ?? playbackRate;
  source.playbackRate.value = nextRate;
  pendingPlaybackRates.delete(deckId);
  source.loop = loopEnabled;
  if (loopEnabled) {
    const safeStart = Math.max(0, loopStartSeconds);
    const safeEnd =
      loopEndSeconds > safeStart + 0.01 ? loopEndSeconds : buffer.duration;
    source.loopStart = safeStart;
    source.loopEnd = Math.min(safeEnd, buffer.duration);
  }
  source.connect(nodes.highpass);
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
    playbackRate: nextRate,
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
    const nextOffset = Math.min(
      playback.offsetSeconds + elapsed * playback.playbackRate,
      playback.duration
    );
    deckPlayback.set(deckId, {
      ...playback,
      offsetSeconds: nextOffset,
      playing: false,
    });
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

export const setDeckFilterValue = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.lowpass.frequency.value = value;
    pendingFilters.delete(deckId);
  } else {
    pendingFilters.set(deckId, value);
  }
};

export const setDeckHighpassValue = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.highpass.frequency.value = value;
    pendingHighpass.delete(deckId);
  } else {
    pendingHighpass.set(deckId, value);
  }
};

export const setDeckResonanceValue = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.lowpass.Q.value = value;
    nodes.highpass.Q.value = value;
    pendingResonance.delete(deckId);
  } else {
    pendingResonance.set(deckId, value);
  }
};

export const setDeckEqLowGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.eqLow.gain.value = value;
    pendingEqLow.delete(deckId);
  } else {
    pendingEqLow.set(deckId, value);
  }
};

export const setDeckEqMidGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.eqMid.gain.value = value;
    pendingEqMid.delete(deckId);
  } else {
    pendingEqMid.set(deckId, value);
  }
};

export const setDeckEqHighGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.eqHigh.gain.value = value;
    pendingEqHigh.delete(deckId);
  } else {
    pendingEqHigh.set(deckId, value);
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
    nodes.highpass.disconnect();
    nodes.lowpass.disconnect();
    nodes.eqLow.disconnect();
    nodes.eqMid.disconnect();
    nodes.eqHigh.disconnect();
    nodes.gain.disconnect();
    deckNodes.delete(deckId);
  }
  deckPlayback.delete(deckId);
  pendingGains.delete(deckId);
  pendingPlaybackRates.delete(deckId);
  pendingFilters.delete(deckId);
  pendingHighpass.delete(deckId);
  pendingResonance.delete(deckId);
  pendingEqLow.delete(deckId);
  pendingEqMid.delete(deckId);
  pendingEqHigh.delete(deckId);
};

export const setDeckLoopParams = (
  deckId: number,
  loopEnabled: boolean,
  loopStart: number,
  loopEnd: number
) => {
  const nodes = deckNodes.get(deckId);
  if (nodes?.source) {
    nodes.source.loop = loopEnabled;
    if (loopEnabled) {
      const safeStart = Math.max(0, loopStart);
      const safeEnd = loopEnd > safeStart + 0.01 ? loopEnd : safeStart + 0.01;
      nodes.source.loopStart = safeStart;
      nodes.source.loopEnd = safeEnd;
    }
  }

  const playback = deckPlayback.get(deckId);
  if (playback) {
    deckPlayback.set(deckId, {
      ...playback,
      loopEnabled,
      loopStart,
      loopEnd,
    });
  }
};

export const getDeckPlaybackPosition = (deckId: number, currentTime: number) => {
  const playback = deckPlayback.get(deckId);
  if (!playback) return null;

  const elapsed = playback.playing ? Math.max(0, currentTime - playback.startTime) : 0;
  let position = Math.min(
    playback.offsetSeconds + elapsed * playback.playbackRate,
    playback.duration
  );

  if (playback.loopEnabled && playback.loopEnd > playback.loopStart) {
    const loopDuration = playback.loopEnd - playback.loopStart;
    const loopOffset = position - playback.loopStart;
    const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
    position = playback.loopStart + wrapped;
  }

  return position;
};

export const setDeckPlaybackRate = (
  deckId: number,
  playbackRate: number,
  currentTime?: number
) => {
  const nodes = deckNodes.get(deckId);
  const clampedRate = Math.min(Math.max(playbackRate, 0.01), 16);

  const playback = deckPlayback.get(deckId);
  if (nodes?.source) {
    nodes.source.playbackRate.value = clampedRate;
  } else {
    pendingPlaybackRates.set(deckId, clampedRate);
  }

  if (playback && currentTime !== undefined) {
    const elapsed = playback.playing ? Math.max(0, currentTime - playback.startTime) : 0;
    const nextOffset = Math.min(
      playback.offsetSeconds + elapsed * playback.playbackRate,
      playback.duration
    );
    deckPlayback.set(deckId, {
      ...playback,
      startTime: currentTime,
      offsetSeconds: nextOffset,
      playbackRate: clampedRate,
    });
  }
};
