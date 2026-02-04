type BalanceAutomation = {
  active: boolean;
  samples: Float32Array;
  durationSec: number;
};

export type BalanceOfflineParams = {
  balance: number;
  renderDuration: number;
  automation?: BalanceAutomation;
};

const scheduleLoopedSamples = (
  samples: Float32Array,
  durationSec: number,
  renderDuration: number,
  onValue: (value: number, time: number) => void
) => {
  if (!durationSec || samples.length === 0 || renderDuration <= 0) return;
  const sampleRate = samples.length / durationSec;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
  const totalSteps = Math.max(1, Math.ceil(renderDuration * sampleRate));
  for (let i = 0; i < totalSteps; i += 1) {
    const time = i / sampleRate;
    const value = samples[i % samples.length] ?? 0;
    onValue(value, time);
  }
};

export const applyBalanceOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: BalanceOfflineParams
) => {
  const needsBalance =
    Math.abs(params.balance) >= 0.001 || params.automation?.active === true;
  if (!needsBalance) {
    return input;
  }
  const node = context.createStereoPanner();
  node.pan.value = params.balance;
  if (params.automation?.active && params.automation.durationSec > 0) {
    scheduleLoopedSamples(
      params.automation.samples,
      params.automation.durationSec,
      params.renderDuration,
      (value, time) => {
        node.pan.setValueAtTime(value, time);
      }
    );
  }
  input.connect(node);
  return node;
};
