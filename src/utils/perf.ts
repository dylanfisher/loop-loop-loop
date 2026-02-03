const perfEnabled = import.meta.env.DEV;

type PerfSnapshot = {
  timings: Record<string, number>;
  counters: Record<string, number>;
};

const timings: Record<string, number> = {};
const counters: Record<string, number> = {};

export const setPerfTiming = (name: string, value: number) => {
  if (!perfEnabled) return;
  timings[name] = value;
};

export const setPerfCounter = (name: string, value: number) => {
  if (!perfEnabled) return;
  counters[name] = value;
};

export const incPerfCounter = (name: string, delta = 1) => {
  if (!perfEnabled) return;
  counters[name] = (counters[name] ?? 0) + delta;
};

export const getPerfSnapshot = (): PerfSnapshot => ({
  timings: { ...timings },
  counters: { ...counters },
});
