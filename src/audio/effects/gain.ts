import {
  scheduleLoopedAutomation,
  type OfflineAutomationTrack,
} from "./automation";

export type GainOfflineParams = {
  gain: number;
  renderDuration?: number;
  automation?: OfflineAutomationTrack;
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
  const automationActive =
    params.automation?.active === true && (params.automation.durationSec ?? 0) > 0;
  if (approxEqual(params.gain, bypassAt) && !automationActive) {
    return input;
  }
  const node = context.createGain();
  node.gain.value = params.gain;
  if (automationActive && (params.renderDuration ?? 0) > 0 && params.automation) {
    scheduleLoopedAutomation(
      params.automation.samples,
      params.automation.durationSec,
      params.renderDuration ?? 0,
      (value, time) => {
        node.gain.setValueAtTime(value, time);
      }
    );
  }
  input.connect(node);
  return node;
};
