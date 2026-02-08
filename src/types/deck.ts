export type DeckStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";
export type EqMode = "eq3" | "parametric";
export type ParametricEqBandType = "peaking" | "lowshelf" | "highshelf";
export type ParametricEqBand = {
  id: string;
  type: ParametricEqBandType;
  frequency: number;
  gain: number;
  q: number;
  enabled: boolean;
};

export type DeckFxPanel =
  | "gain"
  | "djFilter"
  | "resonance"
  | "eqLow"
  | "eqMid"
  | "eqHigh"
  | "parametricEq"
  | "balance"
  | "pitch"
  | "vocoder"
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
  rearrangerSliceDelaySec: number;
  rearrangerPingPong: number;
  rearrangerAuto: boolean;
  rearrangerRegions?: number[];
  rearrangerRegionIds?: number[];
  rearrangerRegionsManual?: boolean;
  djFilter: number;
  filterResonance: number;
  eqMode: EqMode;
  eqLowGain: number;
  eqMidGain: number;
  eqHighGain: number;
  parametricEqBands: ParametricEqBand[];
  balance: number;
  pitchShift: number;
  vocoderMix: number;
  vocoderCarrierDeckId: number | null;
  vocoderModulatorMonitor: number;
  vocoderModDrive: number;
  vocoderBandCount: number;
  vocoderBandSpread: number;
  vocoderAttackMs: number;
  vocoderReleaseMs: number;
  vocoderNoiseMix: number;
  vocoderGateThreshold: number;
  deckWidthOverride?: DeckWidthOverride;
  fxPanelOpen: DeckFxPanelState;
};
