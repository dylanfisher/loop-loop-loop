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
  createAbsCurve,
  createSoftClipCurve,
  createThresholdCurve,
  mapDelayDampingToCutoff,
  mapDelayDiffusionSettings,
  mapDelaySafetyFeedbackMultiplier,
  mapDelaySafetyOutputTrim,
  mapDuckResponseToFollowerCutoff,
  mapDelaySaturationDrive,
  normalizeDelayParams,
} from "./effects/delay";
import {
  computeParametricEqCompensationGain,
  fitParametricEqBandsToCurve,
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
  normalizeVocoderVocalCharacter,
  normalizeVocoderFormantShift,
  normalizeVocoderConsonantBoost,
  normalizeVocoderPreEmphasis,
  normalizeVocoderTightness,
  normalizeVocoderGateThreshold,
  setChannelVocoderCarrierActive,
  setChannelVocoderGateThreshold,
  setChannelVocoderModDrive,
  setChannelVocoderAttackMs,
  setChannelVocoderBandCount,
  setChannelVocoderBandSpread,
  setChannelVocoderVocalCharacter,
  setChannelVocoderFormantShift,
  setChannelVocoderConsonantBoost,
  setChannelVocoderPreEmphasis,
  setChannelVocoderTightness,
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
  delaySafetyCompressor: DynamicsCompressorNode;
  delaySafetyOut: GainNode;
  delayDuckGain: GainNode;
  delayDuckRectifier: WaveShaperNode;
  delayDuckFollower: BiquadFilterNode;
  delayDuckThreshold: WaveShaperNode;
  delayDuckDepth: GainNode;
  delayPitchL: PitchShiftNodes;
  delayPitchR: PitchShiftNodes;
  delayDiffusionL1: BiquadFilterNode;
  delayDiffusionL2: BiquadFilterNode;
  delayDiffusionR1: BiquadFilterNode;
  delayDiffusionR2: BiquadFilterNode;
  delayDiffusionDryL: GainNode;
  delayDiffusionDryR: GainNode;
  delayDiffusionWetL: GainNode;
  delayDiffusionWetR: GainNode;
  delayDiffusionMergeL: GainNode;
  delayDiffusionMergeR: GainNode;
  delayRhythmLfo: OscillatorNode;
  delayRhythmDepthL: GainNode;
  delayRhythmDepthR: GainNode;
  delayRhythmBaseTime: number;
  delayPitchStepSemitones: number;
  delayRhythmMorph: number;
  delayRhythmSwing: number;
  delayFeedbackValue: number;
  delaySafetyValue: number;
  delaySpectralInput: GainNode;
  delaySpectralDryComp: GainNode;
  delaySpectralWet: GainNode;
  delaySpectralFilters: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
  delaySpectralDelays: [DelayNode, DelayNode, DelayNode];
  delaySpectralFeedback: [GainNode, GainNode, GainNode];
  delaySpectralTone: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
  delaySpectralPanners: [StereoPannerNode, StereoPannerNode, StereoPannerNode];
  delayPingPong: boolean;
  delayInputUsesVocoder: boolean;
  delayActive: boolean;
  vocoderRouted: boolean;
  vocoder: ChannelVocoderNodes;
  vocoderMix: number;
  vocoderCarrierDeckId: number | null;
  vocoderModulatorMonitor: number;
  vocoderModDrive: number;
  vocoderBandCount: number;
  vocoderBandSpread: number;
  vocoderVocalCharacter: number;
  vocoderFormantShift: number;
  vocoderConsonantBoost: number;
  vocoderPreEmphasis: number;
  vocoderTightness: number;
  vocoderAttackMs: number;
  vocoderReleaseMs: number;
  vocoderNoiseMix: number;
  vocoderGateThreshold: number;
  vocoderPostDelay: boolean;
  vocoderCarrierConnectedDeckId: number | null;
  vocoderCarrierSource?: AudioBufferSourceNode;
  postDelaySum: GainNode;
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
const pendingDelayRhythmMorph = new Map<number, number>();
const pendingDelayRhythmRateHz = new Map<number, number>();
const pendingDelayRhythmSwing = new Map<number, number>();
const pendingDelayDuckDepth = new Map<number, number>();
const pendingDelayDuckThreshold = new Map<number, number>();
const pendingDelayDuckResponseMs = new Map<number, number>();
const pendingDelaySpectralMix = new Map<number, number>();
const pendingDelaySpectralSpread = new Map<number, number>();
const pendingVocoderMix = new Map<number, number>();
const pendingVocoderCarrierDeckId = new Map<number, number | null>();
const pendingVocoderModulatorMonitor = new Map<number, number>();
const pendingVocoderModDrive = new Map<number, number>();
const pendingVocoderBandCount = new Map<number, number>();
const pendingVocoderBandSpread = new Map<number, number>();
const pendingVocoderVocalCharacter = new Map<number, number>();
const pendingVocoderFormantShift = new Map<number, number>();
const pendingVocoderConsonantBoost = new Map<number, number>();
const pendingVocoderPreEmphasis = new Map<number, number>();
const pendingVocoderTightness = new Map<number, number>();
const pendingVocoderAttackMs = new Map<number, number>();
const pendingVocoderReleaseMs = new Map<number, number>();
const pendingVocoderNoiseMix = new Map<number, number>();
const pendingVocoderGateThreshold = new Map<number, number>();
const pendingVocoderPostDelay = new Map<number, boolean>();
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
const PARAMETRIC_EQ_SMOOTH_TIME_SEC = 0.03;
const normalizeVocoderModulatorMonitor = (value: number) => Math.min(Math.max(value, 0), 1);

const setSmoothedAudioParam = (
  param: AudioParam,
  value: number,
  now: number,
  timeConstant = PARAMETRIC_EQ_SMOOTH_TIME_SEC
) => {
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, timeConstant);
  } catch {
    param.value = value;
  }
};

const resetParametricBandNode = (node: BiquadFilterNode, now: number) => {
  node.type = "peaking";
  setSmoothedAudioParam(node.frequency, 1000, now);
  setSmoothedAudioParam(node.Q, 1, now);
  setSmoothedAudioParam(node.gain, 0, now);
};

const applyParametricEq = (
  filters: BiquadFilterNode[],
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined,
  sampleRate: number
) => {
  const isActive = hasActiveParametricEq(eqMode, bands);
  const now = filters[0]?.context.currentTime ?? 0;
  const activeBands = isActive
    ? fitParametricEqBandsToCurve(eqMode, normalizeParametricEqBands(bands), sampleRate)
    : [];
  for (let i = 0; i < filters.length; i += 1) {
    const filter = filters[i];
    const band = activeBands[i];
    if (!band || !band.enabled) {
      resetParametricBandNode(filter, now);
      continue;
    }
    filter.type = band.type;
    setSmoothedAudioParam(filter.frequency, band.frequency, now);
    setSmoothedAudioParam(filter.gain, band.gain, now);
    setSmoothedAudioParam(filter.Q, band.q, now);
  }
  return isActive;
};

