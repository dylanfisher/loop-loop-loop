import {
  scheduleLoopedAutomation,
  type OfflineAutomationTrack,
} from "./automation";

export type DjFilterOfflineParams = {
  djFilter: number;
  resonance: number;
  renderDuration: number;
  djAutomation?: OfflineAutomationTrack;
  resonanceAutomation?: OfflineAutomationTrack;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getFilterTargets = (djFilter: number) => {
  const min = 60;
  const max = 20000;
  const highpassMax = 12000;
  const normalized = clamp(djFilter, -1, 1);
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const logHighMax = Math.log10(highpassMax);
  if (normalized < 0) {
    const t = 1 + normalized;
    const lowpass = Math.pow(10, logMin + t * (logMax - logMin));
    return { lowpass, highpass: min };
  }
  if (normalized > 0) {
    const t = normalized;
    const highpass = Math.pow(10, logMin + t * (logHighMax - logMin));
    return { lowpass: max, highpass };
  }
  return { lowpass: max, highpass: min };
};

export const applyDjFilterOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: DjFilterOfflineParams
) => {
  const needsFilter =
    Math.abs(params.djFilter) >= 0.001 ||
    Math.abs(params.resonance) >= 0.001 ||
    params.djAutomation?.active === true ||
    params.resonanceAutomation?.active === true;
  if (!needsFilter) {
    return input;
  }

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";

  const targets = getFilterTargets(params.djFilter);
  highpass.frequency.value = targets.highpass;
  lowpass.frequency.value = targets.lowpass;
  highpass.Q.value = params.resonance;
  lowpass.Q.value = params.resonance;

  if (params.djAutomation?.active && params.djAutomation.durationSec > 0) {
    scheduleLoopedAutomation(
      params.djAutomation.samples,
      params.djAutomation.durationSec,
      params.renderDuration,
      (value, time) => {
        const nextTargets = getFilterTargets(value);
        lowpass.frequency.setValueAtTime(nextTargets.lowpass, time);
        highpass.frequency.setValueAtTime(nextTargets.highpass, time);
      }
    );
  }

  if (params.resonanceAutomation?.active && params.resonanceAutomation.durationSec > 0) {
    scheduleLoopedAutomation(
      params.resonanceAutomation.samples,
      params.resonanceAutomation.durationSec,
      params.renderDuration,
      (value, time) => {
        lowpass.Q.setValueAtTime(value, time);
        highpass.Q.setValueAtTime(value, time);
      }
    );
  }

  input.connect(highpass);
  highpass.connect(lowpass);
  return lowpass;
};
