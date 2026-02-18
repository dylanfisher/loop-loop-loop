import {
  createPitchShiftNodes,
  disposePitchShift,
  setPitchShift,
  type PitchShiftNodes,
} from "./pitchShift";
import {
  createRearrangerPingPongNodes,
  disposeRearrangerPingPong,
  setRearrangerPingPongAmount,
  setRearrangerPingPongConfig,
  type RearrangerPingPongConfig,
  type RearrangerPingPongNodes,
} from "./rearrangerPingPong";
import { createLimiter, createSoftClipper } from "./clipper";
import {
  createSoftClipCurve,
  mapDelayDampingToCutoff,
  mapDelaySaturationDrive,
  mapDelaySafetyDrive,
  normalizeDelayParams,
} from "./effects/delay";
import {
  hasActiveParametricEq,
  normalizeParametricEqBands,
  PARAMETRIC_EQ_MAX_BANDS,
} from "./effects/parametricEq";
import {
  createChannelVocoder,
  disposeChannelVocoder,
  normalizeVocoderAttackMs,
  normalizeVocoderBandCount,
  normalizeVocoderBandSpread,
  normalizeVocoderGateThreshold,
  setChannelVocoderCarrierActive,
  setChannelVocoderGateThreshold,
  setChannelVocoderModDrive,
  setChannelVocoderAttackMs,
  setChannelVocoderBandCount,
  setChannelVocoderBandSpread,
  setChannelVocoderMix,
  setChannelVocoderNoiseMix,
  setChannelVocoderReleaseMs,
  normalizeVocoderModDrive,
  normalizeVocoderNoiseMix,
  normalizeVocoderReleaseMs,
  type ChannelVocoderNodes,
} from "./effects/vocoder";
import type { EqMode, ParametricEqBand } from "../types/deck";

type DeckEndedCallback = () => void;

