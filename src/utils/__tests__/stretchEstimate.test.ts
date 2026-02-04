import { describe, expect, it } from "vitest";
import {
  applyStretchCalibration,
  estimateStretchRenderSeconds,
  formatStretchEstimate,
  formatStretchEstimateLabel,
  updateStretchCalibrationState,
} from "../stretchEstimate";

describe("stretchEstimate", () => {
  it("increases estimate with longer loops", () => {
    const shortLoop = estimateStretchRenderSeconds({
      loopDurationSec: 1,
      stretchRatio: 2,
      windowSize: 8192,
    });
    const longLoop = estimateStretchRenderSeconds({
      loopDurationSec: 8,
      stretchRatio: 2,
      windowSize: 8192,
    });
    expect(longLoop).toBeGreaterThan(shortLoop);
  });

  it("increases estimate with larger stretch amount", () => {
    const lowAmount = estimateStretchRenderSeconds({
      loopDurationSec: 4,
      stretchRatio: 2,
      windowSize: 8192,
    });
    const highAmount = estimateStretchRenderSeconds({
      loopDurationSec: 4,
      stretchRatio: 8,
      windowSize: 8192,
    });
    expect(highAmount).toBeGreaterThan(lowAmount);
  });

  it("increases estimate with larger window sizes", () => {
    const smallWindow = estimateStretchRenderSeconds({
      loopDurationSec: 4,
      stretchRatio: 4,
      windowSize: 2048,
    });
    const largeWindow = estimateStretchRenderSeconds({
      loopDurationSec: 4,
      stretchRatio: 4,
      windowSize: 16384,
    });
    expect(largeWindow).toBeGreaterThan(smallWindow);
  });

  it("formats short and long durations", () => {
    expect(formatStretchEstimate(2.34)).toBe("~2.3s");
    expect(formatStretchEstimate(18.9)).toBe("~19s");
    expect(formatStretchEstimate(73.2)).toBe("~1m 13s");
  });

  it("formats label with learning state", () => {
    expect(formatStretchEstimateLabel(3.25, 0)).toBe("Approx render: ~3.3s (learning...)");
    expect(formatStretchEstimateLabel(3.25, 5)).toBe("Approx render: ~3.3s");
  });

  it("applies and updates calibration", () => {
    const calibrated = applyStretchCalibration(10, { factor: 1.2, sampleCount: 3 });
    expect(calibrated).toBe(12);

    const updated = updateStretchCalibrationState(
      { factor: 1, sampleCount: 0 },
      10,
      20
    );
    expect(updated.sampleCount).toBe(1);
    expect(updated.factor).toBeGreaterThan(1);
  });
});
