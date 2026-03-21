export type DeckStatus = "idle" | "loading" | "transcoding" | "ready" | "playing" | "paused" | "error";
export type ParametricEqBandType = "peaking" | "lowshelf" | "highshelf";
export type ParametricEqAutomationBandIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ParametricEqSimpleAutomationParam =
  | `parametricEqBand${ParametricEqAutomationBandIndex}Frequency`
  | `parametricEqBand${ParametricEqAutomationBandIndex}Gain`;
export type SimpleAutomationParam =
  | "loopDelaySec"
  | "delayTime"
  | "delayFeedback"
  | "delayMix"
  | "delayTone"
  | "delaySaturation"
  | "delayDamping"
  | "delaySafety"
  | "delayRhythmMorph"
  | "delayRhythmRateHz"
  | "delayRhythmSwing"
  | "delayDuckDepth"
  | "delayDuckThreshold"
  | "delayDuckResponseMs"
  | "delaySpectralMix"
  | "delaySpectralSpread"
  | "delaySpectralMotion"
  | "spectralSpaceMix"
  | "spectralSpaceSpread"
  | "spectralSpaceMotion"
  | "spectralSpaceTilt"
  | "spectralSpaceLowMono"
  | "spectralSpaceTransientProtect"
  | "vocoderMix"
  | "vocoderModulatorMonitor"
  | "vocoderModDrive"
  | "vocoderBandCount"
  | "vocoderBandSpread"
  | "vocoderVocalCharacter"
  | "vocoderFormantShift"
  | "vocoderConsonantBoost"
  | "vocoderPreEmphasis"
  | "vocoderTightness"
  | "vocoderAttackMs"
  | "vocoderReleaseMs"
  | "vocoderNoiseMix"
  | "vocoderGateThreshold"
  | "rearrangerSwapCount"
  | "rearrangerChaos"
  | "rearrangerReverse"
  | "rearrangerSliceFadeMs"
  | "rearrangerSliceDelaySec"
  | "rearrangerPingPong"
  | ParametricEqSimpleAutomationParam;
export type SimpleAutomationState = {
  active: boolean;
  baseline: number;
  target: number;
  cycleSec: number;
  samples?: number[];
  sampleRate?: number;
  durationSec?: number;
};
export type DeckSimpleAutomation = Partial<Record<SimpleAutomationParam, SimpleAutomationState>>;
export type ParametricEqMotionPreset = "sweep";
export type ParametricEqMotionState = {
  preset: ParametricEqMotionPreset | null;
  cycleSec: number;
  automationActive: boolean;
  targetBandId: string | null;
};
export type ParametricEqBandWander = {
  jitter: number;
  spread: number;
  seed: number;
  baseFrequency: number;
  baseGain: number;
};
export type ParametricEqBand = {
  id: string;
  type: ParametricEqBandType;
  frequency: number;
  gain: number;
  q: number;
  enabled: boolean;
  wander?: ParametricEqBandWander;
};

export type DeckFxPanel =
  | "loopDelay"
  | "gain"
  | "djFilter"
  | "resonance"
  | "parametricEq"
  | "balance"
  | "pitch"
  | "vocoder"
  | "delay"
  | "spectralSpace"
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
  loopDelaySec: number;
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
  delaySaturation?: number;
  delayDamping?: number;
  delaySafety?: number;
  delayRhythmMorph?: number;
  delayRhythmRateHz?: number;
  delayRhythmSwing?: number;
  delayDuckDepth?: number;
  delayDuckThreshold?: number;
  delayDuckResponseMs?: number;
  delaySpectralMix?: number;
  delaySpectralSpread?: number;
  delaySpectralMotion?: number;
  spectralSpaceMix?: number;
  spectralSpaceSpread?: number;
  spectralSpaceMotion?: number;
  spectralSpaceTilt?: number;
  spectralSpaceLowMono?: number;
  spectralSpaceTransientProtect?: number;
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
  parametricEqBands: ParametricEqBand[];
  parametricEqMotion: ParametricEqMotionState;
  balance: number;
  pitchShift: number;
  vocoderMix: number;
  vocoderCarrierDeckId: number | null;
  vocoderModulatorMonitor: number;
  vocoderModDrive: number;
  vocoderBandCount: number;
  vocoderBandSpread: number;
  vocoderVocalCharacter: number;
  vocoderFormantShift: number;
  vocoderConsonantBoost: number;
  vocoderPreEmphasis: number;
  vocoderTightness: number;
  vocoderAttackMs: number;
  vocoderReleaseMs: number;
  vocoderNoiseMix: number;
  vocoderGateThreshold: number;
  vocoderPostDelay: boolean;
  simpleAutomation: DeckSimpleAutomation;
  includeInRecordExport: boolean;
  deckWidthOverride?: DeckWidthOverride;
  fxPanelOpen: DeckFxPanelState;
};
