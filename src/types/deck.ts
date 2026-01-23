export type DeckStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

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
  follow: boolean;
  loopEnabled: boolean;
  loopStartSeconds: number;
  loopEndSeconds: number;
  bpm: number | null;
  bpmConfidence: number;
  bpmOverride: number | null;
  djFilter: number;
  filterResonance: number;
};
