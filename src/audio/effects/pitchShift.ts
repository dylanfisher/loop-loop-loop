import { createPitchShiftNodes, setPitchShift } from "../pitchShift";
import {
  scheduleLoopedAutomation,
  type OfflineAutomationTrack,
} from "./automation";

export type PitchShiftOfflineParams = {
  pitch: number;
  renderDuration: number;
  automation?: OfflineAutomationTrack;
};

export const applyPitchShiftOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: PitchShiftOfflineParams
) => {
  const needsPitch = Math.abs(params.pitch) >= 0.001 || params.automation?.active === true;
  if (!needsPitch) {
    return input;
  }
  const nodes = createPitchShiftNodes(context);
  setPitchShift(nodes, params.pitch);
  if (
    params.automation?.active &&
    params.automation.durationSec > 0 &&
    nodes.worklet
  ) {
    const pitchParam = nodes.worklet.parameters.get("pitch");
    if (pitchParam) {
      nodes.dryGain.gain.value = 0;
      nodes.wetGain.gain.value = 1;
      scheduleLoopedAutomation(
        params.automation.samples,
        params.automation.durationSec,
        params.renderDuration,
        (value, time) => {
          pitchParam.setValueAtTime(value, time);
        }
      );
    }
  }
  input.connect(nodes.input);
  return nodes.output;
};