type DeckNodes = {
  gain: GainNode;
  recordExportSend: GainNode;
  modulatorOutputGain: GainNode;
  balance: StereoPannerNode;
  rearrangerPan: StereoPannerNode;
  rearrangerPingPong: RearrangerPingPongNodes;
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  eqLow: BiquadFilterNode[];
  eqMid: BiquadFilterNode[];
  eqHigh: BiquadFilterNode[];
  parametricEq: BiquadFilterNode[];
  parametricBypassed: boolean;
  eqMode: EqMode;
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
  delayDampingL: BiquadFilterNode;
  delayDampingR: BiquadFilterNode;
  delaySaturationDriveL: GainNode;
  delaySaturationDriveR: GainNode;
  delaySaturationShapeL: WaveShaperNode;
  delaySaturationShapeR: WaveShaperNode;
  delaySaturationOutL: GainNode;
  delaySaturationOutR: GainNode;
  delaySafetyDrive: GainNode;
  delaySafetyShape: WaveShaperNode;
  delaySafetyOut: GainNode;
  delayPingPong: boolean;
  delayActive: boolean;
  vocoderRouted: boolean;
  vocoder: ChannelVocoderNodes;
  vocoderMix: number;
  vocoderCarrierDeckId: number | null;
  vocoderModulatorMonitor: number;
  vocoderModDrive: number;
  vocoderBandCount: number;
  vocoderBandSpread: number;
  vocoderAttackMs: number;
  vocoderReleaseMs: number;
  vocoderNoiseMix: number;
  vocoderGateThreshold: number;
  vocoderCarrierConnectedDeckId: number | null;
  vocoderCarrierSource?: AudioBufferSourceNode;
  postEq: GainNode;
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
const pendingEqMode = new Map<number, EqMode>();
const pendingParametricEqBands = new Map<number, ParametricEqBand[]>();
const pendingBalance = new Map<number, number>();
const pendingRearrangerPan = new Map<number, number>();
const pendingRearrangerPingPongAmount = new Map<number, number>();
const pendingRearrangerPingPongConfig = new Map<number, RearrangerPingPongConfig | null>();
const pendingPitchShift = new Map<number, number>();
const pendingDelayTime = new Map<number, number>();
const pendingDelayFeedback = new Map<number, number>();
const pendingDelayMix = new Map<number, number>();
const pendingDelayTone = new Map<number, number>();
const pendingDelayPingPong = new Map<number, boolean>();
const pendingDelaySaturation = new Map<number, number>();
const pendingDelayDamping = new Map<number, number>();
const pendingDelaySafety = new Map<number, number>();
const pendingVocoderMix = new Map<number, number>();
const pendingVocoderCarrierDeckId = new Map<number, number | null>();
const pendingVocoderModulatorMonitor = new Map<number, number>();
const pendingVocoderModDrive = new Map<number, number>();
const pendingVocoderBandCount = new Map<number, number>();
const pendingVocoderBandSpread = new Map<number, number>();
const pendingVocoderAttackMs = new Map<number, number>();
const pendingVocoderReleaseMs = new Map<number, number>();
const pendingVocoderNoiseMix = new Map<number, number>();
const pendingVocoderGateThreshold = new Map<number, number>();
const pendingRecordExportSend = new Map<number, boolean>();
const vocoderConfig = new Map<
  number,
  { mix: number; carrierDeckId: number | null; modulatorMonitor: number }
>();
const carrierDependents = new Map<number, Set<number>>();
const isDev = import.meta.env.DEV;
const defaultPitchShift = 0;
const defaultBalance = 0;
const eqStageCount = 2;
const normalizeVocoderModulatorMonitor = (value: number) => Math.min(Math.max(value, 0), 1);

const resetParametricBandNode = (node: BiquadFilterNode) => {
  node.type = "peaking";
  node.frequency.value = 1000;
  node.Q.value = 1;
  node.gain.value = 0;
};

const applyParametricEq = (
  filters: BiquadFilterNode[],
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined
) => {
  const isActive = hasActiveParametricEq(eqMode, bands);
  const activeBands = isActive ? normalizeParametricEqBands(bands) : [];
  for (let i = 0; i < filters.length; i += 1) {
    const filter = filters[i];
    const band = activeBands[i];
    if (!band || !band.enabled) {
      resetParametricBandNode(filter);
      continue;
    }
    filter.type = band.type;
    filter.frequency.value = band.frequency;
    filter.gain.value = band.gain;
    filter.Q.value = band.q;
  }
  return isActive;
};

const applyEqGain = (filters: BiquadFilterNode[], value: number) => {
  const perStageGain = value / eqStageCount;
  filters.forEach((filter) => {
    filter.gain.value = perStageGain;
  });
};

const safeDisconnect = (source: AudioNode, destination: AudioNode) => {
  try {
    source.disconnect(destination);
  } catch {
    // ignore when edge is already disconnected
  }
};

const connectDelayFeedback = (nodes: DeckNodes, pingPong: boolean) => {
  if (nodes.delayPingPong === pingPong) return;
  nodes.delayFeedbackL.disconnect();
  nodes.delayFeedbackR.disconnect();
  nodes.delayToneL.disconnect();
  nodes.delayToneR.disconnect();
  nodes.delayDampingL.disconnect();
  nodes.delayDampingR.disconnect();
  nodes.delaySaturationDriveL.disconnect();
  nodes.delaySaturationDriveR.disconnect();
  nodes.delaySaturationShapeL.disconnect();
  nodes.delaySaturationShapeR.disconnect();
  nodes.delaySaturationOutL.disconnect();
  nodes.delaySaturationOutR.disconnect();

  nodes.delayL.connect(nodes.delayFeedbackL);
  nodes.delayR.connect(nodes.delayFeedbackR);
  nodes.delayFeedbackL.connect(nodes.delayToneL);
  nodes.delayFeedbackR.connect(nodes.delayToneR);
  nodes.delayToneL.connect(nodes.delayDampingL);
  nodes.delayToneR.connect(nodes.delayDampingR);
  nodes.delayDampingL.connect(nodes.delaySaturationDriveL);
  nodes.delayDampingR.connect(nodes.delaySaturationDriveR);
  nodes.delaySaturationDriveL.connect(nodes.delaySaturationShapeL);
  nodes.delaySaturationDriveR.connect(nodes.delaySaturationShapeR);
  nodes.delaySaturationShapeL.connect(nodes.delaySaturationOutL);
  nodes.delaySaturationShapeR.connect(nodes.delaySaturationOutR);
  if (pingPong) {
    nodes.delaySaturationOutL.connect(nodes.delayR);
    nodes.delaySaturationOutR.connect(nodes.delayL);
  } else {
    nodes.delaySaturationOutL.connect(nodes.delayL);
    nodes.delaySaturationOutR.connect(nodes.delayR);
  }
  nodes.delayPingPong = pingPong;
};

const setDelayRouting = (nodes: DeckNodes, active: boolean) => {
  if (nodes.delayActive === active) return;
  const source = nodes.vocoderRouted ? nodes.vocoder.output : nodes.postEq;
  if (nodes.delayActive) {
    safeDisconnect(source, nodes.delaySplit);
    safeDisconnect(nodes.delaySafetyOut, nodes.delayWet);
  }
  if (active) {
    source.connect(nodes.delaySplit);
    nodes.delaySafetyOut.connect(nodes.delayWet);
  }
  nodes.delayActive = active;
};

const shouldRouteThroughVocoder = (nodes: DeckNodes) =>
  nodes.vocoderMix > 1e-3 && nodes.vocoderCarrierDeckId !== null;

const setVocoderRouting = (nodes: DeckNodes, active: boolean) => {
  if (nodes.vocoderRouted === active) return;
  const delayWasActive = nodes.delayActive;
  if (delayWasActive) {
    setDelayRouting(nodes, false);
  }
  if (nodes.vocoderRouted) {
    safeDisconnect(nodes.postEq, nodes.vocoder.carrierInput);
    safeDisconnect(nodes.vocoder.output, nodes.delayDry);
  } else {
    safeDisconnect(nodes.postEq, nodes.delayDry);
  }
  if (active) {
    nodes.postEq.connect(nodes.vocoder.carrierInput);
    nodes.vocoder.output.connect(nodes.delayDry);
  } else {
    nodes.postEq.connect(nodes.delayDry);
  }
  nodes.vocoderRouted = active;
  if (delayWasActive) {
    setDelayRouting(nodes, true);
  }
};

const unregisterCarrierDependent = (carrierDeckId: number | null, deckId: number) => {
  if (carrierDeckId === null) return;
  const dependents = carrierDependents.get(carrierDeckId);
  if (!dependents) return;
  dependents.delete(deckId);
  if (dependents.size === 0) {
    carrierDependents.delete(carrierDeckId);
  }
};

const registerCarrierDependent = (carrierDeckId: number | null, deckId: number) => {
  if (carrierDeckId === null) return;
  let dependents = carrierDependents.get(carrierDeckId);
  if (!dependents) {
    dependents = new Set<number>();
    carrierDependents.set(carrierDeckId, dependents);
  }
  dependents.add(deckId);
};

const getCarrierMonitorOutputGain = (carrierDeckId: number) => {
  let hasLinkedDependent = false;
  let monitorGain = 0;
  vocoderConfig.forEach((config, dependentDeckId) => {
    if (dependentDeckId === carrierDeckId) return;
    if (config.carrierDeckId !== carrierDeckId) return;
    if (config.mix <= 1e-3) return;
    hasLinkedDependent = true;
    monitorGain = Math.max(
      monitorGain,
      normalizeVocoderModulatorMonitor(config.modulatorMonitor)
    );
  });
  return hasLinkedDependent ? monitorGain : 1;
};

const applyCarrierMonitorOutputGain = (carrierDeckId: number) => {
  const carrierNodes = deckNodes.get(carrierDeckId);
  if (!carrierNodes) return;
  carrierNodes.modulatorOutputGain.gain.value = getCarrierMonitorOutputGain(carrierDeckId);
};

const setConfiguredVocoderState = (
  deckId: number,
  mix: number,
  carrierDeckId: number | null,
  modulatorMonitor: number
) => {
  vocoderConfig.set(deckId, {
    mix: Math.min(Math.max(mix, 0), 1),
    carrierDeckId: carrierDeckId === deckId ? null : carrierDeckId,
    modulatorMonitor: normalizeVocoderModulatorMonitor(modulatorMonitor),
  });
};

const updateVocoderCarrierConnection = (deckId: number) => {
  const nodes = deckNodes.get(deckId);
  if (!nodes) return;
  const previousCarrierDeckId = nodes.vocoderCarrierConnectedDeckId;

  const desiredCarrierDeckId =
    nodes.vocoderCarrierDeckId !== null && nodes.vocoderCarrierDeckId !== deckId
      ? nodes.vocoderCarrierDeckId
      : null;

  if (nodes.vocoderCarrierSource) {
    try {
      nodes.vocoderCarrierSource.disconnect(nodes.vocoder.input);
    } catch {
      // ignore stale/disconnected source
    }
    nodes.vocoderCarrierSource = undefined;
  }

  unregisterCarrierDependent(nodes.vocoderCarrierConnectedDeckId, deckId);
  nodes.vocoderCarrierConnectedDeckId = null;
  if (previousCarrierDeckId !== null) {
    applyCarrierMonitorOutputGain(previousCarrierDeckId);
  }

  if (desiredCarrierDeckId === null) {
    setChannelVocoderCarrierActive(nodes.vocoder, false);
    return;
  }

  const carrierNodes = deckNodes.get(desiredCarrierDeckId);
  const carrierSource = carrierNodes?.source;
  if (!carrierNodes || !carrierSource) {
    registerCarrierDependent(desiredCarrierDeckId, deckId);
    applyCarrierMonitorOutputGain(desiredCarrierDeckId);
    setChannelVocoderCarrierActive(nodes.vocoder, false);
    return;
  }

  carrierSource.connect(nodes.vocoder.input);
  nodes.vocoderCarrierSource = carrierSource;
  nodes.vocoderCarrierConnectedDeckId = desiredCarrierDeckId;
  registerCarrierDependent(desiredCarrierDeckId, deckId);
  applyCarrierMonitorOutputGain(desiredCarrierDeckId);
  setChannelVocoderCarrierActive(nodes.vocoder, true);
};

const refreshDependentVocoders = (carrierDeckId: number) => {
  const dependents = carrierDependents.get(carrierDeckId);
  if (dependents && dependents.size > 0) {
    Array.from(dependents).forEach((deckId) => {
      updateVocoderCarrierConnection(deckId);
    });
  }
  applyCarrierMonitorOutputGain(carrierDeckId);
};

const setParametricRouting = (nodes: DeckNodes, bypassed: boolean) => {
  if (nodes.parametricBypassed === bypassed) return;
  const eqOut = nodes.eqHigh[nodes.eqHigh.length - 1];
  const firstParametric = nodes.parametricEq[0];
  const lastParametric = nodes.parametricEq[nodes.parametricEq.length - 1];
  eqOut.disconnect();
  lastParametric.disconnect();
  if (bypassed) {
    eqOut.connect(nodes.postEq);
  } else {
    eqOut.connect(firstParametric);
    lastParametric.connect(nodes.postEq);
  }
  nodes.parametricBypassed = bypassed;
};

const ensureDeckNodes = (
  context: AudioContext,
  output: AudioNode,
  recordExportOutput: AudioNode,
  deckId: number,
  gain: number,
  filterCutoff: number,
  highpassCutoff: number,
  resonance: number,
  eqMode: EqMode,
  eqLowGain: number,
  eqMidGain: number,
  eqHighGain: number,
  parametricEqBands: ParametricEqBand[],
  pitchShift: number,
  balance: number,
  delayTime: number,
  delayFeedback: number,
  delayMix: number,
  delayTone: number,
  delayPingPong: boolean,
  delaySaturation: number,
  delayDamping: number,
  delaySafety: number,
  vocoderMix: number,
  vocoderCarrierDeckId: number | null,
  vocoderModulatorMonitor: number,
  vocoderModDrive: number,
  vocoderBandCount: number,
  vocoderBandSpread: number,
  vocoderAttackMs: number,
  vocoderReleaseMs: number,
  vocoderNoiseMix: number,
  vocoderGateThreshold: number,
  includeInRecordExport: boolean
) => {
  const normalizedDelay = normalizeDelayParams({
    time: delayTime,
    feedback: delayFeedback,
    mix: delayMix,
    tone: delayTone,
    saturation: delaySaturation,
    damping: delayDamping,
    safety: delaySafety,
    pingPong: delayPingPong,
  });
  let nodes = deckNodes.get(deckId);
  if (!nodes) {
    const modulatorOutputGain = context.createGain();
    modulatorOutputGain.gain.value = 1;
    const balanceNode = context.createStereoPanner();
    balanceNode.pan.value = pendingBalance.get(deckId) ?? balance;
    const rearrangerPanNode = context.createStereoPanner();
    rearrangerPanNode.pan.value = pendingRearrangerPan.get(deckId) ?? 0;
    const rearrangerPingPongNodes = createRearrangerPingPongNodes(context);
    setRearrangerPingPongAmount(
      rearrangerPingPongNodes,
      pendingRearrangerPingPongAmount.get(deckId) ?? 0
    );
    setRearrangerPingPongConfig(
      rearrangerPingPongNodes,
      pendingRearrangerPingPongConfig.get(deckId) ?? null
    );
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
    const resolvedEqMode = pendingEqMode.get(deckId) ?? eqMode;
    const resolvedEqLow =
      resolvedEqMode === "eq3" ? pendingEqLow.get(deckId) ?? eqLowGain : 0;
    const resolvedEqMid =
      resolvedEqMode === "eq3" ? pendingEqMid.get(deckId) ?? eqMidGain : 0;
    const resolvedEqHigh =
      resolvedEqMode === "eq3" ? pendingEqHigh.get(deckId) ?? eqHighGain : 0;
    applyEqGain(eqLow, resolvedEqLow);
    applyEqGain(eqMid, resolvedEqMid);
    applyEqGain(eqHigh, resolvedEqHigh);
    const parametricEq = Array.from({ length: PARAMETRIC_EQ_MAX_BANDS }, () => {
      const filter = context.createBiquadFilter();
      resetParametricBandNode(filter);
      return filter;
    });
    const resolvedParametricBands =
      pendingParametricEqBands.get(deckId) ?? parametricEqBands;
    const parametricActive = applyParametricEq(parametricEq, resolvedEqMode, resolvedParametricBands);
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
    const delayDampingL = context.createBiquadFilter();
    const delayDampingR = context.createBiquadFilter();
    const delaySaturationDriveL = context.createGain();
    const delaySaturationDriveR = context.createGain();
    const delaySaturationShapeL = context.createWaveShaper();
    const delaySaturationShapeR = context.createWaveShaper();
    const delaySaturationOutL = context.createGain();
    const delaySaturationOutR = context.createGain();
    const delaySafetyDrive = context.createGain();
    const delaySafetyShape = context.createWaveShaper();
    const delaySafetyOut = context.createGain();
    delayToneL.type = "lowpass";
    delayToneR.type = "lowpass";
    delayDampingL.type = "lowpass";
    delayDampingR.type = "lowpass";
    const nextDelayTime = pendingDelayTime.get(deckId) ?? normalizedDelay.time;
    delayL.delayTime.value = nextDelayTime;
    delayR.delayTime.value = nextDelayTime;
    const nextDelayFeedback = pendingDelayFeedback.get(deckId) ?? normalizedDelay.feedback;
    delayFeedbackL.gain.value = nextDelayFeedback;
    delayFeedbackR.gain.value = nextDelayFeedback;
    const nextDelayTone = pendingDelayTone.get(deckId) ?? normalizedDelay.tone;
    delayToneL.frequency.value = nextDelayTone;
    delayToneR.frequency.value = nextDelayTone;
    const nextDelayDamping = pendingDelayDamping.get(deckId) ?? normalizedDelay.damping;
    const nextDampingCutoff = mapDelayDampingToCutoff(nextDelayDamping);
    delayDampingL.frequency.value = nextDampingCutoff;
    delayDampingR.frequency.value = nextDampingCutoff;
    const nextDelaySaturation = pendingDelaySaturation.get(deckId) ?? normalizedDelay.saturation;
    const nextSaturationDrive = mapDelaySaturationDrive(nextDelaySaturation);
    delaySaturationDriveL.gain.value = nextSaturationDrive;
    delaySaturationDriveR.gain.value = nextSaturationDrive;
    delaySaturationShapeL.curve = createSoftClipCurve(nextSaturationDrive);
    delaySaturationShapeR.curve = createSoftClipCurve(nextSaturationDrive);
    delaySaturationShapeL.oversample = "2x";
    delaySaturationShapeR.oversample = "2x";
    delaySaturationOutL.gain.value = 1 / nextSaturationDrive;
    delaySaturationOutR.gain.value = 1 / nextSaturationDrive;
    const nextDelaySafety = pendingDelaySafety.get(deckId) ?? normalizedDelay.safety;
    const nextSafetyDrive = mapDelaySafetyDrive(nextDelaySafety);
    delaySafetyDrive.gain.value = nextSafetyDrive;
    delaySafetyShape.curve = createSoftClipCurve(nextSafetyDrive);
    delaySafetyShape.oversample = "2x";
    delaySafetyOut.gain.value = 1 / nextSafetyDrive;
    const nextDelayMix = pendingDelayMix.get(deckId) ?? normalizedDelay.mix;
    delayWet.gain.value = nextDelayMix;
    delayDry.gain.value = 1 - nextDelayMix;
    const nextDelayPingPong = pendingDelayPingPong.get(deckId) ?? normalizedDelay.pingPong;
    const nextVocoderMix = pendingVocoderMix.get(deckId) ?? vocoderMix;
    const nextVocoderCarrierDeckId =
      pendingVocoderCarrierDeckId.get(deckId) ?? vocoderCarrierDeckId;
    const nextVocoderModulatorMonitor = normalizeVocoderModulatorMonitor(
      pendingVocoderModulatorMonitor.get(deckId) ?? vocoderModulatorMonitor
    );
    const nextVocoderModDrive = normalizeVocoderModDrive(
      pendingVocoderModDrive.get(deckId) ?? vocoderModDrive
    );
    const nextVocoderBandCount = normalizeVocoderBandCount(
      pendingVocoderBandCount.get(deckId) ?? vocoderBandCount
    );
    const nextVocoderBandSpread = normalizeVocoderBandSpread(
      pendingVocoderBandSpread.get(deckId) ?? vocoderBandSpread
    );
    const nextVocoderAttackMs = normalizeVocoderAttackMs(
      pendingVocoderAttackMs.get(deckId) ?? vocoderAttackMs
    );
    const nextVocoderReleaseMs = normalizeVocoderReleaseMs(
      pendingVocoderReleaseMs.get(deckId) ?? vocoderReleaseMs
    );
    const nextVocoderNoiseMix = normalizeVocoderNoiseMix(
      pendingVocoderNoiseMix.get(deckId) ?? vocoderNoiseMix
    );
    const nextVocoderGateThreshold = normalizeVocoderGateThreshold(
      pendingVocoderGateThreshold.get(deckId) ?? vocoderGateThreshold
    );
    const postEq = context.createGain();
    const vocoder = createChannelVocoder(context, {
      mix: nextVocoderMix,
      modDrive: nextVocoderModDrive,
      bandCount: nextVocoderBandCount,
      bandSpread: nextVocoderBandSpread,
      attackMs: nextVocoderAttackMs,
      releaseMs: nextVocoderReleaseMs,
      noiseMix: nextVocoderNoiseMix,
      gateThreshold: nextVocoderGateThreshold,
    });
    setChannelVocoderMix(vocoder, nextVocoderMix);
    setChannelVocoderModDrive(vocoder, nextVocoderModDrive);
    setChannelVocoderBandCount(vocoder, nextVocoderBandCount);
    setChannelVocoderBandSpread(vocoder, nextVocoderBandSpread);
    setChannelVocoderAttackMs(vocoder, nextVocoderAttackMs);
    setChannelVocoderReleaseMs(vocoder, nextVocoderReleaseMs);
    setChannelVocoderNoiseMix(vocoder, nextVocoderNoiseMix);
    setChannelVocoderGateThreshold(vocoder, nextVocoderGateThreshold);
    const deckGain = context.createGain();
    deckGain.gain.value = pendingGains.get(deckId) ?? gain;
    const recordExportSend = context.createGain();
    recordExportSend.gain.value =
      (pendingRecordExportSend.get(deckId) ?? includeInRecordExport) ? 1 : 0;
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
    eqHigh[eqHigh.length - 1].connect(parametricEq[0]);
    for (let i = 0; i < parametricEq.length - 1; i++) {
      parametricEq[i].connect(parametricEq[i + 1]);
    }
    parametricEq[parametricEq.length - 1].connect(postEq);
    postEq.connect(vocoder.carrierInput);
    vocoder.output.connect(delayDry);
    delaySplit.connect(delayL, 0);
    delaySplit.connect(delayR, 1);
    delayL.connect(delayMerge, 0, 0);
    delayR.connect(delayMerge, 0, 1);
    delayMerge.connect(delaySafetyDrive);
    delaySafetyDrive.connect(delaySafetyShape);
    delaySafetyShape.connect(delaySafetyOut);
    delayWet.connect(deckGain);
    delayDry.connect(deckGain);
    deckGain.connect(limiter);
    limiter.connect(clipper);
    clipper.connect(output);
    clipper.connect(recordExportSend);
    recordExportSend.connect(recordExportOutput);
    setPitchShift(pitchShiftNodes, pendingPitchShift.get(deckId) ?? pitchShift);
    nodes = {
      gain: deckGain,
      recordExportSend,
      modulatorOutputGain,
      balance: balanceNode,
      rearrangerPan: rearrangerPanNode,
      rearrangerPingPong: rearrangerPingPongNodes,
      lowpass: deckLowpass,
      highpass: deckHighpass,
      eqLow,
      eqMid,
      eqHigh,
      parametricEq,
      parametricBypassed: false,
      eqMode: resolvedEqMode,
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
      delayDampingL,
      delayDampingR,
      delaySaturationDriveL,
      delaySaturationDriveR,
      delaySaturationShapeL,
      delaySaturationShapeR,
      delaySaturationOutL,
      delaySaturationOutR,
      delaySafetyDrive,
      delaySafetyShape,
      delaySafetyOut,
      delayPingPong: !nextDelayPingPong,
      delayActive: false,
      vocoderRouted: true,
      vocoder,
      vocoderMix: nextVocoderMix,
      vocoderCarrierDeckId: nextVocoderCarrierDeckId,
      vocoderModulatorMonitor: nextVocoderModulatorMonitor,
      vocoderModDrive: nextVocoderModDrive,
      vocoderBandCount: nextVocoderBandCount,
      vocoderBandSpread: nextVocoderBandSpread,
      vocoderAttackMs: nextVocoderAttackMs,
      vocoderReleaseMs: nextVocoderReleaseMs,
      vocoderNoiseMix: nextVocoderNoiseMix,
      vocoderGateThreshold: nextVocoderGateThreshold,
      vocoderCarrierConnectedDeckId: null,
      postEq,
      clipper,
      limiter,
      pitchShift: pitchShiftNodes,
    };
    setConfiguredVocoderState(
      deckId,
      nextVocoderMix,
      nextVocoderCarrierDeckId,
      nextVocoderModulatorMonitor
    );
    setParametricRouting(nodes, !parametricActive);
    modulatorOutputGain.connect(balanceNode);
    balanceNode.connect(rearrangerPanNode);
    rearrangerPanNode.connect(rearrangerPingPongNodes.input);
    rearrangerPingPongNodes.output.connect(pitchShiftNodes.input);
    connectDelayFeedback(nodes, nextDelayPingPong);
    setVocoderRouting(nodes, shouldRouteThroughVocoder(nodes));
    setDelayRouting(nodes, nextDelayMix > 0);
    deckNodes.set(deckId, nodes);
    updateVocoderCarrierConnection(deckId);
    applyCarrierMonitorOutputGain(deckId);
  } else {
    nodes.gain.gain.value = gain;
    nodes.lowpass.frequency.value = filterCutoff;
    nodes.highpass.frequency.value = highpassCutoff;
    nodes.lowpass.Q.value = resonance;
    nodes.highpass.Q.value = resonance;
    const resolvedEqMode = pendingEqMode.get(deckId) ?? eqMode;
    nodes.eqMode = resolvedEqMode;
    applyEqGain(nodes.eqLow, resolvedEqMode === "eq3" ? eqLowGain : 0);
    applyEqGain(nodes.eqMid, resolvedEqMode === "eq3" ? eqMidGain : 0);
    applyEqGain(nodes.eqHigh, resolvedEqMode === "eq3" ? eqHighGain : 0);
    const resolvedParametricBands =
      pendingParametricEqBands.get(deckId) ?? parametricEqBands;
    const parametricActive = applyParametricEq(nodes.parametricEq, resolvedEqMode, resolvedParametricBands);
    setParametricRouting(nodes, !parametricActive);
    nodes.balance.pan.value = balance;
    nodes.rearrangerPan.pan.value = pendingRearrangerPan.get(deckId) ?? 0;
    setRearrangerPingPongAmount(
      nodes.rearrangerPingPong,
      pendingRearrangerPingPongAmount.get(deckId) ?? 0
    );
    setRearrangerPingPongConfig(
      nodes.rearrangerPingPong,
      pendingRearrangerPingPongConfig.get(deckId) ?? null
    );
    setPitchShift(nodes.pitchShift, pitchShift);
    nodes.delayL.delayTime.value = normalizedDelay.time;
    nodes.delayR.delayTime.value = normalizedDelay.time;
    nodes.delayFeedbackL.gain.value = normalizedDelay.feedback;
    nodes.delayFeedbackR.gain.value = normalizedDelay.feedback;
    nodes.delayToneL.frequency.value = normalizedDelay.tone;
    nodes.delayToneR.frequency.value = normalizedDelay.tone;
    const dampingCutoff = mapDelayDampingToCutoff(normalizedDelay.damping);
    nodes.delayDampingL.frequency.value = dampingCutoff;
    nodes.delayDampingR.frequency.value = dampingCutoff;
    const saturationDrive = mapDelaySaturationDrive(normalizedDelay.saturation);
    nodes.delaySaturationDriveL.gain.value = saturationDrive;
    nodes.delaySaturationDriveR.gain.value = saturationDrive;
    nodes.delaySaturationShapeL.curve = createSoftClipCurve(saturationDrive);
    nodes.delaySaturationShapeR.curve = createSoftClipCurve(saturationDrive);
    nodes.delaySaturationOutL.gain.value = 1 / saturationDrive;
    nodes.delaySaturationOutR.gain.value = 1 / saturationDrive;
    const safetyDrive = mapDelaySafetyDrive(normalizedDelay.safety);
    nodes.delaySafetyDrive.gain.value = safetyDrive;
    nodes.delaySafetyShape.curve = createSoftClipCurve(safetyDrive);
    nodes.delaySafetyOut.gain.value = 1 / safetyDrive;
    nodes.delayWet.gain.value = normalizedDelay.mix;
    nodes.delayDry.gain.value = 1 - normalizedDelay.mix;
    nodes.vocoderMix = pendingVocoderMix.get(deckId) ?? vocoderMix;
    setChannelVocoderMix(nodes.vocoder, nodes.vocoderMix);
    nodes.vocoderModDrive = normalizeVocoderModDrive(
      pendingVocoderModDrive.get(deckId) ?? vocoderModDrive
    );
    setChannelVocoderModDrive(nodes.vocoder, nodes.vocoderModDrive);
    nodes.vocoderBandCount = normalizeVocoderBandCount(
      pendingVocoderBandCount.get(deckId) ?? vocoderBandCount
    );
    setChannelVocoderBandCount(nodes.vocoder, nodes.vocoderBandCount);
    nodes.vocoderBandSpread = normalizeVocoderBandSpread(
      pendingVocoderBandSpread.get(deckId) ?? vocoderBandSpread
    );
    setChannelVocoderBandSpread(nodes.vocoder, nodes.vocoderBandSpread);
    nodes.vocoderAttackMs = normalizeVocoderAttackMs(
      pendingVocoderAttackMs.get(deckId) ?? vocoderAttackMs
    );
    setChannelVocoderAttackMs(nodes.vocoder, nodes.vocoderAttackMs);
    nodes.vocoderReleaseMs = normalizeVocoderReleaseMs(
      pendingVocoderReleaseMs.get(deckId) ?? vocoderReleaseMs
    );
    setChannelVocoderReleaseMs(nodes.vocoder, nodes.vocoderReleaseMs);
    nodes.vocoderNoiseMix = normalizeVocoderNoiseMix(
      pendingVocoderNoiseMix.get(deckId) ?? vocoderNoiseMix
    );
    setChannelVocoderNoiseMix(nodes.vocoder, nodes.vocoderNoiseMix);
    nodes.vocoderGateThreshold = normalizeVocoderGateThreshold(
      pendingVocoderGateThreshold.get(deckId) ?? vocoderGateThreshold
    );
    setChannelVocoderGateThreshold(nodes.vocoder, nodes.vocoderGateThreshold);
    nodes.vocoderCarrierDeckId =
      pendingVocoderCarrierDeckId.get(deckId) ?? vocoderCarrierDeckId;
    nodes.vocoderModulatorMonitor = normalizeVocoderModulatorMonitor(
      pendingVocoderModulatorMonitor.get(deckId) ?? vocoderModulatorMonitor
    );
    setVocoderRouting(nodes, shouldRouteThroughVocoder(nodes));
    setConfiguredVocoderState(
      deckId,
      nodes.vocoderMix,
      nodes.vocoderCarrierDeckId,
      nodes.vocoderModulatorMonitor
    );
    nodes.recordExportSend.gain.value =
      (pendingRecordExportSend.get(deckId) ?? includeInRecordExport) ? 1 : 0;
    updateVocoderCarrierConnection(deckId);
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
  pendingEqMode.delete(deckId);
  pendingParametricEqBands.delete(deckId);
  pendingBalance.delete(deckId);
  pendingRearrangerPan.delete(deckId);
  pendingRearrangerPingPongAmount.delete(deckId);
  pendingRearrangerPingPongConfig.delete(deckId);
  pendingPitchShift.delete(deckId);
  pendingDelayTime.delete(deckId);
  pendingDelayFeedback.delete(deckId);
  pendingDelayMix.delete(deckId);
  pendingDelayTone.delete(deckId);
  pendingDelayPingPong.delete(deckId);
  pendingDelaySaturation.delete(deckId);
  pendingDelayDamping.delete(deckId);
  pendingDelaySafety.delete(deckId);
  pendingVocoderMix.delete(deckId);
  pendingVocoderCarrierDeckId.delete(deckId);
  pendingVocoderModulatorMonitor.delete(deckId);
  pendingVocoderModDrive.delete(deckId);
  pendingVocoderBandCount.delete(deckId);
  pendingVocoderBandSpread.delete(deckId);
  pendingVocoderAttackMs.delete(deckId);
  pendingVocoderReleaseMs.delete(deckId);
  pendingVocoderNoiseMix.delete(deckId);
  pendingVocoderGateThreshold.delete(deckId);
  pendingRecordExportSend.delete(deckId);
  return nodes;
};

export const playDeckBuffer = (
  context: AudioContext,
  output: AudioNode,
  recordExportOutput: AudioNode,
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
  eqMode: EqMode,
  eqLowGain: number,
  eqMidGain: number,
  eqHighGain: number,
  parametricEqBands: ParametricEqBand[],
  delayTime: number,
  delayFeedback: number,
  delayMix: number,
  delayTone: number,
  delayPingPong: boolean,
  delaySaturation: number,
  delayDamping: number,
  delaySafety: number,
  vocoderMix: number,
  vocoderCarrierDeckId: number | null,
  vocoderModulatorMonitor: number,
  vocoderModDrive: number,
  vocoderBandCount: number,
  vocoderBandSpread: number,
  vocoderAttackMs: number,
  vocoderReleaseMs: number,
  vocoderNoiseMix: number,
  vocoderGateThreshold: number,
  balance = defaultBalance,
  pitchShift = defaultPitchShift,
  onEnded?: DeckEndedCallback
) => {
  stopDeckPlayback(deckId, true);
  const nodes = ensureDeckNodes(
    context,
    output,
    recordExportOutput,
    deckId,
    gain,
    filterCutoff,
    highpassCutoff,
    resonance,
    eqMode,
    eqLowGain,
    eqMidGain,
    eqHighGain,
    parametricEqBands,
    pitchShift,
    balance,
    delayTime,
    delayFeedback,
    delayMix,
    delayTone,
    delayPingPong,
    delaySaturation,
    delayDamping,
    delaySafety,
    vocoderMix,
    vocoderCarrierDeckId,
    vocoderModulatorMonitor,
    vocoderModDrive,
    vocoderBandCount,
    vocoderBandSpread,
    vocoderAttackMs,
    vocoderReleaseMs,
    vocoderNoiseMix,
    vocoderGateThreshold,
    true
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
  source.connect(nodes.modulatorOutputGain);
  nodes.source = source;
  updateVocoderCarrierConnection(deckId);
  refreshDependentVocoders(deckId);
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
      refreshDependentVocoders(deckId);
    }
    onEnded?.();
  };
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
    refreshDependentVocoders(deckId);
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
    applyEqGain(nodes.eqLow, nodes.eqMode === "eq3" ? value : 0);
    pendingEqLow.delete(deckId);
  } else {
    pendingEqLow.set(deckId, value);
  }
};

