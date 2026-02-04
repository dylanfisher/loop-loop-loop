import {
  scheduleLoopedAutomation,
  type OfflineAutomationTrack,
} from "./automation";

export type BalanceOfflineParams = {
  balance: number;
  renderDuration: number;
  automation?: OfflineAutomationTrack;
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
    scheduleLoopedAutomation(
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
