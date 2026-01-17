export type DeckStatus = "idle" | "loading" | "ready" | "playing" | "error";

export type DeckState = {
  id: number;
  status: DeckStatus;
  fileName?: string;
  buffer?: AudioBuffer;
  gain: number;
};
