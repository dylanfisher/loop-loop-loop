export type VocoderParams = {
  mix: number;
  modDrive: number;
  bandCount: number;
  bandSpread: number;
  attackMs: number;
  releaseMs: number;
  noiseMix: number;
  gateThreshold: number;
};

type VocoderBand = {
  modFilter: BiquadFilterNode;
  rectifier: WaveShaperNode;
  attackFilter: BiquadFilterNode;
  releaseFilter: BiquadFilterNode;
  threshold: WaveShaperNode;
  envelopeGain: GainNode;
  carrierFilter: BiquadFilterNode;
  bandGain: GainNode;
  phaseLfo: OscillatorNode;
  phaseDepth: GainNode;
  centerFrequency: number;
};

type VocoderNoiseNodes = {
  source: AudioBufferSourceNode;
  colorFilter: BiquadFilterNode;
  envelopeHighpass: BiquadFilterNode;
  rectifier: WaveShaperNode;
  attackFilter: BiquadFilterNode;
  releaseFilter: BiquadFilterNode;
  threshold: WaveShaperNode;
  envelopeGain: GainNode;
  noiseGain: GainNode;
};

export type ChannelVocoderNodes = {
  // Modulator input (e.g. voice envelope source).
  input: GainNode;
  // Carrier input (tone source that is sculpted by the modulator).
  carrierInput: GainNode;
  output: GainNode;
  dry: GainNode;
  wet: GainNode;
  modDriveGain: GainNode;
  bands: VocoderBand[];
  noise: VocoderNoiseNodes;
  mix: number;
  modDrive: number;
  bandCount: number;
  bandSpread: number;
  attackMs: number;
  releaseMs: number;
  noiseMix: number;
  gateThreshold: number;
  hasCarrier: boolean;
};

const VOCODER_MIN_FREQ = 120;
const VOCODER_MAX_FREQ = 8000;
const VOCODER_Q = 8;
const VOCODER_MAX_BANDS = 24;
const VOCODER_MIN_BANDS = 4;
const VOCODER_ENVELOPE_GAIN = 8;
const VOCODER_MOD_DRIVE_MIN = 0.5;
const VOCODER_MOD_DRIVE_MAX = 10;
const VOCODER_BAND_SPREAD_MIN = 0;
const VOCODER_BAND_SPREAD_MAX = 1;
const VOCODER_ATTACK_MIN_MS = 1;
const VOCODER_ATTACK_MAX_MS = 160;
const VOCODER_RELEASE_MIN_MS = 1;
const VOCODER_RELEASE_MAX_MS = 1200;
const VOCODER_NOISE_MIX_MIN = 0;
const VOCODER_NOISE_MIX_MAX = 1;
const VOCODER_GATE_THRESHOLD_MIN = 0;
const VOCODER_GATE_THRESHOLD_MAX = 1;
const VOCODER_GATE_THRESHOLD_DEFAULT = 0.5;
const VOCODER_PHASE_LOOP_MAX_SEC = 16;
const VOCODER_PHASE_LOOP_MIN_SEC = 0.25;
const VOCODER_PHASE_DEPTH_RATIO = 0.3;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const makeAbsCurve = () => {
  const size = 2048;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.abs(x);
  }
  return curve;
};

const makeGateCurve = (threshold: number) => {
  const size = 2048;
  const curve = new Float32Array(size);
  const t = clamp(threshold, 0, 1);
  const denom = Math.max(1e-6, 1 - t);
  for (let i = 0; i < size; i += 1) {
    const x = i / (size - 1);
    const normalized = (x - t) / denom;
    curve[i] = clamp(normalized, 0, 1);
  }
  return curve;
};

const timeMsToCutoffHz = (timeMs: number) => {
  const t = Math.max(0.1, timeMs) / 1000;
  return clamp(1 / (2 * Math.PI * t), 1, 12000);
};

const getBandFrequency = (index: number, bandCount: number, spread: number) => {
  const clampedCount = Math.max(1, bandCount);
  const t = clampedCount <= 1 ? 0.5 : index / (clampedCount - 1);
  const minLog = Math.log10(VOCODER_MIN_FREQ);
  const maxLog = Math.log10(VOCODER_MAX_FREQ);
  const fullSpan = maxLog - minLog;
  const center = (minLog + maxLog) * 0.5;
  const span = fullSpan * (0.3 + 0.7 * clamp(spread, VOCODER_BAND_SPREAD_MIN, VOCODER_BAND_SPREAD_MAX));
  const low = center - span * 0.5;
  const high = center + span * 0.5;
  return Math.pow(10, low + t * (high - low));
};

