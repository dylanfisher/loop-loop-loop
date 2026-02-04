import {
  createPitchShiftNodes,
  disposePitchShift,
  setPitchShift,
  type PitchShiftNodes,
} from "./pitchShift";
import { createLimiter, createSoftClipper } from "./clipper";
import {
  FRACTAL_DEFAULTS,
  applyFractalLiveParams,
  fractalSeedForIndex,
  normalizeFractalParams,
  type FractalParams,
} from "./effects/fractalResonator";
import { normalizeDelayParams } from "./effects/delay";

type DeckEndedCallback = () => void;

type DeckNodes = {
  gain: GainNode;
  balance: StereoPannerNode;
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  eqLow: BiquadFilterNode[];
  eqMid: BiquadFilterNode[];
  eqHigh: BiquadFilterNode[];
  delayDry: GainNode;
  delayWet: GainNode;
  delaySplit: ChannelSplitterNode;
  delayMerge: ChannelMergerNode;
  delayL: DelayNode;
  delayR: DelayNode;
  delayFeedbackL: GainNode;
  delayFeedbackR: GainNode;
  delayToneL: BiquadFilterNode;
  delayToneR: BiquadFilterNode;
  delayPingPong: boolean;
  delayActive: boolean;
  fractalDry: GainNode;
  fractalWet: GainNode;
  fractalInput: GainNode;
  fractalFeedback: GainNode;
  fractalFeedbackDelay: DelayNode;
  fractalTone: BiquadFilterNode;
  fractalDrive: WaveShaperNode;
  fractalBody: GainNode;
  fractalModeFilters: BiquadFilterNode[];
  fractalModeGains: GainNode[];
  fractalSeeds: number[];
  postFractal: GainNode;
  fractalActive: boolean;
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
const pendingDelayTime = new Map<number, number>();
const pendingDelayFeedback = new Map<number, number>();
const pendingDelayMix = new Map<number, number>();
const pendingDelayTone = new Map<number, number>();
const pendingDelayPingPong = new Map<number, boolean>();
const fractalParamsByDeck = new Map<number, FractalParams>();
const isDev = import.meta.env.DEV;
const defaultPitchShift = 0;
const defaultBalance = 0;
const eqStageCount = 2;
const FRACTAL_MODE_COUNT = 16;
const FRACTAL_BYPASS_EPSILON = 1e-4;

const applyEqGain = (filters: BiquadFilterNode[], value: number) => {
  const perStageGain = value / eqStageCount;
  filters.forEach((filter) => {
    filter.gain.value = perStageGain;
  });
};

const connectDelayFeedback = (nodes: DeckNodes, pingPong: boolean) => {
  if (nodes.delayPingPong === pingPong) return;
  nodes.delayFeedbackL.disconnect();
  nodes.delayFeedbackR.disconnect();
  nodes.delayToneL.disconnect();
  nodes.delayToneR.disconnect();

  nodes.delayL.connect(nodes.delayFeedbackL);
  nodes.delayR.connect(nodes.delayFeedbackR);
  nodes.delayFeedbackL.connect(nodes.delayToneL);
  nodes.delayFeedbackR.connect(nodes.delayToneR);
  if (pingPong) {
    nodes.delayToneL.connect(nodes.delayR);
    nodes.delayToneR.connect(nodes.delayL);
  } else {
    nodes.delayToneL.connect(nodes.delayL);
    nodes.delayToneR.connect(nodes.delayR);
  }
  nodes.delayPingPong = pingPong;
};

const applyFractalSettings = (
  nodes: DeckNodes,
  mix: number,
  structure: number,
  depth: number,
  drift: number,
  decay: number,
  tone: number
) => {
  const params = applyFractalLiveParams(
    {
      dry: nodes.fractalDry,
      wet: nodes.fractalWet,
      feedback: nodes.fractalFeedback,
      feedbackDelay: nodes.fractalFeedbackDelay,
      tone: nodes.fractalTone,
      drive: nodes.fractalDrive,
      body: nodes.fractalBody,
      modeFilters: nodes.fractalModeFilters,
      modeGains: nodes.fractalModeGains,
      seeds: nodes.fractalSeeds,
    },
    { mix, structure, depth, drift, decay, tone }
  );
  return params.mix;
};

const getFractalParams = (deckId: number): FractalParams =>
  fractalParamsByDeck.get(deckId) ?? FRACTAL_DEFAULTS;

const setFractalParams = (deckId: number, params: Partial<FractalParams>) => {
  const next = normalizeFractalParams({
    ...getFractalParams(deckId),
    ...params,
  });
  fractalParamsByDeck.set(deckId, next);
  return next;
};

const setDelayRouting = (nodes: DeckNodes, active: boolean) => {
  if (nodes.delayActive === active) return;
  const fractalOut = nodes.postFractal;
  if (nodes.delayActive) {
    fractalOut.disconnect(nodes.delaySplit);
    nodes.delayMerge.disconnect(nodes.delayWet);
  }
  if (active) {
    fractalOut.connect(nodes.delaySplit);
    nodes.delayMerge.connect(nodes.delayWet);
  }
  nodes.delayActive = active;
};

const setFractalRouting = (nodes: DeckNodes, active: boolean) => {
  if (nodes.fractalActive === active) return;
  const eqOut = nodes.eqHigh[nodes.eqHigh.length - 1];
  if (nodes.fractalActive) {
    eqOut.disconnect(nodes.fractalInput);
    nodes.fractalWet.disconnect(nodes.fractalFeedback);
    nodes.fractalWet.disconnect(nodes.postFractal);
    nodes.fractalFeedbackDelay.disconnect(nodes.fractalInput);
  }
  if (active) {
    eqOut.connect(nodes.fractalInput);
    nodes.fractalWet.connect(nodes.fractalFeedback);
    nodes.fractalWet.connect(nodes.postFractal);
    nodes.fractalFeedbackDelay.connect(nodes.fractalInput);
  }
  nodes.fractalActive = active;
};

const applyFractalState = (
  nodes: DeckNodes,
  params: FractalParams
) => {
  const mix = applyFractalSettings(
    nodes,
    params.mix,
    params.structure,
    params.depth,
    params.drift,
    params.decay,
    params.tone
  );
  setFractalRouting(nodes, mix > FRACTAL_BYPASS_EPSILON);
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
  balance: number,
  delayTime: number,
  delayFeedback: number,
  delayMix: number,
  delayTone: number,
  delayPingPong: boolean,
  fractalMix: number,
  fractalStructure: number,
  fractalDepth: number,
  fractalDrift: number,
  fractalDecay: number,
  fractalTone: number
) => {
  const normalizedDelay = normalizeDelayParams({
    time: delayTime,
    feedback: delayFeedback,
    mix: delayMix,
    tone: delayTone,
    pingPong: delayPingPong,
  });
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
    const delayDry = context.createGain();
    const delayWet = context.createGain();
    const delaySplit = context.createChannelSplitter(2);
    const delayMerge = context.createChannelMerger(2);
    const delayL = context.createDelay(2.5);
    const delayR = context.createDelay(2.5);
    const delayFeedbackL = context.createGain();
    const delayFeedbackR = context.createGain();
    const delayToneL = context.createBiquadFilter();
    const delayToneR = context.createBiquadFilter();
    delayToneL.type = "lowpass";
    delayToneR.type = "lowpass";
    const nextDelayTime = pendingDelayTime.get(deckId) ?? normalizedDelay.time;
    delayL.delayTime.value = nextDelayTime;
    delayR.delayTime.value = nextDelayTime;
    const nextDelayFeedback = pendingDelayFeedback.get(deckId) ?? normalizedDelay.feedback;
    delayFeedbackL.gain.value = nextDelayFeedback;
    delayFeedbackR.gain.value = nextDelayFeedback;
    const nextDelayTone = pendingDelayTone.get(deckId) ?? normalizedDelay.tone;
    delayToneL.frequency.value = nextDelayTone;
    delayToneR.frequency.value = nextDelayTone;
    const nextDelayMix = pendingDelayMix.get(deckId) ?? normalizedDelay.mix;
    delayWet.gain.value = nextDelayMix;
    delayDry.gain.value = 1 - nextDelayMix;
    const nextDelayPingPong = pendingDelayPingPong.get(deckId) ?? normalizedDelay.pingPong;
    const fractalDry = context.createGain();
    const fractalWet = context.createGain();
    const fractalInput = context.createGain();
    const fractalFeedback = context.createGain();
    const fractalFeedbackDelay = context.createDelay(1);
    const fractalToneNode = context.createBiquadFilter();
    const fractalDrive = context.createWaveShaper();
    fractalDrive.oversample = "4x";
    const fractalBody = context.createGain();
    fractalToneNode.type = "lowpass";
    fractalFeedbackDelay.delayTime.value = 0.01;
    const fractalModeFilters = Array.from({ length: FRACTAL_MODE_COUNT }, () => {
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      return filter;
    });
    const fractalModeGains = Array.from({ length: FRACTAL_MODE_COUNT }, () =>
      context.createGain()
    );
    const fractalSeeds = Array.from(
      { length: FRACTAL_MODE_COUNT },
      (_, index) => fractalSeedForIndex(index)
    );
    const postFractal = context.createGain();
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
    eqHigh[eqHigh.length - 1].connect(fractalDry);
    fractalModeFilters.forEach((filter, index) => {
      fractalInput.connect(filter);
      filter.connect(fractalModeGains[index]);
      fractalModeGains[index].connect(fractalToneNode);
    });
    fractalInput.connect(fractalBody);
    fractalBody.connect(fractalToneNode);
    fractalToneNode.connect(fractalDrive);
    fractalDrive.connect(fractalWet);
    fractalDry.connect(postFractal);
    fractalFeedback.connect(fractalFeedbackDelay);
    postFractal.connect(delayDry);
    delaySplit.connect(delayL, 0);
    delaySplit.connect(delayR, 1);
    delayL.connect(delayMerge, 0, 0);
    delayR.connect(delayMerge, 0, 1);
    delayWet.connect(deckGain);
    delayDry.connect(deckGain);
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
      delayDry,
      delayWet,
      delaySplit,
      delayMerge,
      delayL,
      delayR,
      delayFeedbackL,
      delayFeedbackR,
      delayToneL,
      delayToneR,
      delayPingPong: !nextDelayPingPong,
      delayActive: false,
      fractalDry,
      fractalWet,
      fractalInput,
      fractalFeedback,
      fractalFeedbackDelay,
      fractalTone: fractalToneNode,
      fractalDrive,
      fractalBody,
      fractalModeFilters,
      fractalModeGains,
      fractalSeeds,
      postFractal,
      fractalActive: false,
      clipper,
      limiter,
      pitchShift: pitchShiftNodes,
    };
    balanceNode.connect(pitchShiftNodes.input);
    const nextFractal = setFractalParams(deckId, {
      mix: fractalMix,
      structure: fractalStructure,
      depth: fractalDepth,
      drift: fractalDrift,
      decay: fractalDecay,
      tone: fractalTone,
    });
    applyFractalState(nodes, nextFractal);
    connectDelayFeedback(nodes, nextDelayPingPong);
    setDelayRouting(nodes, nextDelayMix > 0);
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
    nodes.delayL.delayTime.value = normalizedDelay.time;
    nodes.delayR.delayTime.value = normalizedDelay.time;
    nodes.delayFeedbackL.gain.value = normalizedDelay.feedback;
    nodes.delayFeedbackR.gain.value = normalizedDelay.feedback;
    nodes.delayToneL.frequency.value = normalizedDelay.tone;
    nodes.delayToneR.frequency.value = normalizedDelay.tone;
    nodes.delayWet.gain.value = normalizedDelay.mix;
    nodes.delayDry.gain.value = 1 - normalizedDelay.mix;
    const nextFractal = setFractalParams(deckId, {
      mix: fractalMix,
      structure: fractalStructure,
      depth: fractalDepth,
      drift: fractalDrift,
      decay: fractalDecay,
      tone: fractalTone,
    });
    applyFractalState(nodes, nextFractal);
    connectDelayFeedback(nodes, normalizedDelay.pingPong);
    setDelayRouting(nodes, normalizedDelay.mix > 0);
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
  pendingDelayTime.delete(deckId);
  pendingDelayFeedback.delete(deckId);
  pendingDelayMix.delete(deckId);
  pendingDelayTone.delete(deckId);
  pendingDelayPingPong.delete(deckId);
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
  delayTime: number,
  delayFeedback: number,
  delayMix: number,
  delayTone: number,
  delayPingPong: boolean,
  balance = defaultBalance,
  pitchShift = defaultPitchShift,
  fractalMix = 0,
  fractalStructure = 0.45,
  fractalDepth = 0.35,
  fractalDrift = 0.15,
  fractalDecay = 0.2,
  fractalTone = 6000,
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
    balance,
    delayTime,
    delayFeedback,
    delayMix,
    delayTone,
    delayPingPong,
    fractalMix,
    fractalStructure,
    fractalDepth,
    fractalDrift,
    fractalDecay,
    fractalTone
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

export const setDeckDelayTimeValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ time: value }).time;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayL.delayTime.value = normalized;
    nodes.delayR.delayTime.value = normalized;
    pendingDelayTime.delete(deckId);
  } else {
    pendingDelayTime.set(deckId, normalized);
  }
};

export const setDeckDelayFeedbackValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ feedback: value }).feedback;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayFeedbackL.gain.value = normalized;
    nodes.delayFeedbackR.gain.value = normalized;
    pendingDelayFeedback.delete(deckId);
  } else {
    pendingDelayFeedback.set(deckId, normalized);
  }
};

export const setDeckDelayMixValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ mix: value }).mix;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayWet.gain.value = normalized;
    nodes.delayDry.gain.value = 1 - normalized;
    setDelayRouting(nodes, normalized > 0);
    pendingDelayMix.delete(deckId);
  } else {
    pendingDelayMix.set(deckId, normalized);
  }
};

export const setDeckDelayToneValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ tone: value }).tone;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayToneL.frequency.value = normalized;
    nodes.delayToneR.frequency.value = normalized;
    pendingDelayTone.delete(deckId);
  } else {
    pendingDelayTone.set(deckId, normalized);
  }
};

export const setDeckDelayPingPongValue = (deckId: number, value: boolean) => {
  const normalized = normalizeDelayParams({ pingPong: value }).pingPong;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    connectDelayFeedback(nodes, normalized);
    pendingDelayPingPong.delete(deckId);
  } else {
    pendingDelayPingPong.set(deckId, normalized);
  }
};

export const setDeckFractalMixValue = (deckId: number, value: number) => {
  const next = setFractalParams(deckId, { mix: value });
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyFractalState(nodes, next);
  }
};

