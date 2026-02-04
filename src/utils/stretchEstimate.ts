type StretchEstimateParams = {
  loopDurationSec: number;
  stretchRatio: number;
  windowSize: number;
};

export type StretchCalibrationState = {
  factor: number;
  sampleCount: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const CALIBRATION_STORAGE_KEY = "stretch-calibration-v1";
const defaultCalibrationState: StretchCalibrationState = { factor: 1, sampleCount: 0 };

export const estimateStretchRenderSeconds = ({
  loopDurationSec,
  stretchRatio,
  windowSize,
}: StretchEstimateParams) => {
  const safeLoopDuration = clamp(loopDurationSec, 0.01, 600);
  const safeRatio = clamp(stretchRatio, 1, 16);
  const safeWindow = clamp(windowSize, 1024, 16384);

  // Heuristic complexity model: longer loops + larger ratios + larger windows take longer.
  const windowFactor = 0.9 + Math.pow(safeWindow / 8192, 0.75) * 0.35;
  const complexity = safeLoopDuration * safeRatio * windowFactor;
  return Math.max(0.2, 0.3 + complexity * 0.15);
};

export const formatStretchEstimate = (seconds: number) => {
  const safeSeconds = Math.max(0.1, seconds);
  if (safeSeconds < 10) {
    return `~${(Math.round(safeSeconds * 10) / 10).toFixed(1)}s`;
  }
  if (safeSeconds < 60) {
    return `~${Math.round(safeSeconds)}s`;
  }
  const totalSeconds = Math.round(safeSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `~${minutes}m ${remainingSeconds}s`;
};

export const formatStretchEstimateLabel = (seconds: number, sampleCount: number) => {
  void sampleCount;
  return `Approx render: ${formatStretchEstimate(seconds)}`;
};

export const loadStretchCalibrationState = (): StretchCalibrationState => {
  if (typeof window === "undefined") return defaultCalibrationState;
  try {
    const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return defaultCalibrationState;
    const parsed = JSON.parse(raw) as Partial<StretchCalibrationState>;
    const factor = Number.isFinite(parsed.factor)
      ? clamp(parsed.factor as number, 0.4, 3)
      : defaultCalibrationState.factor;
    const sampleCount = Number.isInteger(parsed.sampleCount)
      ? clamp(parsed.sampleCount as number, 0, 9999)
      : defaultCalibrationState.sampleCount;
    return { factor, sampleCount };
  } catch {
    return defaultCalibrationState;
  }
};

export const saveStretchCalibrationState = (state: StretchCalibrationState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; calibration is an optional quality improvement.
  }
};

export const applyStretchCalibration = (
  baseEstimateSeconds: number,
  calibration: StretchCalibrationState
) => {
  return Math.max(0.1, baseEstimateSeconds * clamp(calibration.factor, 0.4, 3));
};

export const updateStretchCalibrationState = (
  state: StretchCalibrationState,
  baseEstimateSeconds: number,
  actualSeconds: number
): StretchCalibrationState => {
  if (baseEstimateSeconds <= 0 || actualSeconds <= 0) return state;
  const observedFactor = clamp(actualSeconds / baseEstimateSeconds, 0.25, 4);
  const alpha = state.sampleCount < 5 ? 0.3 : 0.15;
  const nextFactor = clamp(
    state.factor * (1 - alpha) + observedFactor * alpha,
    0.4,
    3
  );
  const nextSampleCount = clamp(state.sampleCount + 1, 0, 9999);
  return {
    factor: nextFactor,
    sampleCount: nextSampleCount,
  };
};