const makeNoiseBuffer = (context: AudioContext | OfflineAudioContext) => {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * 2));
  const buffer = context.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
};

export const normalizeVocoderMix = (value: number) => clamp(value, 0, 1);
export const normalizeVocoderModDrive = (value: number) =>
  clamp(value, VOCODER_MOD_DRIVE_MIN, VOCODER_MOD_DRIVE_MAX);
export const normalizeVocoderBandCount = (value: number) =>
  Math.round(clamp(value, VOCODER_MIN_BANDS, VOCODER_MAX_BANDS));
export const normalizeVocoderBandSpread = (value: number) =>
  clamp(value, VOCODER_BAND_SPREAD_MIN, VOCODER_BAND_SPREAD_MAX);
export const normalizeVocoderAttackMs = (value: number) =>
  clamp(value, VOCODER_ATTACK_MIN_MS, VOCODER_ATTACK_MAX_MS);
export const normalizeVocoderReleaseMs = (value: number) =>
  clamp(value, VOCODER_RELEASE_MIN_MS, VOCODER_RELEASE_MAX_MS);
export const normalizeVocoderNoiseMix = (value: number) =>
  clamp(value, VOCODER_NOISE_MIX_MIN, VOCODER_NOISE_MIX_MAX);
export const normalizeVocoderGateThreshold = (value: number) =>
  clamp(value, VOCODER_GATE_THRESHOLD_MIN, VOCODER_GATE_THRESHOLD_MAX);

const createPhaseWave = (
  context: AudioContext | OfflineAudioContext,
  phaseRadians: number
) => {
  const real = new Float32Array(2);
  const imag = new Float32Array(2);
  real[1] = Math.sin(phaseRadians);
  imag[1] = Math.cos(phaseRadians);
  return context.createPeriodicWave(real, imag);
};

const applyBandLayout = (nodes: ChannelVocoderNodes) => {
  for (let i = 0; i < nodes.bands.length; i += 1) {
    const band = nodes.bands[i];
    if (i < nodes.bandCount) {
      const center = getBandFrequency(i, nodes.bandCount, nodes.bandSpread);
      band.centerFrequency = center;
      band.modFilter.frequency.value = center;
      band.carrierFilter.frequency.value = center;
      band.envelopeGain.gain.value = VOCODER_ENVELOPE_GAIN;
    } else {
      band.envelopeGain.gain.value = 0;
    }
  }
};

const applyEnvelopeTiming = (nodes: ChannelVocoderNodes) => {
  const attackHz = timeMsToCutoffHz(nodes.attackMs);
  const releaseHz = timeMsToCutoffHz(nodes.releaseMs);
  nodes.bands.forEach((band) => {
    band.attackFilter.frequency.value = attackHz;
    band.releaseFilter.frequency.value = releaseHz;
  });
  nodes.noise.attackFilter.frequency.value = attackHz;
  nodes.noise.releaseFilter.frequency.value = releaseHz;
};

const applyGateThreshold = (nodes: ChannelVocoderNodes) => {
  const curve = makeGateCurve(nodes.gateThreshold);
  nodes.bands.forEach((band) => {
    band.threshold.curve = curve;
  });
  nodes.noise.threshold.curve = curve;
};

const applyNoiseMix = (nodes: ChannelVocoderNodes) => {
  nodes.noise.envelopeGain.gain.value = 0;
};

const applyPhaseRotate = (nodes: ChannelVocoderNodes) => {
  const amount = normalizeVocoderNoiseMix(nodes.noiseMix);
  const active = amount > 1e-6;
  const loopDurationSec = active
    ? VOCODER_PHASE_LOOP_MAX_SEC + amount * (VOCODER_PHASE_LOOP_MIN_SEC - VOCODER_PHASE_LOOP_MAX_SEC)
    : 0;
  const rateHz = active ? 1 / Math.max(1e-4, loopDurationSec) : 0;
  for (let i = 0; i < nodes.bands.length; i += 1) {
    const band = nodes.bands[i];
    band.phaseLfo.frequency.value = rateHz;
    if (i < nodes.bandCount && active) {
      band.phaseDepth.gain.value = band.centerFrequency * VOCODER_PHASE_DEPTH_RATIO;
    } else {
      band.phaseDepth.gain.value = 0;
    }
  }
};

const applyMix = (nodes: ChannelVocoderNodes) => {
  const effectiveMix = nodes.hasCarrier ? nodes.mix : 0;
  nodes.dry.gain.value = 1 - effectiveMix;
  nodes.wet.gain.value = effectiveMix;
};