export const setDeckFractalStructureValue = (deckId: number, value: number) => {
  const next = setFractalParams(deckId, { structure: value });
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyFractalState(nodes, next);
  }
};

export const setDeckFractalDepthValue = (deckId: number, value: number) => {
  const next = setFractalParams(deckId, { depth: value });
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyFractalState(nodes, next);
  }
};

export const setDeckFractalDriftValue = (deckId: number, value: number) => {
  const next = setFractalParams(deckId, { drift: value });
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyFractalState(nodes, next);
  }
};

export const setDeckFractalDecayValue = (deckId: number, value: number) => {
  const next = setFractalParams(deckId, { decay: value });
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyFractalState(nodes, next);
  }
};

export const setDeckFractalToneValue = (deckId: number, value: number) => {
  const next = setFractalParams(deckId, { tone: value });
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyFractalState(nodes, next);
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
    nodes.delayDry.disconnect();
    nodes.delayWet.disconnect();
    nodes.delaySplit.disconnect();
    nodes.delayMerge.disconnect();
    nodes.delayL.disconnect();
    nodes.delayR.disconnect();
    nodes.delayFeedbackL.disconnect();
    nodes.delayFeedbackR.disconnect();
    nodes.delayToneL.disconnect();
    nodes.delayToneR.disconnect();
    nodes.fractalDry.disconnect();
    nodes.fractalWet.disconnect();
    nodes.fractalInput.disconnect();
    nodes.fractalFeedback.disconnect();
    nodes.fractalFeedbackDelay.disconnect();
    nodes.fractalTone.disconnect();
    nodes.fractalDrive.disconnect();
    nodes.fractalBody.disconnect();
    nodes.fractalModeFilters.forEach((node) => node.disconnect());
    nodes.fractalModeGains.forEach((node) => node.disconnect());
    nodes.postFractal.disconnect();
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
  pendingDelayTime.delete(deckId);
  pendingDelayFeedback.delete(deckId);
  pendingDelayMix.delete(deckId);
  pendingDelayTone.delete(deckId);
  pendingDelayPingPong.delete(deckId);
  fractalParamsByDeck.delete(deckId);
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
  const loopStart = playback.loopStart;
  const loopEnd =
    playback.loopEnabled && playback.loopEnd > loopStart + 0.01
      ? playback.loopEnd
      : playback.duration;
  const loopDuration = loopEnd - loopStart;
  const baseOffset = playback.offsetSeconds;
  const rate = playback.playbackRate;
  if (playback.loopEnabled && loopDuration > 0) {
    const raw = (baseOffset - loopStart) + elapsed * rate;
    const wrapped = ((raw % loopDuration) + loopDuration) % loopDuration;
    const position = loopStart + wrapped;
    return Number.isFinite(position) ? position : null;
  }

  const position = Math.min(baseOffset + elapsed * rate, playback.duration);
  return Number.isFinite(position) ? position : null;
};

export const getDeckPlaybackSnapshot = (deckId: number, currentTime: number) => {
  const playback = deckPlayback.get(deckId);
  if (!playback) return null;
  const position = getDeckPlaybackPosition(deckId, currentTime);
  if (position === null) return null;
  if (playback.playing) {
    const elapsed = Math.max(0, currentTime - playback.startTime);
    if (elapsed > 2) {
      deckPlayback.set(deckId, {
        ...playback,
        startTime: currentTime,
        offsetSeconds: position,
      });
    }
  }
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

export const setDeckPlaybackOffsetValue = (
  deckId: number,
  offsetSeconds: number,
  currentTime?: number
) => {
  const playback = deckPlayback.get(deckId);
  if (!playback) return;
  const clampedOffset = Math.min(Math.max(0, offsetSeconds), playback.duration);
  deckPlayback.set(deckId, {
    ...playback,
    offsetSeconds: clampedOffset,
    startTime: currentTime ?? playback.startTime,
  });
};
