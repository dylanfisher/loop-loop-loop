import { describe, expect, it, beforeEach } from "vitest";
import type { DeckState } from "../../types/deck";
import { buildFxPanelPatch, loadFxPanelPatch, saveFxPanelPatch } from "../fxPanelState";

const makeDeck = (id: number, open = false): DeckState => ({
  id,
  status: "idle",
  gain: 0.9,
  zoom: 1,
  loopEnabled: true,
  loopStartSeconds: 0,
  loopEndSeconds: 0,
  tempoOffset: 0,
  tempoPitchSync: false,
  stretchRatio: 2,
  stretchWindowSize: 16384,
  stretchStereoWidth: 1,
  stretchPhaseRandomness: 0.5,
  stretchTiltDb: 0,
  stretchScatter: 1,
  delayTime: 0.35,
  delayFeedback: 0.35,
  delayMix: 0,
  delayTone: 6000,
  delayPingPong: false,
  fractalMix: 0,
  fractalStructure: 0.45,
  fractalDepth: 0.35,
  fractalDrift: 0.15,
  fractalDecay: 0.2,
  fractalTone: 6000,
  rearrangerSlices: 8,
  rearrangerOffset: 0,
  rearrangerChaos: 0,
  rearrangerReverse: 0,
  rearrangerAuto: false,
  djFilter: 0,
  filterResonance: 0,
  eqLowGain: 0,
  eqMidGain: 0,
  eqHighGain: 0,
  balance: 0,
  pitchShift: 0,
  fxPanelOpen: {
    djFilter: open,
    resonance: false,
    eqLow: false,
    eqMid: false,
    eqHigh: false,
    balance: false,
    pitch: false,
    delay: false,
    fractal: false,
    rearranger: false,
    stretch: false,
  },
});

describe("fxPanelState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips deck panel state through storage", () => {
    const patch = buildFxPanelPatch([makeDeck(1, true), makeDeck(2, false)]);
    saveFxPanelPatch(patch);
    const loaded = loadFxPanelPatch();
    expect(loaded[1]?.djFilter).toBe(true);
    expect(loaded[2]?.djFilter).toBe(false);
  });

  it("returns empty patch for invalid storage payload", () => {
    window.localStorage.setItem("fxPanelState:v1", "not-json");
    expect(loadFxPanelPatch()).toEqual({});
  });
});