const applyTuning = (nodes: ChannelVocoderNodes) => {
  applyBandLayout(nodes);
  applyEnvelopeTiming(nodes);
  applyGateThreshold(nodes);
  applyNoiseMix(nodes);
  applyPhaseRotate(nodes);
  applyMix(nodes);
};

export const createChannelVocoder = (
  context: AudioContext | OfflineAudioContext,
  params?: Partial<VocoderParams>
): ChannelVocoderNodes => {
  const mix = normalizeVocoderMix(params?.mix ?? 0);
  const modDrive = normalizeVocoderModDrive(params?.modDrive ?? 2);
  const bandCount = normalizeVocoderBandCount(params?.bandCount ?? 12);
  const bandSpread = normalizeVocoderBandSpread(params?.bandSpread ?? 1);
  const attackMs = normalizeVocoderAttackMs(params?.attackMs ?? 8);
  const releaseMs = normalizeVocoderReleaseMs(params?.releaseMs ?? 5);
  const noiseMix = normalizeVocoderNoiseMix(params?.noiseMix ?? 0);
  const gateThreshold = normalizeVocoderGateThreshold(
    params?.gateThreshold ?? VOCODER_GATE_THRESHOLD_DEFAULT
  );

  const input = context.createGain();
  const output = context.createGain();
  const carrierInput = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const modDriveGain = context.createGain();
  modDriveGain.gain.value = modDrive;
  const rectifierCurve = makeAbsCurve();
  const bands: VocoderBand[] = [];

  input.connect(modDriveGain);
  carrierInput.connect(dry);
  dry.connect(output);
  wet.connect(output);

  for (let i = 0; i < VOCODER_MAX_BANDS; i += 1) {
    const modFilter = context.createBiquadFilter();
    modFilter.type = "bandpass";
    modFilter.Q.value = VOCODER_Q;

    const rectifier = context.createWaveShaper();
    rectifier.curve = rectifierCurve;
    rectifier.oversample = "4x";

    const attackFilter = context.createBiquadFilter();
    attackFilter.type = "lowpass";
    attackFilter.Q.value = 0.0001;

    const releaseFilter = context.createBiquadFilter();
    releaseFilter.type = "lowpass";
    releaseFilter.Q.value = 0.0001;

    const threshold = context.createWaveShaper();
    threshold.oversample = "none";

    const envelopeGain = context.createGain();

    const carrierFilter = context.createBiquadFilter();
    carrierFilter.type = "bandpass";
    carrierFilter.Q.value = VOCODER_Q;

    const bandGain = context.createGain();
    bandGain.gain.value = 0;
    const phaseLfo = context.createOscillator();
    phaseLfo.setPeriodicWave(createPhaseWave(context, (Math.PI * 2 * i) / VOCODER_MAX_BANDS));
    const phaseDepth = context.createGain();
    phaseDepth.gain.value = 0;

    modDriveGain.connect(modFilter);
    modFilter.connect(rectifier);
    rectifier.connect(attackFilter);
    attackFilter.connect(releaseFilter);
    releaseFilter.connect(threshold);
    threshold.connect(envelopeGain);
    envelopeGain.connect(bandGain.gain);

    carrierInput.connect(carrierFilter);
    carrierFilter.connect(bandGain);
    bandGain.connect(wet);
    phaseLfo.connect(phaseDepth);
    phaseDepth.connect(modFilter.frequency);
    phaseDepth.connect(carrierFilter.frequency);
    phaseLfo.start(0);

    bands.push({
      modFilter,
      rectifier,
      attackFilter,
      releaseFilter,
      threshold,
      envelopeGain,
      carrierFilter,
      bandGain,
      phaseLfo,
      phaseDepth,
      centerFrequency: 0,
    });
  }

  const noiseSource = context.createBufferSource();
  noiseSource.buffer = makeNoiseBuffer(context);
  noiseSource.loop = true;
  const noiseColorFilter = context.createBiquadFilter();
  noiseColorFilter.type = "highpass";
  noiseColorFilter.frequency.value = 4500;

  const noiseEnvHighpass = context.createBiquadFilter();
  noiseEnvHighpass.type = "highpass";
  noiseEnvHighpass.frequency.value = 3200;
  const noiseRectifier = context.createWaveShaper();
  noiseRectifier.curve = rectifierCurve;
  noiseRectifier.oversample = "4x";
  const noiseAttackFilter = context.createBiquadFilter();
  noiseAttackFilter.type = "lowpass";
  noiseAttackFilter.Q.value = 0.0001;
  const noiseReleaseFilter = context.createBiquadFilter();
  noiseReleaseFilter.type = "lowpass";
  noiseReleaseFilter.Q.value = 0.0001;
  const noiseThreshold = context.createWaveShaper();
  const noiseEnvelopeGain = context.createGain();
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0;

  modDriveGain.connect(noiseEnvHighpass);
  noiseEnvHighpass.connect(noiseRectifier);
  noiseRectifier.connect(noiseAttackFilter);
  noiseAttackFilter.connect(noiseReleaseFilter);
  noiseReleaseFilter.connect(noiseThreshold);
  noiseThreshold.connect(noiseEnvelopeGain);
  noiseEnvelopeGain.connect(noiseGain.gain);

  noiseSource.connect(noiseColorFilter);
  noiseColorFilter.connect(noiseGain);
  noiseGain.connect(wet);
  noiseSource.start(0);

  const nodes: ChannelVocoderNodes = {
    input,
    output,
    carrierInput,
    dry,
    wet,
    modDriveGain,
    bands,
    noise: {
      source: noiseSource,
      colorFilter: noiseColorFilter,
      envelopeHighpass: noiseEnvHighpass,
      rectifier: noiseRectifier,
      attackFilter: noiseAttackFilter,
      releaseFilter: noiseReleaseFilter,
      threshold: noiseThreshold,
      envelopeGain: noiseEnvelopeGain,
      noiseGain,
    },
    mix,
    modDrive,
    bandCount,
    bandSpread,
    attackMs,
    releaseMs,
    noiseMix,
    gateThreshold,
    hasCarrier: false,
  };

  applyTuning(nodes);
  return nodes;
};

