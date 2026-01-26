import {
  createPitchShiftNodes,
  disposePitchShift,
  setPitchShift,
  type PitchShiftNodes,
} from "./pitchShift";
import { createLimiter, createSoftClipper } from "./clipper";

type DeckEndedCallback = () => void;

type DeckNodes = {
  gain: GainNode;
  balance: StereoPannerNode;
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  eqLow: BiquadFilterNode[];
  eqMid: BiquadFilterNode[];
  eqHigh: BiquadFilterNode[];
  clipper: WaveShaperNode;
  limiter: DynamicsCompressorNode;
  pitchShift: PitchShiftNodes;
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

export type DeckPlaybackSnapshot = {
  position: number;
  duration: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  playing: boolean;
  playbackRate: number;
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
const pendingBalance = new Map<number, number>();
const pendingPitchShift = new Map<number, number>();
const isDev = import.meta.env.DEV;
const defaultPitchShift = 0;
const defaultBalance = 0;
const eqStageCount = 2;

const applyEqGain = (filters: BiquadFilterNode[], value: number) => {
  const perStageGain = value / eqStageCount;
  filters.forEach((filter) => {
    filter.gain.value = perStageGain;
  });
};


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
  eqHighGain: number,
  pitchShift: number,
  balance: number
) => {
  let nodes = deckNodes.get(deckId);
  if (!nodes) {
    const balanceNode = context.createStereoPanner();
    balanceNode.pan.value = pendingBalance.get(deckId) ?? balance;
    const pitchShiftNodes = createPitchShiftNodes(context);
    const deckHighpass = context.createBiquadFilter();
    deckHighpass.type = "highpass";
    deckHighpass.frequency.value = pendingHighpass.get(deckId) ?? highpassCutoff;
    deckHighpass.Q.value = pendingResonance.get(deckId) ?? resonance;
    const deckLowpass = context.createBiquadFilter();
    deckLowpass.type = "lowpass";
    deckLowpass.frequency.value = pendingFilters.get(deckId) ?? filterCutoff;
    deckLowpass.Q.value = pendingResonance.get(deckId) ?? resonance;
    const eqLow = Array.from({ length: eqStageCount }, () => {
      const filter = context.createBiquadFilter();
      filter.type = "lowshelf";
      filter.frequency.value = 120;
      return filter;
    });
    const eqMid = Array.from({ length: eqStageCount }, () => {
      const filter = context.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;
      return filter;
    });
    const eqHigh = Array.from({ length: eqStageCount }, () => {
      const filter = context.createBiquadFilter();
      filter.type = "highshelf";
      filter.frequency.value = 8000;
      return filter;
    });
    applyEqGain(eqLow, pendingEqLow.get(deckId) ?? eqLowGain);
    applyEqGain(eqMid, pendingEqMid.get(deckId) ?? eqMidGain);
    applyEqGain(eqHigh, pendingEqHigh.get(deckId) ?? eqHighGain);
    const deckGain = context.createGain();
    deckGain.gain.value = pendingGains.get(deckId) ?? gain;
    const clipper = createSoftClipper(context);
    const limiter = createLimiter(context);
    pitchShiftNodes.output.connect(deckHighpass);
    deckHighpass.connect(deckLowpass);
    deckLowpass.connect(eqLow[0]);
    for (let i = 0; i < eqLow.length - 1; i++) {
      eqLow[i].connect(eqLow[i + 1]);
    }
    eqLow[eqLow.length - 1].connect(eqMid[0]);
    for (let i = 0; i < eqMid.length - 1; i++) {
      eqMid[i].connect(eqMid[i + 1]);
    }
    eqMid[eqMid.length - 1].connect(eqHigh[0]);
    for (let i = 0; i < eqHigh.length - 1; i++) {
      eqHigh[i].connect(eqHigh[i + 1]);
    }
    eqHigh[eqHigh.length - 1].connect(deckGain);
    deckGain.connect(limiter);
    limiter.connect(clipper);
    clipper.connect(output);
    setPitchShift(pitchShiftNodes, pendingPitchShift.get(deckId) ?? pitchShift);
    nodes = {
      gain: deckGain,
      balance: balanceNode,
      lowpass: deckLowpass,
      highpass: deckHighpass,
      eqLow,
      eqMid,
      eqHigh,
      clipper,
      limiter,
      pitchShift: pitchShiftNodes,
    };
    balanceNode.connect(pitchShiftNodes.input);
    deckNodes.set(deckId, nodes);
  } else {
    nodes.gain.gain.value = gain;
    nodes.lowpass.frequency.value = filterCutoff;
    nodes.highpass.frequency.value = highpassCutoff;
    nodes.lowpass.Q.value = resonance;
    nodes.highpass.Q.value = resonance;
    applyEqGain(nodes.eqLow, eqLowGain);
    applyEqGain(nodes.eqMid, eqMidGain);
    applyEqGain(nodes.eqHigh, eqHighGain);
    nodes.balance.pan.value = balance;
    setPitchShift(nodes.pitchShift, pitchShift);
  }

  pendingGains.delete(deckId);
  pendingFilters.delete(deckId);
  pendingHighpass.delete(deckId);
  pendingResonance.delete(deckId);
  pendingEqLow.delete(deckId);
  pendingEqMid.delete(deckId);
  pendingEqHigh.delete(deckId);
  pendingBalance.delete(deckId);
  pendingPitchShift.delete(deckId);
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
  balance = defaultBalance,
  pitchShift = defaultPitchShift,
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
    eqHighGain,
    pitchShift,
    balance
  );

  const source = context.createBufferSource();
  source.buffer = buffer;
  const nextRate = pendingPlaybackRates.get(deckId) ?? playbackRate;
  source.playbackRate.value = nextRate;
  pendingPlaybackRates.delete(deckId);
  source.loop = loopEnabled;
  let safeLoopStart = loopStartSeconds;
  let safeLoopEnd = loopEndSeconds;
  if (loopEnabled) {
    safeLoopStart = Math.max(0, loopStartSeconds);
    const minEnd = safeLoopStart + 0.01;
    safeLoopEnd =
      loopEndSeconds > minEnd ? loopEndSeconds : buffer.duration;
    source.loopStart = safeLoopStart;
    source.loopEnd = Math.min(safeLoopEnd, buffer.duration);
  }
  if (isDev) {
    console.info("Deck loop params", {
      deckId,
      loopEnabled,
      loopStart: source.loopStart,
      loopEnd: source.loopEnd,
      sourceLoop: source.loop,
      duration: buffer.duration,
    });
  }
  source.connect(nodes.balance);
  source.onended = () => {
    if (isDev && loopEnabled) {
      console.info("Deck onended fired while looping", {
        deckId,
        loopStart: source.loopStart,
        loopEnd: source.loopEnd,
        duration: buffer.duration,
      });
    }
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
    loopStart: safeLoopStart,
    loopEnd: safeLoopEnd,
    duration: buffer.duration,
    playbackRate: nextRate,
    playing: true,
  });
  if (isDev) {
    console.info("Deck playback set", {
      deckId,
      duration: buffer.duration,
      loopEnabled,
      loopStart: loopStartSeconds,
      loopEnd: loopEndSeconds,
    });
  }
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
    applyEqGain(nodes.eqLow, value);
    pendingEqLow.delete(deckId);
  } else {
    pendingEqLow.set(deckId, value);
  }
};

