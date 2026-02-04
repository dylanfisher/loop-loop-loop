import { createPitchShiftNodes, setPitchShift } from "../pitchShift";

type PitchAutomation = {
  active: boolean;
  samples: Float32Array;
  durationSec: number;
};

export type PitchShiftOfflineParams = {
  pitch: number;
  renderDuration: number;
  automation?: PitchAutomation;
};

const scheduleLoopedPitch = (
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
      scheduleLoopedPitch(
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
