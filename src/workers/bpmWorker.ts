import { estimateBpmFromSamples } from "../audio/bpm";

type BpmWorkerRequest = {
  deckId: number;
  requestId: number;
  samplesBuffer: ArrayBuffer;
  sampleRate: number;
};

type BpmWorkerResponse = {
  deckId: number;
  requestId: number;
  bpm: number | null;
  confidence: number;
};

self.onmessage = (event: MessageEvent<BpmWorkerRequest>) => {
  const { deckId, requestId, samplesBuffer, sampleRate } = event.data;
  const samples = new Float32Array(samplesBuffer);
  const { bpm, confidence } = estimateBpmFromSamples(samples, sampleRate);

  const response: BpmWorkerResponse = { deckId, requestId, bpm, confidence };
  self.postMessage(response);
};
