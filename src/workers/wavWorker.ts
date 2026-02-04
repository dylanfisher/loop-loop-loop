type WavEncodeRequest = {
  id: number;
  sampleRate: number;
  channels: ArrayBuffer[];
};

type WavEncodeResponse =
  | {
      id: number;
      wavBuffer: ArrayBuffer;
    }
  | {
      id: number;
      error: string;
    };

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};

const encodeWavBuffer = (channels: Float32Array[], sampleRate: number) => {
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = channels[channel][i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return arrayBuffer;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<WavEncodeRequest>) => void) | null;
  postMessage: (message: WavEncodeResponse, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event: MessageEvent<WavEncodeRequest>) => {
  const { id, sampleRate, channels } = event.data;
  try {
    const channelViews = channels.map((channel) => new Float32Array(channel));
    const wavBuffer = encodeWavBuffer(channelViews, sampleRate);
    const response: WavEncodeResponse = { id, wavBuffer };
    workerScope.postMessage(response, [wavBuffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "WAV encoding failed";
    const response: WavEncodeResponse = { id, error: message };
    workerScope.postMessage(response);
  }
};
