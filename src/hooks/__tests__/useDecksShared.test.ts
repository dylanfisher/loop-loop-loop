import { describe, expect, it } from "vitest";
import {
  SIMPLE_AUTOMATION_PARAM_LIMITS,
  normalizeSimpleAutomation,
} from "../useDecksShared";

describe("parametric EQ simple automation limits", () => {
  it("exposes limits for each parametric EQ band frequency and gain lane", () => {
    expect(SIMPLE_AUTOMATION_PARAM_LIMITS.parametricEqBand1Frequency).toEqual({
      min: 20,
      max: 20000,
    });
    expect(SIMPLE_AUTOMATION_PARAM_LIMITS.parametricEqBand8Gain).toEqual({
      min: -18,
      max: 18,
    });
  });

  it("normalizes and clamps parametric EQ simple automation entries", () => {
    const normalized = normalizeSimpleAutomation({
      parametricEqBand3Frequency: {
        active: true,
        baseline: 10,
        target: 40000,
        cycleSec: 0.1,
      },
      parametricEqBand4Gain: {
        active: true,
        baseline: -999,
        target: 999,
        cycleSec: 120,
      },
    });

    expect(normalized.parametricEqBand3Frequency).toMatchObject({
      active: true,
      baseline: 20,
      target: 20000,
      cycleSec: 0.25,
    });
    expect(normalized.parametricEqBand4Gain).toMatchObject({
      active: true,
      baseline: -18,
      target: 18,
      cycleSec: 60,
    });
  });
});
