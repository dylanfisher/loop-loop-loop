export type AutomationParam =
  | "djFilter"
  | "resonance"
  | "eqLow"
  | "eqMid"
  | "eqHigh"
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
  eqLowGain: number;
  eqMidGain: number;
  eqHighGain: number;
  pitchShift: number;
  offsetSeconds: number;
  zoom: number;
  loopEnabled: boolean;
  loopStartSeconds: number;
  loopEndSeconds: number;
  tempoOffset: number;
  automation: Record<AutomationParam, AutomationSnapshot>;
};

export type ClipSession = {
  id: number;
  name: string;
  durationSec: number;
  gain: number;
  pitchShift: number;
  wavBlobId: string;
};

export type SessionState = {
  version: 1;
  id: string;
  name: string;
  savedAt: number;
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

export type SessionFileClip = Omit<ClipSession, "wavBlobId"> & {
  wavFile: string;
};

export type SessionFileState = {
  version: 1;
  name: string;
  savedAt: number;
  decks: SessionFileDeck[];
  clips: SessionFileClip[];
};
