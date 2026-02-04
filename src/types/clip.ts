import type { ClipSettings } from "./session";

export type ClipItem = {
  id: number;
  name: string;
  blob: Blob;
  url: string;
  durationSec: number;
  buffer?: AudioBuffer;
  gain: number;
  balance: number;
  pitchShift: number;
  tempoOffset: number;
  settings?: ClipSettings;
  applyFxSettings?: boolean;
};
