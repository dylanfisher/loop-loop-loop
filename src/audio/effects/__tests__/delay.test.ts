import { describe, expect, it } from "vitest";
import {
  DELAY_FEEDBACK_AIR_TRIM_DB,
  DELAY_FEEDBACK_AIR_TRIM_FREQ,
  mapDuckResponseToFollowerCutoff,
  normalizeDelayParams,
} from "../delay";

describe("delay params", () => {
  it("clamps new modulation and duck/spectral controls", () => {
    const params = normalizeDelayParams({
      rhythmMorph: 2,
      rhythmRateHz: 99,
      rhythmSwing: -1,
      duckDepth: 2,
      duckThreshold: -1,
      duckResponseMs: 1,
      spectralMix: 2,
      spectralSpread: -1,
      spectralMotion: 3,
    });

    expect(params.rhythmMorph).toBe(1);
    expect(params.rhythmRateHz).toBe(12);
    expect(params.rhythmSwing).toBe(0);
    expect(params.duckDepth).toBe(1);
    expect(params.duckThreshold).toBe(0);
    expect(params.duckResponseMs).toBe(8);
    expect(params.spectralMix).toBe(1);
    expect(params.spectralSpread).toBe(0);
    expect(params.spectralMotion).toBe(1);
  });

  it("maps duck response to a bounded follower cutoff", () => {
    expect(mapDuckResponseToFollowerCutoff(1)).toBeGreaterThanOrEqual(2);
    expect(mapDuckResponseToFollowerCutoff(5000)).toBeLessThanOrEqual(120);
  });

  it("applies a subtle fixed high-frequency trim in the feedback loop", () => {
    expect(DELAY_FEEDBACK_AIR_TRIM_FREQ).toBeGreaterThan(3000);
    expect(DELAY_FEEDBACK_AIR_TRIM_DB).toBeLessThan(0);
    expect(DELAY_FEEDBACK_AIR_TRIM_DB).toBeGreaterThan(-9);
  });
});