export const setDeckEqMidGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyEqGain(nodes.eqMid, nodes.eqMode === "eq3" ? value : 0);
    pendingEqMid.delete(deckId);
  } else {
    pendingEqMid.set(deckId, value);
  }
};

export const setDeckEqHighGain = (deckId: number, value: number) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    applyEqGain(nodes.eqHigh, nodes.eqMode === "eq3" ? value : 0);
    pendingEqHigh.delete(deckId);
  } else {
    pendingEqHigh.set(deckId, value);
  }
};

export const setDeckEqModeValue = (deckId: number, value: EqMode) => {
  const mode: EqMode = value === "parametric" ? "parametric" : "eq3";
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.eqMode = mode;
    const low = pendingEqLow.get(deckId) ?? 0;
    const mid = pendingEqMid.get(deckId) ?? 0;
    const high = pendingEqHigh.get(deckId) ?? 0;
    applyEqGain(nodes.eqLow, mode === "eq3" ? low : 0);
    applyEqGain(nodes.eqMid, mode === "eq3" ? mid : 0);
    applyEqGain(nodes.eqHigh, mode === "eq3" ? high : 0);
    const bands = pendingParametricEqBands.get(deckId) ?? [];
    const parametricActive = applyParametricEq(nodes.parametricEq, mode, bands);
    setParametricRouting(nodes, !parametricActive);
    pendingEqMode.delete(deckId);
  } else {
    pendingEqMode.set(deckId, mode);
  }
};

