export type DeckStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

export type DeckFxPanel =
  | "gain"
  | "djFilter"
  | "resonance"
  | "eqLow"
  | "eqMid"
  | "eqHigh"
  | "balance"
  | "pitch"
  | "delay"
  | "rearranger"
  | "stretch";

export type DeckFxPanelState = Record<DeckFxPanel, boolean>;
export type DeckWidthOverride = "full" | "half";

export type DeckState = {
  id: number;
  status: DeckStatus;
  fileName?: string;
  buffer?: AudioBuffer;
  gain: number;
  startedAtMs?: number;
  duration?: number;
  offsetSeconds?: number;
  zoom: number;
  loopEnabled: boolean;
  loopStartSeconds: number;
  loopEndSeconds: number;
  tempoOffset: number;
  tempoPitchSync: boolean;
  stretchRatio: number;
  stretchWindowSize: number;
  stretchStereoWidth: number;
  stretchPhaseRandomness: number;
  stretchTiltDb: number;
  stretchScatter: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  delayTone: number;
  delayPingPong: boolean;
  delaySliceSync: boolean;
  rearrangerSlices: number;
  rearrangerSwapCount: number;
  rearrangerChaos: number;
  rearrangerReverse: number;
  rearrangerSensitivity: number;
  rearrangerQuietThreshold: number;
  rearrangerSliceFadeMs: number;
  rearrangerAuto: boolean;
  rearrangerRegions?: number[];
  rearrangerRegionIds?: number[];
  rearrangerRegionsManual?: boolean;
  djFilter: number;
  filterResonance: number;
  eqLowGain: number;
  eqMidGain: number;
  eqHighGain: number;
  balance: number;
  pitchShift: number;
  deckWidthOverride?: DeckWidthOverride;
  fxPanelOpen: DeckFxPanelState;
};
