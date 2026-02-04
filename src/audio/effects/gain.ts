export type GainOfflineParams = {
  gain: number;
  bypassAt?: number;
};

const approxEqual = (value: number, target: number, epsilon = 1e-4) =>
  Math.abs(value - target) <= epsilon;

export const applyGainOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: GainOfflineParams
) => {
  const bypassAt = params.bypassAt ?? 1;
  if (approxEqual(params.gain, bypassAt)) {
    return input;
  }
  const node = context.createGain();
  node.gain.value = params.gain;
  input.connect(node);
  return node;
};