export const setDeckEqMidGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyEqGain(nodes.eqMid, value);
    pendingEqMid.delete(deckId);
  } else {
    pendingEqMid.set(deckId, value);
  }
};

export const setDeckEqHighGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyEqGain(nodes.eqHigh, value);
    pendingEqHigh.delete(deckId);
  } else {
    pendingEqHigh.set(deckId, value);
  }
};

export const setDeckBalanceValue = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.balance.pan.value = value;
    pendingBalance.delete(deckId);
  } else {
    pendingBalance.set(deckId, value);
  }
};

export const setDeckPitchShiftValue = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    setPitchShift(nodes.pitchShift, value);
    pendingPitchShift.delete(deckId);
  } else {
    pendingPitchShift.set(deckId, value);
  }
};

export const removeDeckNodes = (deckId: number) => {
  if (isDev) {
    console.info("Deck playback removed", {
      deckId,
      hadPlayback: deckPlayback.has(deckId),
      hadNodes: deckNodes.has(deckId),
    });
  }
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    if (nodes.source) {
      nodes.source.onended = null;
    }
    nodes.source?.stop();
    nodes.source?.disconnect();
    disposePitchShift(nodes.pitchShift);
    nodes.highpass.disconnect();
    nodes.lowpass.disconnect();
    nodes.eqLow.forEach((node) => node.disconnect());
    nodes.eqMid.forEach((node) => node.disconnect());
    nodes.eqHigh.forEach((node) => node.disconnect());
    nodes.gain.disconnect();
    nodes.limiter.disconnect();
    nodes.clipper.disconnect();
    nodes.balance.disconnect();
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
  pendingBalance.delete(deckId);
  pendingPitchShift.delete(deckId);
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
    const safeStart = loopEnabled ? Math.max(0, loopStart) : loopStart;
    const safeEnd =
      loopEnabled && loopEnd <= safeStart + 0.01 ? safeStart + 0.01 : loopEnd;
    deckPlayback.set(deckId, {
      ...playback,
      loopEnabled,
      loopStart: safeStart,
      loopEnd: safeEnd,
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

  if (playback.loopEnabled) {
    const loopStart = playback.loopStart;
    const loopEnd =
      playback.loopEnd > loopStart + 0.01 ? playback.loopEnd : playback.duration;
    const loopDuration = loopEnd - loopStart;
    if (loopDuration > 0) {
      const loopOffset = position - loopStart;
      const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
      position = loopStart + wrapped;
    }
  }

  return position;
};

export const getDeckPlaybackSnapshot = (deckId: number, currentTime: number) => {
  const playback = deckPlayback.get(deckId);
  if (!playback) return null;
  const position = getDeckPlaybackPosition(deckId, currentTime);
  if (position === null) return null;
  const loopStart = playback.loopStart;
  const loopEnd =
    playback.loopEnabled && playback.loopEnd > loopStart + 0.01
      ? playback.loopEnd
      : playback.duration;
  return {
    position,
    duration: playback.duration,
    loopEnabled: playback.loopEnabled,
    loopStart,
    loopEnd,
    playing: playback.playing,
    playbackRate: playback.playbackRate,
  };
};

export const hasDeckPlayback = (deckId: number) => deckPlayback.has(deckId);

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