export const setDeckParametricEqBandsValue = (
  deckId: number,
  bands: ParametricEqBand[]
) => {
  const normalized = normalizeParametricEqBands(bands);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    const parametricActive = applyParametricEq(nodes.parametricEq, nodes.eqMode, normalized);
    setParametricRouting(nodes, !parametricActive);
    pendingParametricEqBands.delete(deckId);
  } else {
    pendingParametricEqBands.set(deckId, normalized);
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

export const setDeckRearrangerPanValue = (deckId: number, value: number) => {
  const clamped = Math.min(Math.max(value, -1), 1);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.rearrangerPan.pan.value = clamped;
    pendingRearrangerPan.delete(deckId);
  } else {
    pendingRearrangerPan.set(deckId, clamped);
  }
};

export const setDeckRearrangerPingPongAmountValue = (deckId: number, value: number) => {
  const clamped = Math.min(Math.max(value, 0), 1);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    setRearrangerPingPongAmount(nodes.rearrangerPingPong, clamped, nodes.balance.context.currentTime);
    pendingRearrangerPingPongAmount.delete(deckId);
  } else {
    pendingRearrangerPingPongAmount.set(deckId, clamped);
  }
};

export const setDeckRearrangerPingPongConfigValue = (
  deckId: number,
  config: RearrangerPingPongConfig | null
) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    setRearrangerPingPongConfig(nodes.rearrangerPingPong, config);
    pendingRearrangerPingPongConfig.delete(deckId);
  } else {
    pendingRearrangerPingPongConfig.set(deckId, config);
  }
};