export const setChannelVocoderMix = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.mix = normalizeVocoderMix(value);
  applyMix(nodes);
};

export const setChannelVocoderModDrive = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.modDrive = normalizeVocoderModDrive(value);
  nodes.modDriveGain.gain.value = nodes.modDrive;
};

export const setChannelVocoderBandCount = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.bandCount = normalizeVocoderBandCount(value);
  applyBandLayout(nodes);
  applyPhaseRotate(nodes);
};

export const setChannelVocoderBandSpread = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.bandSpread = normalizeVocoderBandSpread(value);
  applyBandLayout(nodes);
  applyPhaseRotate(nodes);
};

export const setChannelVocoderAttackMs = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.attackMs = normalizeVocoderAttackMs(value);
  applyEnvelopeTiming(nodes);
};

export const setChannelVocoderReleaseMs = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.releaseMs = normalizeVocoderReleaseMs(value);
  applyEnvelopeTiming(nodes);
};

export const setChannelVocoderNoiseMix = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.noiseMix = normalizeVocoderNoiseMix(value);
  applyNoiseMix(nodes);
  applyPhaseRotate(nodes);
};

export const setChannelVocoderGateThreshold = (nodes: ChannelVocoderNodes, value: number) => {
  nodes.gateThreshold = normalizeVocoderGateThreshold(value);
  applyGateThreshold(nodes);
};

export const setChannelVocoderCarrierActive = (nodes: ChannelVocoderNodes, active: boolean) => {
  nodes.hasCarrier = active;
  applyMix(nodes);
};

export const disposeChannelVocoder = (nodes: ChannelVocoderNodes) => {
  nodes.input.disconnect();
  nodes.output.disconnect();
  nodes.carrierInput.disconnect();
  nodes.dry.disconnect();
  nodes.wet.disconnect();
  nodes.modDriveGain.disconnect();
  try {
    nodes.noise.source.stop();
  } catch {
    // noop
  }
  nodes.noise.source.disconnect();
  nodes.noise.colorFilter.disconnect();
  nodes.noise.envelopeHighpass.disconnect();
  nodes.noise.rectifier.disconnect();
  nodes.noise.attackFilter.disconnect();
  nodes.noise.releaseFilter.disconnect();
  nodes.noise.threshold.disconnect();
  nodes.noise.envelopeGain.disconnect();
  nodes.noise.noiseGain.disconnect();
  nodes.bands.forEach((band) => {
    try {
      band.phaseLfo.stop();
    } catch {
      // noop
    }
    band.phaseLfo.disconnect();
    band.phaseDepth.disconnect();
    band.modFilter.disconnect();
    band.rectifier.disconnect();
    band.attackFilter.disconnect();
    band.releaseFilter.disconnect();
    band.threshold.disconnect();
    band.envelopeGain.disconnect();
    band.carrierFilter.disconnect();
    band.bandGain.disconnect();
  });
};