const applyParametricEqOutputGain = (
  node: GainNode,
  eqMode: EqMode,
  bands: ParametricEqBand[] | undefined,
  sampleRate: number
) => {
  const now = node.context.currentTime;
  setSmoothedAudioParam(
    node.gain,
    computeParametricEqCompensationGain(eqMode, bands, sampleRate),
    now
  );
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
  nodes.delayPitchL.output.disconnect();
  nodes.delayPitchR.output.disconnect();
  nodes.delayDiffusionL1.disconnect();
  nodes.delayDiffusionL2.disconnect();
  nodes.delayDiffusionR1.disconnect();
  nodes.delayDiffusionR2.disconnect();
  nodes.delayDiffusionDryL.disconnect();
  nodes.delayDiffusionDryR.disconnect();
  nodes.delayDiffusionWetL.disconnect();
  nodes.delayDiffusionWetR.disconnect();
  nodes.delayDiffusionMergeL.disconnect();
  nodes.delayDiffusionMergeR.disconnect();
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
  nodes.delayToneL.connect(nodes.delayPitchL.input);
  nodes.delayToneR.connect(nodes.delayPitchR.input);
  nodes.delayPitchL.output.connect(nodes.delayDiffusionDryL);
  nodes.delayPitchR.output.connect(nodes.delayDiffusionDryR);
  nodes.delayDiffusionDryL.connect(nodes.delayDiffusionMergeL);
  nodes.delayDiffusionDryR.connect(nodes.delayDiffusionMergeR);
  nodes.delayPitchL.output.connect(nodes.delayDiffusionL1);
  nodes.delayPitchR.output.connect(nodes.delayDiffusionR1);
  nodes.delayDiffusionL1.connect(nodes.delayDiffusionL2);
  nodes.delayDiffusionR1.connect(nodes.delayDiffusionR2);
  nodes.delayDiffusionL2.connect(nodes.delayDiffusionWetL);
  nodes.delayDiffusionR2.connect(nodes.delayDiffusionWetR);
  nodes.delayDiffusionWetL.connect(nodes.delayDiffusionMergeL);
  nodes.delayDiffusionWetR.connect(nodes.delayDiffusionMergeR);
  nodes.delayDiffusionMergeL.connect(nodes.delayDampingL);
  nodes.delayDiffusionMergeR.connect(nodes.delayDampingR);
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

const updateDelayRhythmModulation = (
  nodes: DeckNodes,
  baseTime: number,
  morph: number,
  swing: number
) => {
  nodes.delayRhythmBaseTime = baseTime;
  nodes.delayRhythmMorph = morph;
  nodes.delayRhythmSwing = swing;
  nodes.delayL.delayTime.value = Math.max(0.01, Math.min(1.5, baseTime));
  nodes.delayR.delayTime.value = Math.max(0.01, Math.min(1.5, baseTime));
  nodes.delayRhythmDepthL.gain.value = 0;
  nodes.delayRhythmDepthR.gain.value = 0;

  const pitchMix = Math.min(Math.max(morph, 0), 1);
  const stepSemitones = Math.min(Math.max(nodes.delayPitchStepSemitones, -12), 12);
  const canPitchShift = Boolean(nodes.delayPitchL.worklet && nodes.delayPitchR.worklet);
  if (canPitchShift && pitchMix > 1e-3 && Math.abs(stepSemitones) > 1e-3) {
    setPitchShift(nodes.delayPitchL, stepSemitones);
    setPitchShift(nodes.delayPitchR, stepSemitones);
    nodes.delayPitchL.dryGain.gain.value = 1 - pitchMix;
    nodes.delayPitchL.wetGain.gain.value = pitchMix;
    nodes.delayPitchR.dryGain.gain.value = 1 - pitchMix;
    nodes.delayPitchR.wetGain.gain.value = pitchMix;
  } else {
    setPitchShift(nodes.delayPitchL, 0);
    setPitchShift(nodes.delayPitchR, 0);
    nodes.delayPitchL.dryGain.gain.value = 1;
    nodes.delayPitchL.wetGain.gain.value = 0;
    nodes.delayPitchR.dryGain.gain.value = 1;
    nodes.delayPitchR.wetGain.gain.value = 0;
  }

  const diffusion = mapDelayDiffusionSettings(swing);
  nodes.delayDiffusionL1.type = "allpass";
  nodes.delayDiffusionL2.type = "allpass";
  nodes.delayDiffusionR1.type = "allpass";
  nodes.delayDiffusionR2.type = "allpass";
  nodes.delayDiffusionL1.frequency.value = diffusion.frequency;
  nodes.delayDiffusionL2.frequency.value = diffusion.frequency * 1.31;
  nodes.delayDiffusionR1.frequency.value = diffusion.frequency * 1.17;
  nodes.delayDiffusionR2.frequency.value = diffusion.frequency * 1.53;
  nodes.delayDiffusionL1.Q.value = diffusion.q;
  nodes.delayDiffusionL2.Q.value = diffusion.q;
  nodes.delayDiffusionR1.Q.value = diffusion.q;
  nodes.delayDiffusionR2.Q.value = diffusion.q;
  nodes.delayDiffusionDryL.gain.value = diffusion.dry;
  nodes.delayDiffusionDryR.gain.value = diffusion.dry;
  nodes.delayDiffusionWetL.gain.value = diffusion.wet;
  nodes.delayDiffusionWetR.gain.value = diffusion.wet;
};

const updateDelaySpectralSettings = (
  nodes: DeckNodes,
  baseTime: number,
  feedback: number,
  safety: number,
  tone: number,
  spectralMix: number,
  spectralSpread: number
) => {
  const normalizedFeedback = Number.isFinite(feedback) ? feedback : 0;
  const normalizedSafety = Number.isFinite(safety) ? safety : 0;
  const feedbackWithSafety =
    normalizedFeedback * mapDelaySafetyFeedbackMultiplier(normalizedSafety);
  const spread = Math.min(Math.max(spectralSpread, 0), 1);
  nodes.delaySpectralDryComp.gain.value = 1 - spectralMix;
  nodes.delaySpectralWet.gain.value = spectralMix;

  const lowTime = Math.max(0.01, Math.min(1.5, baseTime * (1.3 + spread * 0.9)));
  const midTime = Math.max(0.01, Math.min(1.5, baseTime));
  const highTime = Math.max(0.01, Math.min(1.5, baseTime * (0.7 - spread * 0.3)));
  nodes.delaySpectralDelays[0].delayTime.value = lowTime;
  nodes.delaySpectralDelays[1].delayTime.value = midTime;
  nodes.delaySpectralDelays[2].delayTime.value = highTime;
  nodes.delaySpectralFeedback[0].gain.value = Math.max(
    0,
    Math.min(0.99, feedbackWithSafety * (0.95 + spread * 0.04))
  );
  nodes.delaySpectralFeedback[1].gain.value = Math.max(0, Math.min(0.99, feedbackWithSafety));
  nodes.delaySpectralFeedback[2].gain.value = Math.max(
    0,
    Math.min(0.99, feedbackWithSafety * (0.85 - spread * 0.1))
  );

  const panAmount = 0.1 + spread * 0.8;
  nodes.delaySpectralPanners[0].pan.value = -panAmount;
  nodes.delaySpectralPanners[1].pan.value = 0;
  nodes.delaySpectralPanners[2].pan.value = panAmount;

  nodes.delaySpectralTone[0].frequency.value = Math.max(400, Math.min(12000, tone * 0.7));
  nodes.delaySpectralTone[1].frequency.value = Math.max(400, Math.min(12000, tone));
  nodes.delaySpectralTone[2].frequency.value = Math.max(400, Math.min(12000, tone * 1.15));
};

const applyDelayFeedbackSafety = (nodes: DeckNodes, feedback: number, safety: number) => {
  const normalizedFeedback = Number.isFinite(feedback) ? feedback : 0;
  const normalizedSafety = Number.isFinite(safety) ? safety : 0;
  const gain = Math.max(
    0,
    Math.min(0.99, normalizedFeedback * mapDelaySafetyFeedbackMultiplier(normalizedSafety))
  );
  nodes.delayFeedbackL.gain.value = gain;
  nodes.delayFeedbackR.gain.value = gain;
};

const getDelayRoutingSource = (nodes: DeckNodes) =>
  nodes.vocoderRouted && !nodes.vocoderPostDelay ? nodes.vocoder.output : nodes.postEq;

const setDelayRouting = (nodes: DeckNodes, active: boolean) => {
  if (nodes.delayActive === active) return;
  const previousSource = nodes.delayInputUsesVocoder ? nodes.vocoder.output : nodes.postEq;
  const source = getDelayRoutingSource(nodes);
  const nextUsesVocoder = nodes.vocoderRouted && !nodes.vocoderPostDelay;
  if (nodes.delayActive) {
    safeDisconnect(previousSource, nodes.delaySplit);
    safeDisconnect(previousSource, nodes.delayDuckRectifier);
    try {
      nodes.delayDuckDepth.disconnect(nodes.delayDuckGain.gain);
    } catch {
      // ignore when edge is already disconnected
    }
    safeDisconnect(nodes.delayDuckGain, nodes.delayWet);
  }
  if (active) {
    source.connect(nodes.delaySplit);
    source.connect(nodes.delayDuckRectifier);
    nodes.delayDuckDepth.connect(nodes.delayDuckGain.gain);
    nodes.delayDuckGain.connect(nodes.delayWet);
  }
  nodes.delayInputUsesVocoder = nextUsesVocoder;
  nodes.delayActive = active;
};

const applyDelaySafetyCompressor = (
  compressor: DynamicsCompressorNode,
  safety: number
) => {
  const amount = Math.min(Math.max(safety, 0), 1);
  if (amount <= 1e-4) {
    compressor.threshold.value = 0;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.08;
    return;
  }
  // Tuned to engage audibly across typical loop levels while remaining cleaner than clipping.
  compressor.threshold.value = -12 - amount * 36;
  compressor.knee.value = 6 + amount * 24;
  compressor.ratio.value = 1 + amount * 19;
  compressor.attack.value = 0.001 + (1 - amount) * 0.004;
  compressor.release.value = 0.04 + (1 - amount) * 0.12;
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
    if (nodes.vocoderPostDelay) {
      safeDisconnect(nodes.postDelaySum, nodes.vocoder.carrierInput);
      safeDisconnect(nodes.vocoder.output, nodes.gain);
    } else {
      safeDisconnect(nodes.postEq, nodes.vocoder.carrierInput);
      safeDisconnect(nodes.vocoder.output, nodes.delayDry);
    }
  } else {
    safeDisconnect(nodes.postEq, nodes.delayDry);
    if (nodes.vocoderPostDelay) {
      safeDisconnect(nodes.postDelaySum, nodes.gain);
    }
  }
  if (active) {
    if (nodes.vocoderPostDelay) {
      safeDisconnect(nodes.postDelaySum, nodes.gain);
      nodes.postDelaySum.connect(nodes.vocoder.carrierInput);
      nodes.vocoder.output.connect(nodes.gain);
    } else {
      nodes.postEq.connect(nodes.vocoder.carrierInput);
      nodes.vocoder.output.connect(nodes.delayDry);
    }
  } else {
    if (nodes.vocoderPostDelay) {
      nodes.postDelaySum.connect(nodes.gain);
    }
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
  delayRhythmMorph: number,
  delayRhythmRateHz: number,
  delayRhythmSwing: number,
  delayDuckDepth: number,
  delayDuckThreshold: number,
  delayDuckResponseMs: number,
  delaySpectralMix: number,
  delaySpectralSpread: number,
  vocoderMix: number,
  vocoderCarrierDeckId: number | null,
  vocoderModulatorMonitor: number,
  vocoderModDrive: number,
  vocoderBandCount: number,
  vocoderBandSpread: number,
  vocoderVocalCharacter: number,
  vocoderFormantShift: number,
  vocoderConsonantBoost: number,
  vocoderPreEmphasis: number,
  vocoderTightness: number,
  vocoderAttackMs: number,
  vocoderReleaseMs: number,
  vocoderNoiseMix: number,
  vocoderGateThreshold: number,
  vocoderPostDelay: boolean,
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
    rhythmMorph: delayRhythmMorph,
    rhythmRateHz: delayRhythmRateHz,
    rhythmSwing: delayRhythmSwing,
    duckDepth: delayDuckDepth,
    duckThreshold: delayDuckThreshold,
    duckResponseMs: delayDuckResponseMs,
    spectralMix: delaySpectralMix,
    spectralSpread: delaySpectralSpread,
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
    const parametricActive = applyParametricEq(
      parametricEq,
      resolvedEqMode,
      resolvedParametricBands,
      context.sampleRate
    );
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
    const delaySafetyCompressor = context.createDynamicsCompressor();
    const delaySafetyOut = context.createGain();
    const delayDuckGain = context.createGain();
    const delayDuckRectifier = context.createWaveShaper();
    const delayDuckFollower = context.createBiquadFilter();
    const delayDuckThreshold = context.createWaveShaper();
    const delayDuckDepth = context.createGain();
    const delayPitchL = createPitchShiftNodes(context);
    const delayPitchR = createPitchShiftNodes(context);
    const delayDiffusionL1 = context.createBiquadFilter();
    const delayDiffusionL2 = context.createBiquadFilter();
    const delayDiffusionR1 = context.createBiquadFilter();
    const delayDiffusionR2 = context.createBiquadFilter();
    const delayDiffusionDryL = context.createGain();
    const delayDiffusionDryR = context.createGain();
    const delayDiffusionWetL = context.createGain();
    const delayDiffusionWetR = context.createGain();
    const delayDiffusionMergeL = context.createGain();
    const delayDiffusionMergeR = context.createGain();
    const delayRhythmLfo = context.createOscillator();
    const delayRhythmDepthL = context.createGain();
    const delayRhythmDepthR = context.createGain();
    const delaySpectralInput = context.createGain();
    const delaySpectralDryComp = context.createGain();
    const delaySpectralWet = context.createGain();
    const delaySpectralFilters: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode] = [
      context.createBiquadFilter(),
      context.createBiquadFilter(),
      context.createBiquadFilter(),
    ];
    const delaySpectralDelays: [DelayNode, DelayNode, DelayNode] = [
      context.createDelay(2.5),
      context.createDelay(2.5),
      context.createDelay(2.5),
    ];
    const delaySpectralFeedback: [GainNode, GainNode, GainNode] = [
      context.createGain(),
      context.createGain(),
      context.createGain(),
    ];
    const delaySpectralTone: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode] = [
      context.createBiquadFilter(),
      context.createBiquadFilter(),
      context.createBiquadFilter(),
    ];
    const delaySpectralPanners: [StereoPannerNode, StereoPannerNode, StereoPannerNode] = [
      context.createStereoPanner(),
      context.createStereoPanner(),
      context.createStereoPanner(),
    ];
    delayToneL.type = "lowpass";
    delayToneR.type = "lowpass";
    delayDampingL.type = "lowpass";
    delayDampingR.type = "lowpass";
    delayDuckGain.gain.value = 1;
    delayDuckRectifier.curve = createAbsCurve();
    delayDuckFollower.type = "lowpass";
    delayDuckFollower.frequency.value = mapDuckResponseToFollowerCutoff(normalizedDelay.duckResponseMs);
    delayDuckThreshold.curve = createThresholdCurve(normalizedDelay.duckThreshold);
    delayDuckDepth.gain.value = -normalizedDelay.duckDepth;
    delayDiffusionL1.type = "allpass";
    delayDiffusionL2.type = "allpass";
    delayDiffusionR1.type = "allpass";
    delayDiffusionR2.type = "allpass";
    delayDiffusionDryL.gain.value = 1;
    delayDiffusionDryR.gain.value = 1;
    delayDiffusionWetL.gain.value = 0;
    delayDiffusionWetR.gain.value = 0;
    delayRhythmLfo.type = "sine";
    delayRhythmLfo.frequency.value = 0.25;
    delayRhythmDepthL.gain.value = 0;
    delayRhythmDepthR.gain.value = 0;
    delaySpectralFilters[0].type = "lowpass";
    delaySpectralFilters[0].frequency.value = 320;
    delaySpectralFilters[0].Q.value = 0.7;
    delaySpectralFilters[1].type = "bandpass";
    delaySpectralFilters[1].frequency.value = 1400;
    delaySpectralFilters[1].Q.value = 0.8;
    delaySpectralFilters[2].type = "highpass";
    delaySpectralFilters[2].frequency.value = 3200;
    delaySpectralFilters[2].Q.value = 0.7;
    delaySpectralTone.forEach((node) => {
      node.type = "lowpass";
    });
    const nextDelayTime = pendingDelayTime.get(deckId) ?? normalizedDelay.time;
    const nextDelayFeedback = pendingDelayFeedback.get(deckId) ?? normalizedDelay.feedback;
    const nextDelaySafety = pendingDelaySafety.get(deckId) ?? normalizedDelay.safety;
    const nextDelayFeedbackGain =
      nextDelayFeedback * mapDelaySafetyFeedbackMultiplier(nextDelaySafety);
    delayFeedbackL.gain.value = nextDelayFeedbackGain;
    delayFeedbackR.gain.value = nextDelayFeedbackGain;
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
    applyDelaySafetyCompressor(delaySafetyCompressor, nextDelaySafety);
    delaySafetyOut.gain.value = mapDelaySafetyOutputTrim(nextDelaySafety);
    const nextDelayRhythmMorph = pendingDelayRhythmMorph.get(deckId) ?? normalizedDelay.rhythmMorph;
    const nextDelayRhythmRateHz = pendingDelayRhythmRateHz.get(deckId) ?? normalizedDelay.rhythmRateHz;
    const nextDelayRhythmSwing = pendingDelayRhythmSwing.get(deckId) ?? normalizedDelay.rhythmSwing;
    const nextDelayDuckDepth = pendingDelayDuckDepth.get(deckId) ?? normalizedDelay.duckDepth;
    const nextDelayDuckThreshold = pendingDelayDuckThreshold.get(deckId) ?? normalizedDelay.duckThreshold;
    const nextDelayDuckResponseMs =
      pendingDelayDuckResponseMs.get(deckId) ?? normalizedDelay.duckResponseMs;
    const nextDelaySpectralMix = pendingDelaySpectralMix.get(deckId) ?? normalizedDelay.spectralMix;
    const nextDelaySpectralSpread =
      pendingDelaySpectralSpread.get(deckId) ?? normalizedDelay.spectralSpread;
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
    const nextVocoderVocalCharacter = normalizeVocoderVocalCharacter(
      pendingVocoderVocalCharacter.get(deckId) ?? vocoderVocalCharacter
    );
    const nextVocoderFormantShift = normalizeVocoderFormantShift(
      pendingVocoderFormantShift.get(deckId) ?? vocoderFormantShift
    );
    const nextVocoderConsonantBoost = normalizeVocoderConsonantBoost(
      pendingVocoderConsonantBoost.get(deckId) ?? vocoderConsonantBoost
    );
    const nextVocoderPreEmphasis = normalizeVocoderPreEmphasis(
      pendingVocoderPreEmphasis.get(deckId) ?? vocoderPreEmphasis
    );
    const nextVocoderTightness = normalizeVocoderTightness(
      pendingVocoderTightness.get(deckId) ?? vocoderTightness
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
    const nextVocoderPostDelay = pendingVocoderPostDelay.get(deckId) ?? vocoderPostDelay;
    const postEq = context.createGain();
    applyParametricEqOutputGain(postEq, resolvedEqMode, resolvedParametricBands, context.sampleRate);
    const vocoder = createChannelVocoder(context, {
      mix: nextVocoderMix,
      modDrive: nextVocoderModDrive,
      bandCount: nextVocoderBandCount,
      bandSpread: nextVocoderBandSpread,
      vocalCharacter: nextVocoderVocalCharacter,
      formantShift: nextVocoderFormantShift,
      consonantBoost: nextVocoderConsonantBoost,
      preEmphasis: nextVocoderPreEmphasis,
      tightness: nextVocoderTightness,
      attackMs: nextVocoderAttackMs,
      releaseMs: nextVocoderReleaseMs,
      noiseMix: nextVocoderNoiseMix,
      gateThreshold: nextVocoderGateThreshold,
    });
    setChannelVocoderMix(vocoder, nextVocoderMix);
    setChannelVocoderModDrive(vocoder, nextVocoderModDrive);
    setChannelVocoderBandCount(vocoder, nextVocoderBandCount);
    setChannelVocoderBandSpread(vocoder, nextVocoderBandSpread);
    setChannelVocoderVocalCharacter(vocoder, nextVocoderVocalCharacter);
    setChannelVocoderFormantShift(vocoder, nextVocoderFormantShift);
    setChannelVocoderConsonantBoost(vocoder, nextVocoderConsonantBoost);
    setChannelVocoderPreEmphasis(vocoder, nextVocoderPreEmphasis);
    setChannelVocoderTightness(vocoder, nextVocoderTightness);
    setChannelVocoderAttackMs(vocoder, nextVocoderAttackMs);
    setChannelVocoderReleaseMs(vocoder, nextVocoderReleaseMs);
    setChannelVocoderNoiseMix(vocoder, nextVocoderNoiseMix);
    setChannelVocoderGateThreshold(vocoder, nextVocoderGateThreshold);
    const deckGain = context.createGain();
    deckGain.gain.value = pendingGains.get(deckId) ?? gain;
    const postDelaySum = context.createGain();
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
    postEq.connect(delayDry);
    delaySplit.connect(delayL, 0);
    delaySplit.connect(delayR, 1);
    delayL.connect(delayMerge, 0, 0);
    delayR.connect(delayMerge, 0, 1);
    delayMerge.connect(delaySafetyCompressor);
    delaySafetyCompressor.connect(delaySafetyOut);
    delaySafetyOut.connect(delaySpectralDryComp);
    delaySpectralDryComp.connect(delayDuckGain);
    delaySafetyOut.connect(delaySpectralInput);
    for (let i = 0; i < delaySpectralFilters.length; i += 1) {
      delaySpectralInput.connect(delaySpectralFilters[i]);
      delaySpectralFilters[i].connect(delaySpectralDelays[i]);
      delaySpectralDelays[i].connect(delaySpectralTone[i]);
      delaySpectralTone[i].connect(delaySpectralPanners[i]);
      delaySpectralPanners[i].connect(delaySpectralWet);
      delaySpectralDelays[i].connect(delaySpectralFeedback[i]);
      delaySpectralFeedback[i].connect(delaySpectralDelays[i]);
    }
    delaySpectralWet.connect(delayDuckGain);
    delayDuckRectifier.connect(delayDuckFollower);
    delayDuckFollower.connect(delayDuckThreshold);
    delayDuckThreshold.connect(delayDuckDepth);
    delayRhythmLfo.connect(delayRhythmDepthL);
    delayRhythmLfo.connect(delayRhythmDepthR);
    delayRhythmDepthL.connect(delayL.delayTime);
    delayRhythmDepthR.connect(delayR.delayTime);
    delayRhythmLfo.start();
    delayWet.connect(postDelaySum);
    delayDry.connect(postDelaySum);
    postDelaySum.connect(deckGain);
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
      delaySafetyCompressor,
      delaySafetyOut,
      delayDuckGain,
      delayDuckRectifier,
      delayDuckFollower,
      delayDuckThreshold,
      delayDuckDepth,
      delayPitchL,
      delayPitchR,
      delayDiffusionL1,
      delayDiffusionL2,
      delayDiffusionR1,
      delayDiffusionR2,
      delayDiffusionDryL,
      delayDiffusionDryR,
      delayDiffusionWetL,
      delayDiffusionWetR,
      delayDiffusionMergeL,
      delayDiffusionMergeR,
      delayRhythmLfo,
      delayRhythmDepthL,
      delayRhythmDepthR,
      delayRhythmBaseTime: nextDelayTime,
      delayPitchStepSemitones: nextDelayRhythmRateHz,
      delayRhythmMorph: nextDelayRhythmMorph,
      delayRhythmSwing: nextDelayRhythmSwing,
      delayFeedbackValue: nextDelayFeedback,
      delaySafetyValue: nextDelaySafety,
      delaySpectralInput,
      delaySpectralDryComp,
      delaySpectralWet,
      delaySpectralFilters,
      delaySpectralDelays,
      delaySpectralFeedback,
      delaySpectralTone,
      delaySpectralPanners,
      delayPingPong: !nextDelayPingPong,
      delayInputUsesVocoder: false,
      delayActive: false,
      vocoderRouted: false,
      vocoder,
      vocoderMix: nextVocoderMix,
      vocoderCarrierDeckId: nextVocoderCarrierDeckId,
      vocoderModulatorMonitor: nextVocoderModulatorMonitor,
      vocoderModDrive: nextVocoderModDrive,
      vocoderBandCount: nextVocoderBandCount,
      vocoderBandSpread: nextVocoderBandSpread,
      vocoderVocalCharacter: nextVocoderVocalCharacter,
      vocoderFormantShift: nextVocoderFormantShift,
      vocoderConsonantBoost: nextVocoderConsonantBoost,
      vocoderPreEmphasis: nextVocoderPreEmphasis,
      vocoderTightness: nextVocoderTightness,
      vocoderAttackMs: nextVocoderAttackMs,
      vocoderReleaseMs: nextVocoderReleaseMs,
      vocoderNoiseMix: nextVocoderNoiseMix,
      vocoderGateThreshold: nextVocoderGateThreshold,
      vocoderPostDelay: nextVocoderPostDelay,
      vocoderCarrierConnectedDeckId: null,
      postDelaySum,
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
    if (nextVocoderPostDelay) {
      safeDisconnect(nodes.postDelaySum, nodes.gain);
    }
    setParametricRouting(nodes, !parametricActive);
    modulatorOutputGain.connect(balanceNode);
    balanceNode.connect(rearrangerPanNode);
    rearrangerPanNode.connect(rearrangerPingPongNodes.input);
    rearrangerPingPongNodes.output.connect(pitchShiftNodes.input);
    connectDelayFeedback(nodes, nextDelayPingPong);
    nodes.delayPitchStepSemitones = nextDelayRhythmRateHz;
    updateDelayRhythmModulation(nodes, nextDelayTime, nextDelayRhythmMorph, nextDelayRhythmSwing);
    nodes.delayDuckFollower.frequency.value = mapDuckResponseToFollowerCutoff(nextDelayDuckResponseMs);
    nodes.delayDuckThreshold.curve = createThresholdCurve(nextDelayDuckThreshold);
    nodes.delayDuckDepth.gain.value = -nextDelayDuckDepth;
    updateDelaySpectralSettings(
      nodes,
      nextDelayTime,
      nextDelayFeedback,
      nextDelaySafety,
      nextDelayTone,
      nextDelaySpectralMix,
      nextDelaySpectralSpread
    );
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
    const parametricActive = applyParametricEq(
      nodes.parametricEq,
      resolvedEqMode,
      resolvedParametricBands,
      context.sampleRate
    );
    applyParametricEqOutputGain(
      nodes.postEq,
      resolvedEqMode,
      resolvedParametricBands,
      context.sampleRate
    );
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
    nodes.delayFeedbackValue = normalizedDelay.feedback;
    nodes.delaySafetyValue = normalizedDelay.safety;
    applyDelayFeedbackSafety(nodes, nodes.delayFeedbackValue, nodes.delaySafetyValue);
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
    applyDelaySafetyCompressor(nodes.delaySafetyCompressor, normalizedDelay.safety);
    nodes.delaySafetyOut.gain.value = mapDelaySafetyOutputTrim(normalizedDelay.safety);
    nodes.delayPitchStepSemitones = normalizedDelay.rhythmRateHz;
    updateDelayRhythmModulation(
      nodes,
      normalizedDelay.time,
      normalizedDelay.rhythmMorph,
      normalizedDelay.rhythmSwing
    );
    nodes.delayDuckFollower.frequency.value = mapDuckResponseToFollowerCutoff(
      normalizedDelay.duckResponseMs
    );
    nodes.delayDuckThreshold.curve = createThresholdCurve(normalizedDelay.duckThreshold);
    nodes.delayDuckDepth.gain.value = -normalizedDelay.duckDepth;
    updateDelaySpectralSettings(
      nodes,
      normalizedDelay.time,
      normalizedDelay.feedback,
      normalizedDelay.safety,
      normalizedDelay.tone,
      normalizedDelay.spectralMix,
      normalizedDelay.spectralSpread
    );
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
    nodes.vocoderVocalCharacter = normalizeVocoderVocalCharacter(
      pendingVocoderVocalCharacter.get(deckId) ?? vocoderVocalCharacter
    );
    setChannelVocoderVocalCharacter(nodes.vocoder, nodes.vocoderVocalCharacter);
    nodes.vocoderFormantShift = normalizeVocoderFormantShift(
      pendingVocoderFormantShift.get(deckId) ?? vocoderFormantShift
    );
    setChannelVocoderFormantShift(nodes.vocoder, nodes.vocoderFormantShift);
    nodes.vocoderConsonantBoost = normalizeVocoderConsonantBoost(
      pendingVocoderConsonantBoost.get(deckId) ?? vocoderConsonantBoost
    );
    setChannelVocoderConsonantBoost(nodes.vocoder, nodes.vocoderConsonantBoost);
    nodes.vocoderPreEmphasis = normalizeVocoderPreEmphasis(
      pendingVocoderPreEmphasis.get(deckId) ?? vocoderPreEmphasis
    );
    setChannelVocoderPreEmphasis(nodes.vocoder, nodes.vocoderPreEmphasis);
    nodes.vocoderTightness = normalizeVocoderTightness(
      pendingVocoderTightness.get(deckId) ?? vocoderTightness
    );
    setChannelVocoderTightness(nodes.vocoder, nodes.vocoderTightness);
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
    setDeckVocoderPostDelayValue(
      deckId,
      pendingVocoderPostDelay.get(deckId) ?? vocoderPostDelay
    );
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
  pendingDelayRhythmMorph.delete(deckId);
  pendingDelayRhythmRateHz.delete(deckId);
  pendingDelayRhythmSwing.delete(deckId);
  pendingDelayDuckDepth.delete(deckId);
  pendingDelayDuckThreshold.delete(deckId);
  pendingDelayDuckResponseMs.delete(deckId);
  pendingDelaySpectralMix.delete(deckId);
  pendingDelaySpectralSpread.delete(deckId);
  pendingVocoderMix.delete(deckId);
  pendingVocoderCarrierDeckId.delete(deckId);
  pendingVocoderModulatorMonitor.delete(deckId);
  pendingVocoderModDrive.delete(deckId);
  pendingVocoderBandCount.delete(deckId);
  pendingVocoderBandSpread.delete(deckId);
  pendingVocoderVocalCharacter.delete(deckId);
  pendingVocoderFormantShift.delete(deckId);
  pendingVocoderConsonantBoost.delete(deckId);
  pendingVocoderPreEmphasis.delete(deckId);
  pendingVocoderTightness.delete(deckId);
  pendingVocoderAttackMs.delete(deckId);
  pendingVocoderReleaseMs.delete(deckId);
  pendingVocoderNoiseMix.delete(deckId);
  pendingVocoderGateThreshold.delete(deckId);
  pendingVocoderPostDelay.delete(deckId);
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
  delayRhythmMorph: number,
  delayRhythmRateHz: number,
  delayRhythmSwing: number,
  delayDuckDepth: number,
  delayDuckThreshold: number,
  delayDuckResponseMs: number,
  delaySpectralMix: number,
  delaySpectralSpread: number,
  vocoderMix: number,
  vocoderCarrierDeckId: number | null,
  vocoderModulatorMonitor: number,
  vocoderModDrive: number,
  vocoderBandCount: number,
  vocoderBandSpread: number,
  vocoderVocalCharacter: number,
  vocoderFormantShift: number,
  vocoderConsonantBoost: number,
  vocoderPreEmphasis: number,
  vocoderTightness: number,
  vocoderAttackMs: number,
  vocoderReleaseMs: number,
  vocoderNoiseMix: number,
  vocoderGateThreshold: number,
  includeInRecordExport: boolean,
  balance = defaultBalance,
  pitchShift = defaultPitchShift,
  vocoderPostDelay = false,
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
    delayRhythmMorph,
    delayRhythmRateHz,
    delayRhythmSwing,
    delayDuckDepth,
    delayDuckThreshold,
    delayDuckResponseMs,
    delaySpectralMix,
    delaySpectralSpread,
    vocoderMix,
    vocoderCarrierDeckId,
    vocoderModulatorMonitor,
    vocoderModDrive,
    vocoderBandCount,
    vocoderBandSpread,
    vocoderVocalCharacter,
    vocoderFormantShift,
    vocoderConsonantBoost,
    vocoderPreEmphasis,
    vocoderTightness,
    vocoderAttackMs,
    vocoderReleaseMs,
    vocoderNoiseMix,
    vocoderGateThreshold,
    vocoderPostDelay,
    includeInRecordExport
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
    const parametricActive = applyParametricEq(
      nodes.parametricEq,
      mode,
      bands,
      nodes.gain.context.sampleRate
    );
    applyParametricEqOutputGain(nodes.postEq, mode, bands, nodes.gain.context.sampleRate);
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
    const parametricActive = applyParametricEq(
      nodes.parametricEq,
      nodes.eqMode,
      normalized,
      nodes.gain.context.sampleRate
    );
    applyParametricEqOutputGain(
      nodes.postEq,
      nodes.eqMode,
      normalized,
      nodes.gain.context.sampleRate
    );
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
    updateDelayRhythmModulation(
      nodes,
      normalized,
      nodes.delayRhythmMorph,
      nodes.delayRhythmSwing
    );
    updateDelaySpectralSettings(
      nodes,
      normalized,
      nodes.delayFeedbackValue,
      nodes.delaySafetyValue,
      nodes.delayToneL.frequency.value,
      nodes.delaySpectralWet.gain.value,
      Math.max(0, Math.min(1, (Math.abs(nodes.delaySpectralPanners[2].pan.value) - 0.1) / 0.8))
    );
    pendingDelayTime.delete(deckId);
  } else {
    pendingDelayTime.set(deckId, normalized);
  }
};

export const setDeckDelayFeedbackValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ feedback: value }).feedback;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayFeedbackValue = normalized;
    applyDelayFeedbackSafety(nodes, nodes.delayFeedbackValue, nodes.delaySafetyValue);
    updateDelaySpectralSettings(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayFeedbackValue,
      nodes.delaySafetyValue,
      nodes.delayToneL.frequency.value,
      nodes.delaySpectralWet.gain.value,
      Math.max(0, Math.min(1, (Math.abs(nodes.delaySpectralPanners[2].pan.value) - 0.1) / 0.8))
    );
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
    updateDelaySpectralSettings(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayFeedbackValue,
      nodes.delaySafetyValue,
      normalized,
      nodes.delaySpectralWet.gain.value,
      Math.max(0, Math.min(1, (Math.abs(nodes.delaySpectralPanners[2].pan.value) - 0.1) / 0.8))
    );
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
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delaySafetyValue = normalized;
    applyDelayFeedbackSafety(nodes, nodes.delayFeedbackValue, nodes.delaySafetyValue);
    applyDelaySafetyCompressor(nodes.delaySafetyCompressor, normalized);
    nodes.delaySafetyOut.gain.value = mapDelaySafetyOutputTrim(normalized);
    updateDelaySpectralSettings(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayFeedbackValue,
      nodes.delaySafetyValue,
      nodes.delayToneL.frequency.value,
      nodes.delaySpectralWet.gain.value,
      Math.max(0, Math.min(1, (Math.abs(nodes.delaySpectralPanners[2].pan.value) - 0.1) / 0.8))
    );
    pendingDelaySafety.delete(deckId);
  } else {
    pendingDelaySafety.set(deckId, normalized);
  }
};

export const setDeckDelayRhythmMorphValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ rhythmMorph: value }).rhythmMorph;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    updateDelayRhythmModulation(
      nodes,
      nodes.delayRhythmBaseTime,
      normalized,
      nodes.delayRhythmSwing
    );
    pendingDelayRhythmMorph.delete(deckId);
  } else {
    pendingDelayRhythmMorph.set(deckId, normalized);
  }
};

export const setDeckDelayRhythmRateHzValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ rhythmRateHz: value }).rhythmRateHz;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayPitchStepSemitones = normalized;
    updateDelayRhythmModulation(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayRhythmMorph,
      nodes.delayRhythmSwing
    );
    pendingDelayRhythmRateHz.delete(deckId);
  } else {
    pendingDelayRhythmRateHz.set(deckId, normalized);
  }
};

export const setDeckDelayRhythmSwingValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ rhythmSwing: value }).rhythmSwing;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    updateDelayRhythmModulation(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayRhythmMorph,
      normalized
    );
    pendingDelayRhythmSwing.delete(deckId);
  } else {
    pendingDelayRhythmSwing.set(deckId, normalized);
  }
};

export const setDeckDelayDuckDepthValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ duckDepth: value }).duckDepth;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayDuckDepth.gain.value = -normalized;
    pendingDelayDuckDepth.delete(deckId);
  } else {
    pendingDelayDuckDepth.set(deckId, normalized);
  }
};

export const setDeckDelayDuckThresholdValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ duckThreshold: value }).duckThreshold;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayDuckThreshold.curve = createThresholdCurve(normalized);
    pendingDelayDuckThreshold.delete(deckId);
  } else {
    pendingDelayDuckThreshold.set(deckId, normalized);
  }
};

export const setDeckDelayDuckResponseMsValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ duckResponseMs: value }).duckResponseMs;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.delayDuckFollower.frequency.value = mapDuckResponseToFollowerCutoff(normalized);
    pendingDelayDuckResponseMs.delete(deckId);
  } else {
    pendingDelayDuckResponseMs.set(deckId, normalized);
  }
};

export const setDeckDelaySpectralMixValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ spectralMix: value }).spectralMix;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    updateDelaySpectralSettings(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayFeedbackValue,
      nodes.delaySafetyValue,
      nodes.delayToneL.frequency.value,
      normalized,
      Math.max(0, Math.min(1, (Math.abs(nodes.delaySpectralPanners[2].pan.value) - 0.1) / 0.8))
    );
    pendingDelaySpectralMix.delete(deckId);
  } else {
    pendingDelaySpectralMix.set(deckId, normalized);
  }
};

export const setDeckDelaySpectralSpreadValue = (deckId: number, value: number) => {
  const normalized = normalizeDelayParams({ spectralSpread: value }).spectralSpread;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    updateDelaySpectralSettings(
      nodes,
      nodes.delayRhythmBaseTime,
      nodes.delayFeedbackValue,
      nodes.delaySafetyValue,
      nodes.delayToneL.frequency.value,
      nodes.delaySpectralWet.gain.value,
      normalized
    );
    pendingDelaySpectralSpread.delete(deckId);
  } else {
    pendingDelaySpectralSpread.set(deckId, normalized);
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

export const setDeckVocoderVocalCharacterValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderVocalCharacter(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderVocalCharacter = normalized;
    setChannelVocoderVocalCharacter(nodes.vocoder, normalized);
    pendingVocoderVocalCharacter.delete(deckId);
  } else {
    pendingVocoderVocalCharacter.set(deckId, normalized);
  }
};

export const setDeckVocoderFormantShiftValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderFormantShift(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderFormantShift = normalized;
    setChannelVocoderFormantShift(nodes.vocoder, normalized);
    pendingVocoderFormantShift.delete(deckId);
  } else {
    pendingVocoderFormantShift.set(deckId, normalized);
  }
};

export const setDeckVocoderConsonantBoostValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderConsonantBoost(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderConsonantBoost = normalized;
    setChannelVocoderConsonantBoost(nodes.vocoder, normalized);
    pendingVocoderConsonantBoost.delete(deckId);
  } else {
    pendingVocoderConsonantBoost.set(deckId, normalized);
  }
};

export const setDeckVocoderPreEmphasisValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderPreEmphasis(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderPreEmphasis = normalized;
    setChannelVocoderPreEmphasis(nodes.vocoder, normalized);
    pendingVocoderPreEmphasis.delete(deckId);
  } else {
    pendingVocoderPreEmphasis.set(deckId, normalized);
  }
};

export const setDeckVocoderTightnessValue = (deckId: number, value: number) => {
  const normalized = normalizeVocoderTightness(value);
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    nodes.vocoderTightness = normalized;
    setChannelVocoderTightness(nodes.vocoder, normalized);
    pendingVocoderTightness.delete(deckId);
  } else {
    pendingVocoderTightness.set(deckId, normalized);
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

export const setDeckVocoderPostDelayValue = (deckId: number, value: boolean) => {
  const normalized = value === true;
  const nodes = deckNodes.get(deckId);
  if (nodes) {
    if (nodes.vocoderPostDelay !== normalized) {
      const wasActive = shouldRouteThroughVocoder(nodes);
      if (wasActive) {
        setVocoderRouting(nodes, false);
      }
      nodes.vocoderPostDelay = normalized;
      if (wasActive) {
        setVocoderRouting(nodes, true);
      } else {
        safeDisconnect(nodes.postEq, nodes.delayDry);
        if (normalized) {
          safeDisconnect(nodes.postDelaySum, nodes.gain);
          safeDisconnect(nodes.postDelaySum, nodes.vocoder.carrierInput);
          safeDisconnect(nodes.vocoder.output, nodes.gain);
          nodes.postEq.connect(nodes.delayDry);
          nodes.postDelaySum.connect(nodes.gain);
        } else {
          safeDisconnect(nodes.postDelaySum, nodes.gain);
          nodes.postEq.connect(nodes.delayDry);
          nodes.postDelaySum.connect(nodes.gain);
        }
      }
    }
    pendingVocoderPostDelay.delete(deckId);
  } else {
    pendingVocoderPostDelay.set(deckId, normalized);
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
    nodes.delaySafetyCompressor.disconnect();
    nodes.delaySafetyOut.disconnect();
    nodes.delayDuckGain.disconnect();
    nodes.delayDuckRectifier.disconnect();
    nodes.delayDuckFollower.disconnect();
    nodes.delayDuckThreshold.disconnect();
    nodes.delayDuckDepth.disconnect();
    disposePitchShift(nodes.delayPitchL);
    disposePitchShift(nodes.delayPitchR);
    nodes.delayDiffusionL1.disconnect();
    nodes.delayDiffusionL2.disconnect();
    nodes.delayDiffusionR1.disconnect();
    nodes.delayDiffusionR2.disconnect();
    nodes.delayDiffusionDryL.disconnect();
    nodes.delayDiffusionDryR.disconnect();
    nodes.delayDiffusionWetL.disconnect();
    nodes.delayDiffusionWetR.disconnect();
    nodes.delayDiffusionMergeL.disconnect();
    nodes.delayDiffusionMergeR.disconnect();
    nodes.delayRhythmDepthL.disconnect();
    nodes.delayRhythmDepthR.disconnect();
    try {
      nodes.delayRhythmLfo.stop();
    } catch {
      // already stopped
    }
    nodes.delayRhythmLfo.disconnect();
    nodes.delaySpectralInput.disconnect();
    nodes.delaySpectralDryComp.disconnect();
    nodes.delaySpectralWet.disconnect();
    nodes.delaySpectralFilters.forEach((node) => node.disconnect());
    nodes.delaySpectralDelays.forEach((node) => node.disconnect());
    nodes.delaySpectralFeedback.forEach((node) => node.disconnect());
    nodes.delaySpectralTone.forEach((node) => node.disconnect());
    nodes.delaySpectralPanners.forEach((node) => node.disconnect());
    disposeChannelVocoder(nodes.vocoder);
    nodes.postEq.disconnect();
    nodes.postDelaySum.disconnect();
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
  pendingDelayRhythmMorph.delete(deckId);
  pendingDelayRhythmRateHz.delete(deckId);
  pendingDelayRhythmSwing.delete(deckId);
  pendingDelayDuckDepth.delete(deckId);
  pendingDelayDuckThreshold.delete(deckId);
  pendingDelayDuckResponseMs.delete(deckId);
  pendingDelaySpectralMix.delete(deckId);
  pendingDelaySpectralSpread.delete(deckId);
  pendingVocoderMix.delete(deckId);
  pendingVocoderCarrierDeckId.delete(deckId);
  pendingVocoderModulatorMonitor.delete(deckId);
  pendingVocoderModDrive.delete(deckId);
  pendingVocoderBandCount.delete(deckId);
  pendingVocoderBandSpread.delete(deckId);
  pendingVocoderVocalCharacter.delete(deckId);
  pendingVocoderFormantShift.delete(deckId);
  pendingVocoderConsonantBoost.delete(deckId);
  pendingVocoderPreEmphasis.delete(deckId);
  pendingVocoderTightness.delete(deckId);
  pendingVocoderAttackMs.delete(deckId);
  pendingVocoderReleaseMs.delete(deckId);
  pendingVocoderNoiseMix.delete(deckId);
  pendingVocoderGateThreshold.delete(deckId);
  pendingVocoderPostDelay.delete(deckId);
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
