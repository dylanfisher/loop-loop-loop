export type BpmResult = {
  bpm: number | null;
  confidence: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const estimateBpmFromSamples = (
  samples: Float32Array,
  sampleRate: number
): BpmResult => {
  if (!samples || samples.length === 0) {
    return { bpm: null, confidence: 0 };
  }

  const targetRate = 11025;
  const downsampleFactor = Math.max(1, Math.round(sampleRate / targetRate));
  const hopSize = 1024;
  const frameSize = hopSize * downsampleFactor;
  const envelope: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < i + frameSize; j += downsampleFactor) {
      sum += Math.abs(samples[j]);
      count += 1;
    }
    envelope.push(count > 0 ? sum / count : 0);
  }

  if (envelope.length < 8) {
    return { bpm: null, confidence: 0 };
  }

  const mean = envelope.reduce((acc, value) => acc + value, 0) / envelope.length;
  const centered = envelope.map((value) => value - mean);
  const envelopeRate = sampleRate / frameSize;

  const minBpm = 60;
  const maxBpm = 200;
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * envelopeRate));
  const maxLag = Math.min(
    centered.length - 2,
    Math.floor((60 / minBpm) * envelopeRate)
  );

  let bestLag = 0;
  let bestCorrelation = 0;
  let energy = 0;

  for (const value of centered) {
    energy += value * value;
  }

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i < centered.length - lag; i += 1) {
      sum += centered[i] * centered[i + lag];
    }
    if (sum > bestCorrelation) {
      bestCorrelation = sum;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || energy === 0) {
    return { bpm: null, confidence: 0 };
  }

  const bpm = clamp((60 * envelopeRate) / bestLag, minBpm, maxBpm);
  const confidence = clamp(bestCorrelation / energy, 0, 1);

  return { bpm, confidence };
};

export const estimateBpmFromBuffer = (buffer: AudioBuffer): BpmResult => {
  if (!buffer || buffer.length === 0) {
    return { bpm: null, confidence: 0 };
  }

  const channelData = buffer.getChannelData(0);
  return estimateBpmFromSamples(channelData, buffer.sampleRate);
};
