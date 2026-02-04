export type OfflineAutomationTrack = {
  active: boolean;
  samples: Float32Array;
  durationSec: number;
};

export const scheduleLoopedAutomation = (
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