export const clearDeckRearrangerPanAutomation = (deckId: number, fromTime: number) => {
  const nodes = deckNodes.get(deckId);
  if (!nodes) return;
  nodes.rearrangerPan.pan.cancelScheduledValues(Math.max(0, fromTime));
};

export const scheduleDeckRearrangerPanValue = (
  deckId: number,
  value: number,
  atTime: number,
  rampSeconds = 0
) => {
  const nodes = deckNodes.get(deckId);
  if (!nodes) return;
  const clamped = Math.min(Math.max(value, -1), 1);
  const targetTime = Math.max(0, atTime);
  const ramp = Math.max(0, rampSeconds);
  const pan = nodes.rearrangerPan.pan;
  if (ramp <= 0.0001) {
    pan.setValueAtTime(clamped, targetTime);
    return;
  }
  pan.linearRampToValueAtTime(clamped, targetTime + ramp);
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

export const setDeckDelaySaturationValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ saturation: value }).saturation;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    const drive = mapDelaySaturationDrive(normalized);
    nodes.delaySaturationDriveL.gain.value = drive;
    nodes.delaySaturationDriveR.gain.value = drive;
    nodes.delaySaturationShapeL.curve = createSoftClipCurve(drive);
    nodes.delaySaturationShapeR.curve = createSoftClipCurve(drive);
    nodes.delaySaturationOutL.gain.value = 1 / drive;
    nodes.delaySaturationOutR.gain.value = 1 / drive;
    pendingDelaySaturation.delete(deckId);
  } else {
    pendingDelaySaturation.set(deckId, normalized);
  }
};

