export type PcmWavRecorderChunk = {
  blob: Blob;
  index: number;
};

export type PcmWavRecorderMetadata = {
  sampleRate: number;
  channelCount: number;
};

const PCM_CHUNK_SECONDS = 2;
const PROCESSOR_BUFFER_SIZE = 4096;
const WAV_HEADER_BYTES = 44;
const MAX_WAV_DATA_BYTES = 0xffffffff - WAV_HEADER_BYTES;

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};

export const encodePcm16WavHeader = (
  dataBytes: number,
  sampleRate: number,
  channelCount: number
) => {
  if (dataBytes > MAX_WAV_DATA_BYTES) {
    throw new Error("Recording is too large for a standard WAV file.");
  }
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  return new Blob([arrayBuffer], { type: "audio/wav" });
};

const interleavePcm16 = (inputBuffer: AudioBuffer, channelCount: number) => {
  const frameCount = inputBuffer.length;
  const interleaved = new Int16Array(frameCount * channelCount);
  let writeIndex = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sourceChannel = Math.min(channel, inputBuffer.numberOfChannels - 1);
      const sample = inputBuffer.getChannelData(sourceChannel)[frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      interleaved[writeIndex] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      writeIndex += 1;
    }
  }

  return interleaved;
};

const concatenatePcmChunks = (chunks: Int16Array[]) => {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Int16Array(sampleCount);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return new Uint8Array(merged.buffer);
};

export class PcmWavRecorder {
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private chunks: Int16Array[] = [];
  private bufferedBytes = 0;
  private chunkIndex = 0;
  private onChunk: ((chunk: PcmWavRecorderChunk) => void) | null = null;

  metadata: PcmWavRecorderMetadata | null = null;

  async start(stream: MediaStream, onChunk: (chunk: PcmWavRecorderChunk) => void) {
    this.onChunk = onChunk;
    const audioContext = new AudioContext();
    const trackSettings = stream.getAudioTracks()[0]?.getSettings();
    const channelCount =
      typeof trackSettings?.channelCount === "number" && trackSettings.channelCount > 0
        ? Math.min(2, Math.max(1, Math.round(trackSettings.channelCount)))
        : 2;
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      channelCount,
      channelCount
    );
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    this.audioContext = audioContext;
    this.source = source;
    this.processor = processor;
    this.silentGain = silentGain;
    this.metadata = {
      sampleRate: audioContext.sampleRate,
      channelCount,
    };

    processor.onaudioprocess = (event) => {
      const pcm = interleavePcm16(event.inputBuffer, channelCount);
      this.chunks.push(pcm);
      this.bufferedBytes += pcm.byteLength;
      if (this.bufferedBytes >= audioContext.sampleRate * channelCount * 2 * PCM_CHUNK_SECONDS) {
        this.flush();
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  }

  stop() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    if (this.processor) {
      this.processor.onaudioprocess = null;
    }
    this.flush();
    void this.audioContext?.close();
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.onChunk = null;
  }

  private flush() {
    if (this.chunks.length === 0 || !this.onChunk) return;
    const bytes = concatenatePcmChunks(this.chunks);
    this.chunks = [];
    this.bufferedBytes = 0;
    this.onChunk({
      blob: new Blob([bytes], { type: "application/octet-stream" }),
      index: this.chunkIndex,
    });
    this.chunkIndex += 1;
  }
}
