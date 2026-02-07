import type { DeckFxPanelState, EqMode, ParametricEqBand } from "./deck";

export type AutomationParam =
  | "gain"
  | "djFilter"
  | "resonance"
  | "eqLow"
  | "eqMid"
  | "eqHigh"
  | "balance"
  | "pitch";

export type AutomationSnapshot = {
  samples: number[];
  sampleRate: number;
  durationSec: number;
  active: boolean;
  currentValue: number;
};

export type DeckSession = {
  id: number;
  fileName?: string;
  wavBlobId?: string;
  gain: number;
  djFilter: number;
  filterResonance: number;
  eqMode?: EqMode;
  eqLowGain: number;
  eqMidGain: number;
  eqHighGain: number;
  parametricEqBands?: ParametricEqBand[];
  balance: number;
  pitchShift: number;
  vocoderMix?: number;
  vocoderCarrierDeckId?: number | null;
  vocoderModulatorMonitor?: number;
  vocoderModDrive?: number;
  vocoderBandCount?: number;
  vocoderBandSpread?: number;
  vocoderAttackMs?: number;
  vocoderReleaseMs?: number;
  vocoderNoiseMix?: number;
  vocoderGateThreshold?: number;
  deckWidthOverride?: "full" | "half";
  offsetSeconds: number;
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
  delaySliceSync?: boolean;
  rearrangerSlices?: number;
  rearrangerSwapCount?: number;
  rearrangerChaos?: number;
  rearrangerReverse?: number;
  rearrangerSensitivity?: number;
  rearrangerQuietThreshold?: number;
  rearrangerSliceFadeMs?: number;
  rearrangerPingPong?: number;
  rearrangerAuto?: boolean;
  rearrangerRegions?: number[];
  rearrangerRegionIds?: number[];
  rearrangerRegionsManual?: boolean;
  fxPanelOpen?: DeckFxPanelState;
  automation: Record<AutomationParam, AutomationSnapshot>;
};

export type ClipSession = {
  id: number;
  name: string;
  durationSec: number;
  gain: number;
  balance: number;
  pitchShift: number;
  vocoderMix?: number;
  vocoderCarrierDeckId?: number | null;
  vocoderModulatorMonitor?: number;
  vocoderModDrive?: number;
  vocoderBandCount?: number;
  vocoderBandSpread?: number;
  vocoderAttackMs?: number;
  vocoderReleaseMs?: number;
  vocoderNoiseMix?: number;
  vocoderGateThreshold?: number;
  tempoOffset: number;
  audioBlobId?: string;
  audioMimeType?: string;
  audioFileName?: string;
  wavBlobId?: string;
  settings?: ClipSettings;
  applyFxSettings?: boolean;
};

export type ClipSettings = {
  gain: number;
  djFilter: number;
  filterResonance: number;
  eqMode?: EqMode;
  eqLowGain: number;
  eqMidGain: number;
  eqHighGain: number;
  parametricEqBands?: ParametricEqBand[];
  balance: number;
  pitchShift: number;
  vocoderMix?: number;
  vocoderCarrierDeckId?: number | null;
  vocoderModulatorMonitor?: number;
  vocoderModDrive?: number;
  vocoderBandCount?: number;
  vocoderBandSpread?: number;
  vocoderAttackMs?: number;
  vocoderReleaseMs?: number;
  vocoderNoiseMix?: number;
  vocoderGateThreshold?: number;
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
  delaySliceSync?: boolean;
  rearrangerSlices?: number;
  rearrangerSwapCount?: number;
  rearrangerChaos?: number;
  rearrangerReverse?: number;
  rearrangerSensitivity?: number;
  rearrangerQuietThreshold?: number;
  rearrangerSliceFadeMs?: number;
  rearrangerPingPong?: number;
  rearrangerAuto?: boolean;
  rearrangerRegions?: number[];
  rearrangerRegionIds?: number[];
  rearrangerRegionsManual?: boolean;
  loopEnabled: boolean;
  loopStartSeconds: number;
  loopEndSeconds: number;
  automation: Record<AutomationParam, AutomationSnapshot>;
};

export type SessionState = {
  version: 1;
  id: string;
  name: string;
  savedAt: number;
  masterGain?: number;
  welcomePanelDismissed?: boolean;
  decks: DeckSession[];
  clips: ClipSession[];
};

export type SessionMeta = {
  id: string;
  name: string;
  savedAt: number;
};

export type SessionFileDeck = Omit<DeckSession, "wavBlobId"> & {
  wavFile?: string;
};

export type SessionFileClip = Omit<ClipSession, "audioBlobId" | "wavBlobId"> & {
  audioFile?: string;
  wavFile?: string;
};

export type SessionFileState = {
  version: 1;
  name: string;
  savedAt: number;
  masterGain?: number;
  welcomePanelDismissed?: boolean;
  decks: SessionFileDeck[];
  clips: SessionFileClip[];
};