export const setDeckDelayDampingValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ damping: value }).damping;
  const cutoff = mapDelayDampingToCutoff(normalized);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayDampingL.frequency.value = cutoff;
    nodes.delayDampingR.frequency.value = cutoff;
    pendingDelayDamping.delete(deckId);
  } else {
    pendingDelayDamping.set(deckId, normalized);
  }
};

export const setDeckDelaySafetyValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ safety: value }).safety;
  const drive = mapDelaySafetyDrive(normalized);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delaySafetyDrive.gain.value = drive;
    nodes.delaySafetyShape.curve = createSoftClipCurve(drive);
    nodes.delaySafetyOut.gain.value = 1 / drive;
    pendingDelaySafety.delete(deckId);
  } else {
    pendingDelaySafety.set(deckId, normalized);
  }
};

export const setDeckVocoderMixValue = (deckId: number, value: number) => {
  const normalized = Math.min(Math.max(value, 0), 1);
  const nodes = deckNodes.get(deckId);
  const previous = vocoderConfig.get(deckId);
  const previousCarrierDeckId = previous?.carrierDeckId ?? nodes?.vocoderCarrierDeckId ?? null;
  if (nodes) {
    nodes.vocoderMix = normalized;
    setChannelVocoderMix(nodes.vocoder, normalized);
    setVocoderRouting(nodes, shouldRouteThroughVocoder(nodes));
    setConfiguredVocoderState(
      deckId,
      normalized,
      nodes.vocoderCarrierDeckId,
      nodes.vocoderModulatorMonitor
    );
    if (previousCarrierDeckId !== null) applyCarrierMonitorOutputGain(previousCarrierDeckId);
    if (nodes.vocoderCarrierDeckId !== null) applyCarrierMonitorOutputGain(nodes.vocoderCarrierDeckId);
    pendingVocoderMix.delete(deckId);
  } else {
    pendingVocoderMix.set(deckId, normalized);
    setConfiguredVocoderState(
      deckId,
      normalized,
      previous?.carrierDeckId ?? pendingVocoderCarrierDeckId.get(deckId) ?? null,
      previous?.modulatorMonitor ?? pendingVocoderModulatorMonitor.get(deckId) ?? 0
    );
    if (previousCarrierDeckId !== null) applyCarrierMonitorOutputGain(previousCarrierDeckId);
    const nextCarrierDeckId = vocoderConfig.get(deckId)?.carrierDeckId ?? null;
    if (nextCarrierDeckId !== null) applyCarrierMonitorOutputGain(nextCarrierDeckId);
  }
};

