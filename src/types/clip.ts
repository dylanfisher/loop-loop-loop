export type ClipItem = {
  id: number;
  name: string;
  blob: Blob;
  url: string;
  durationSec: number;
  buffer?: AudioBuffer;
  bpm?: number | null;
};
