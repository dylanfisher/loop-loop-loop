import {
  scheduleLoopedAutomation,
  type OfflineAutomationTrack,
} from "./automation";

export type Eq3OfflineParams = {
  low: number;
  mid: number;
  high: number;
  renderDuration: number;
  lowAutomation?: OfflineAutomationTrack;
  midAutomation?: OfflineAutomationTrack;
  highAutomation?: OfflineAutomationTrack;
};

const EQ_STAGE_COUNT = 2;

const approxEqual = (value: number, target: number, epsilon = 1e-4) =>
  Math.abs(value - target) <= epsilon;

const applyEqGain = (filters: BiquadFilterNode[], value: number) => {
  const perStageGain = value / EQ_STAGE_COUNT;
  filters.forEach((filter) => {
    filter.gain.value = perStageGain;
  });
};

export const applyEq3Offline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: Eq3OfflineParams
) => {
  const needsEq =
    !approxEqual(params.low, 0) ||
    !approxEqual(params.mid, 0) ||
    !approxEqual(params.high, 0) ||
    params.lowAutomation?.active === true ||
    params.midAutomation?.active === true ||
    params.highAutomation?.active === true;
  if (!needsEq) {
    return input;
  }

  const eqLow = Array.from({ length: EQ_STAGE_COUNT }, () => {
    const filter = context.createBiquadFilter();
    filter.type = "lowshelf";
    filter.frequency.value = 120;
    return filter;
  });
  const eqMid = Array.from({ length: EQ_STAGE_COUNT }, () => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = 1000;
    return filter;
  });
  const eqHigh = Array.from({ length: EQ_STAGE_COUNT }, () => {
    const filter = context.createBiquadFilter();
    filter.type = "highshelf";
    filter.frequency.value = 8000;
    return filter;
  });

  applyEqGain(eqLow, params.low);
  applyEqGain(eqMid, params.mid);
  applyEqGain(eqHigh, params.high);

  if (params.lowAutomation?.active && params.lowAutomation.durationSec > 0) {
    scheduleLoopedAutomation(
      params.lowAutomation.samples,
      params.lowAutomation.durationSec,
      params.renderDuration,
      (value, time) => {
        const perStageGain = value / EQ_STAGE_COUNT;
        eqLow.forEach((filter) => {
          filter.gain.setValueAtTime(perStageGain, time);
        });
      }
    );
  }
  if (params.midAutomation?.active && params.midAutomation.durationSec > 0) {
    scheduleLoopedAutomation(
      params.midAutomation.samples,
      params.midAutomation.durationSec,
      params.renderDuration,
      (value, time) => {
        const perStageGain = value / EQ_STAGE_COUNT;
        eqMid.forEach((filter) => {
          filter.gain.setValueAtTime(perStageGain, time);
        });
      }
    );
  }
  if (params.highAutomation?.active && params.highAutomation.durationSec > 0) {
    scheduleLoopedAutomation(
      params.highAutomation.samples,
      params.highAutomation.durationSec,
      params.renderDuration,
      (value, time) => {
        const perStageGain = value / EQ_STAGE_COUNT;
        eqHigh.forEach((filter) => {
          filter.gain.setValueAtTime(perStageGain, time);
        });
      }
    );
  }

  input.connect(eqLow[0]);
  for (let i = 0; i < eqLow.length - 1; i += 1) {
    eqLow[i].connect(eqLow[i + 1]);
  }
  eqLow[eqLow.length - 1].connect(eqMid[0]);
  for (let i = 0; i < eqMid.length - 1; i += 1) {
    eqMid[i].connect(eqMid[i + 1]);
  }
  eqMid[eqMid.length - 1].connect(eqHigh[0]);
  for (let i = 0; i < eqHigh.length - 1; i += 1) {
    eqHigh[i].connect(eqHigh[i + 1]);
  }
  return eqHigh[eqHigh.length - 1];
};