export const setDeckVocoderCarrierDeckIdValue = (
  deckId: number,
  value: number | null
) => {
  const normalized = value === null || value === deckId ? null : value;
  const nodes = deckNodes.get(deckId);
  const previous = vocoderConfig.get(deckId);
  const previousCarrierDeckId = previous?.carrierDeckId ?? nodes?.vocoderCarrierDeckId ?? null;
  if (nodes) {
    nodes.vocoderCarrierDeckId = normalized;
    setVocoderRouting(nodes, shouldRouteThroughVocoder(nodes));
    setConfiguredVocoderState(
      deckId,
      nodes.vocoderMix,
      normalized,
      nodes.vocoderModulatorMonitor
    );
    updateVocoderCarrierConnection(deckId);
    if (previousCarrierDeckId !== null) applyCarrierMonitorOutputGain(previousCarrierDeckId);
    if (normalized !== null) applyCarrierMonitorOutputGain(normalized);
    pendingVocoderCarrierDeckId.delete(deckId);
  } else {
    pendingVocoderCarrierDeckId.set(deckId, normalized);
    setConfiguredVocoderState(
      deckId,
      previous?.mix ?? pendingVocoderMix.get(deckId) ?? 0,
      normalized,
      previous?.modulatorMonitor ?? pendingVocoderModulatorMonitor.get(deckId) ?? 0
    );
    if (previousCarrierDeckId !== null) applyCarrierMonitorOutputGain(previousCarrierDeckId);
    if (normalized !== null) applyCarrierMonitorOutputGain(normalized);
  }
};

export const setDeckVocoderModulatorMonitorValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderModulatorMonitor(value);
  const nodes = deckNodes.get(deckId);
  const previous = vocoderConfig.get(deckId);
  const carrierDeckId = previous?.carrierDeckId ?? nodes?.vocoderCarrierDeckId ?? null;
  if (nodes) {
    nodes.vocoderModulatorMonitor = normalized;
    setConfiguredVocoderState(
      deckId,
      nodes.vocoderMix,
      nodes.vocoderCarrierDeckId,
      normalized
    );
    if (carrierDeckId !== null) applyCarrierMonitorOutputGain(carrierDeckId);
    pendingVocoderModulatorMonitor.delete(deckId);
  } else {
    pendingVocoderModulatorMonitor.set(deckId, normalized);
    setConfiguredVocoderState(
      deckId,
      previous?.mix ?? pendingVocoderMix.get(deckId) ?? 0,
      previous?.carrierDeckId ?? pendingVocoderCarrierDeckId.get(deckId) ?? null,
      normalized
    );
    if (carrierDeckId !== null) applyCarrierMonitorOutputGain(carrierDeckId);
  }
};

export const setDeckVocoderModDriveValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderModDrive(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderModDrive = normalized;
    setChannelVocoderModDrive(nodes.vocoder, normalized);
    pendingVocoderModDrive.delete(deckId);
  } else {
    pendingVocoderModDrive.set(deckId, normalized);
  }
};

export const setDeckVocoderBandCountValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderBandCount(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderBandCount = normalized;
    setChannelVocoderBandCount(nodes.vocoder, normalized);
    pendingVocoderBandCount.delete(deckId);
  } else {
    pendingVocoderBandCount.set(deckId, normalized);
  }
};

export const setDeckVocoderBandSpreadValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderBandSpread(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderBandSpread = normalized;
    setChannelVocoderBandSpread(nodes.vocoder, normalized);
    pendingVocoderBandSpread.delete(deckId);
  } else {
    pendingVocoderBandSpread.set(deckId, normalized);
  }
};

export const setDeckVocoderAttackMsValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderAttackMs(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderAttackMs = normalized;
    setChannelVocoderAttackMs(nodes.vocoder, normalized);
    pendingVocoderAttackMs.delete(deckId);
  } else {
    pendingVocoderAttackMs.set(deckId, normalized);
  }
};

export const setDeckVocoderReleaseMsValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderReleaseMs(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderReleaseMs = normalized;
    setChannelVocoderReleaseMs(nodes.vocoder, normalized);
    pendingVocoderReleaseMs.delete(deckId);
  } else {
    pendingVocoderReleaseMs.set(deckId, normalized);
  }
};

export const setDeckVocoderNoiseMixValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderNoiseMix(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderNoiseMix = normalized;
    setChannelVocoderNoiseMix(nodes.vocoder, normalized);
    pendingVocoderNoiseMix.delete(deckId);
  } else {
    pendingVocoderNoiseMix.set(deckId, normalized);
  }
};

export const setDeckVocoderGateThresholdValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderGateThreshold(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderGateThreshold = normalized;
    setChannelVocoderGateThreshold(nodes.vocoder, normalized);
    pendingVocoderGateThreshold.delete(deckId);
  } else {
    pendingVocoderGateThreshold.set(deckId, normalized);
  }
};

export const setDeckRecordExportSendValue = (deckId: number, active: boolean) => {
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.recordExportSend.gain.value = active ? 1 : 0;
    pendingRecordExportSend.delete(deckId);
  } else {
    pendingRecordExportSend.set(deckId, active);
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
  const configured = vocoderConfig.get(deckId);
  const configuredCarrierDeckId = configured?.carrierDeckId ?? null;
  if (nodes) {
    if (nodes.source) {
      nodes.source.onended = null;
    }
    nodes.source?.stop();
    nodes.source?.disconnect();
    disposePitchShift(nodes.pitchShift);
    disposeRearrangerPingPong(nodes.rearrangerPingPong);
    nodes.highpass.disconnect();
    nodes.lowpass.disconnect();
    nodes.eqLow.forEach((node) => node.disconnect());
    nodes.eqMid.forEach((node) => node.disconnect());
    nodes.eqHigh.forEach((node) => node.disconnect());
    nodes.parametricEq.forEach((node) => node.disconnect());
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
    nodes.delayDampingL.disconnect();
    nodes.delayDampingR.disconnect();
    nodes.delaySaturationDriveL.disconnect();
    nodes.delaySaturationDriveR.disconnect();
    nodes.delaySaturationShapeL.disconnect();
    nodes.delaySaturationShapeR.disconnect();
    nodes.delaySaturationOutL.disconnect();
    nodes.delaySaturationOutR.disconnect();
    nodes.delaySafetyDrive.disconnect();
    nodes.delaySafetyShape.disconnect();
    nodes.delaySafetyOut.disconnect();
    disposeChannelVocoder(nodes.vocoder);
    nodes.postEq.disconnect();
    nodes.gain.disconnect();
    nodes.recordExportSend.disconnect();
    nodes.modulatorOutputGain.disconnect();
    nodes.limiter.disconnect();
    nodes.clipper.disconnect();
    nodes.balance.disconnect();
    nodes.rearrangerPan.disconnect();
    unregisterCarrierDependent(nodes.vocoderCarrierConnectedDeckId, deckId);
    deckNodes.delete(deckId);
  }
  vocoderConfig.delete(deckId);
  deckPlayback.delete(deckId);
  pendingGains.delete(deckId);
  pendingPlaybackRates.delete(deckId);
  pendingFilters.delete(deckId);
  pendingHighpass.delete(deckId);
  pendingResonance.delete(deckId);
  pendingEqLow.delete(deckId);
  pendingEqMid.delete(deckId);
  pendingEqHigh.delete(deckId);
  pendingEqMode.delete(deckId);
  pendingParametricEqBands.delete(deckId);
  pendingBalance.delete(deckId);
  pendingRearrangerPan.delete(deckId);
  pendingRearrangerPingPongAmount.delete(deckId);
  pendingRearrangerPingPongConfig.delete(deckId);
  pendingPitchShift.delete(deckId);
  pendingDelayTime.delete(deckId);
  pendingDelayFeedback.delete(deckId);
  pendingDelayMix.delete(deckId);
  pendingDelayTone.delete(deckId);
  pendingDelayPingPong.delete(deckId);
  pendingDelaySaturation.delete(deckId);
  pendingDelayDamping.delete(deckId);
  pendingDelaySafety.delete(deckId);
  pendingVocoderMix.delete(deckId);
  pendingVocoderCarrierDeckId.delete(deckId);
  pendingVocoderModulatorMonitor.delete(deckId);
  pendingVocoderModDrive.delete(deckId);
  pendingVocoderBandCount.delete(deckId);
  pendingVocoderBandSpread.delete(deckId);
  pendingVocoderAttackMs.delete(deckId);
  pendingVocoderReleaseMs.delete(deckId);
  pendingVocoderNoiseMix.delete(deckId);
  pendingVocoderGateThreshold.delete(deckId);
  pendingRecordExportSend.delete(deckId);
  if (configuredCarrierDeckId !== null) {
    applyCarrierMonitorOutputGain(configuredCarrierDeckId);
  }
  refreshDependentVocoders(deckId);
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
  const clampedRate = Math.min(Math.max(playbackRate, 0), 16);

  const playback = deckPlayback.get(deckId);
  if (nodes?.source) {
    nodes.source.playbackRate.value = clampedRate;
  } else {
    pendingPlaybackRates.set(deckId, clampedRate);
  }

  if (playback && currentTime !== undefined) {
    const position = playback.playing
      ? getDeckPlaybackPosition(deckId, currentTime)
      : playback.offsetSeconds;
    const nextOffset = Math.min(
      Math.max(0, position ?? playback.offsetSeconds),
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
