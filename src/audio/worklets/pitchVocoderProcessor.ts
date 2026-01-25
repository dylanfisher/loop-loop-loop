type ChannelState = {
  inFIFO: Float32Array;
  outFIFO: Float32Array;
  fftWork: Float32Array;
  lastPhase: Float32Array;
  sumPhase: Float32Array;
  outputAccum: Float32Array;
  anaFreq: Float32Array;
  anaMagn: Float32Array;
  synFreq: Float32Array;
  synMagn: Float32Array;
  rover: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0;

const stft = (fftBuffer: Float32Array, fftFrameSize: number, sign: number) => {
  let i = 0;
  let bitm = 0;
  let j = 0;
  let le = 0;
  let le2 = 0;
  let k = 0;
  let wr = 0;
  let wi = 0;
  let arg = 0;
  let temp = 0;
  let tr = 0;
  let ti = 0;
  let ur = 0;
  let ui = 0;

  for (i = 2; i < 2 * fftFrameSize - 2; i += 2) {
    for (bitm = 2, j = 0; bitm < 2 * fftFrameSize; bitm <<= 1) {
      if ((i & bitm) !== 0) j += 1;
      j <<= 1;
    }
    if (i < j) {
      temp = fftBuffer[i];
      fftBuffer[i] = fftBuffer[j];
      fftBuffer[j] = temp;
      temp = fftBuffer[i + 1];
      fftBuffer[i + 1] = fftBuffer[j + 1];
      fftBuffer[j + 1] = temp;
    }
  }

  const max = Math.trunc(Math.log(fftFrameSize) / Math.log(2) + 0.5);
  for (k = 0, le = 2; k < max; k += 1) {
    le <<= 1;
    le2 = le >> 1;
    ur = 1;
    ui = 0;
    arg = Math.PI / (le2 >> 1);
    wr = Math.cos(arg);
    wi = sign * Math.sin(arg);
    for (j = 0; j < le2; j += 2) {
      for (i = j; i < 2 * fftFrameSize; i += le) {
        tr = fftBuffer[i + le2] * ur - fftBuffer[i + le2 + 1] * ui;
        ti = fftBuffer[i + le2] * ui + fftBuffer[i + le2 + 1] * ur;
        fftBuffer[i + le2] = fftBuffer[i] - tr;
        fftBuffer[i + le2 + 1] = fftBuffer[i + 1] - ti;
        fftBuffer[i] += tr;
        fftBuffer[i + 1] += ti;
      }
      tr = ur * wr - ui * wi;
      ui = ur * wi + ui * wr;
      ur = tr;
    }
  }
};

class PitchVocoderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "pitch",
        defaultValue: 0,
        minValue: -24,
        maxValue: 24,
        automationRate: "k-rate",
      },
    ];
  }

  private readonly fftFrameSize: number;
  private readonly fftFrameSize2: number;
  private readonly osamp: number;
  private readonly stepSize: number;
  private readonly inFifoLatency: number;
  private readonly freqPerBin: number;
  private readonly expct: number;
  private readonly window: Float32Array;
  private readonly maxFrameLength: number;
  private channels: ChannelState[] = [];

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const config = options?.processorOptions ?? {};
    const requestedSize = clamp(Number(config.fftFrameSize) || 1024, 256, 4096);
    const fftFrameSize = isPowerOfTwo(requestedSize) ? requestedSize : 1024;
    this.fftFrameSize = fftFrameSize;
    this.fftFrameSize2 = fftFrameSize >> 1;
    this.osamp = clamp(Number(config.osamp) || 8, 4, 32);
    this.stepSize = Math.trunc(this.fftFrameSize / this.osamp);
    this.inFifoLatency = this.fftFrameSize - this.stepSize;
    this.freqPerBin = sampleRate / this.fftFrameSize;
    this.expct = (2 * Math.PI * this.stepSize) / this.fftFrameSize;
    this.maxFrameLength = Math.max(4096, this.fftFrameSize);
    this.window = new Float32Array(this.fftFrameSize);
    for (let i = 0; i < this.fftFrameSize; i += 1) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.fftFrameSize));
    }
    this.port.onmessage = (event) => {
      if (event.data?.type === "reset") {
        this.channels.forEach((state) => {
          state.inFIFO.fill(0);
          state.outFIFO.fill(0);
          state.fftWork.fill(0);
          state.lastPhase.fill(0);
          state.sumPhase.fill(0);
          state.outputAccum.fill(0);
          state.anaFreq.fill(0);
          state.anaMagn.fill(0);
          state.synFreq.fill(0);
          state.synMagn.fill(0);
          state.rover = this.inFifoLatency;
        });
      }
    };
  }

  private ensureChannels(count: number) {
    if (this.channels.length === count) return;
    this.channels = [];
    for (let i = 0; i < count; i += 1) {
      this.channels.push({
        inFIFO: new Float32Array(this.maxFrameLength),
        outFIFO: new Float32Array(this.maxFrameLength),
        fftWork: new Float32Array(2 * this.maxFrameLength),
        lastPhase: new Float32Array(this.maxFrameLength / 2 + 1),
        sumPhase: new Float32Array(this.maxFrameLength / 2 + 1),
        outputAccum: new Float32Array(2 * this.maxFrameLength),
        anaFreq: new Float32Array(this.maxFrameLength),
        anaMagn: new Float32Array(this.maxFrameLength),
        synFreq: new Float32Array(this.maxFrameLength),
        synMagn: new Float32Array(this.maxFrameLength),
        rover: this.inFifoLatency,
      });
    }
  }

  private processFrame(state: ChannelState, pitchRatio: number) {
    const fftFrameSize = this.fftFrameSize;
    const fftFrameSize2 = this.fftFrameSize2;

    for (let k = 0; k < fftFrameSize; k += 1) {
      const window = this.window[k];
      state.fftWork[2 * k] = state.inFIFO[k] * window;
      state.fftWork[2 * k + 1] = 0;
    }

    stft(state.fftWork, fftFrameSize, -1);

    for (let k = 0; k <= fftFrameSize2; k += 1) {
      const real = state.fftWork[2 * k];
      const imag = state.fftWork[2 * k + 1];
      const magn = 2 * Math.sqrt(real * real + imag * imag);
      const phase = Math.atan2(imag, real);
      let tmp = phase - state.lastPhase[k];
      state.lastPhase[k] = phase;

      tmp -= k * this.expct;
      let qpd = Math.trunc(tmp / Math.PI);
      if (qpd >= 0) qpd += qpd & 1;
      else qpd -= qpd & 1;
      tmp -= Math.PI * qpd;
      tmp = (this.osamp * tmp) / (2 * Math.PI);
      tmp = k * this.freqPerBin + tmp * this.freqPerBin;

      state.anaMagn[k] = magn;
      state.anaFreq[k] = tmp;
    }

    state.synMagn.fill(0, 0, fftFrameSize);
    state.synFreq.fill(0, 0, fftFrameSize);

    for (let k = 0; k <= fftFrameSize2; k += 1) {
      const index = Math.trunc(k * pitchRatio);
      if (index <= fftFrameSize2) {
        state.synMagn[index] += state.anaMagn[k];
        state.synFreq[index] = state.anaFreq[k] * pitchRatio;
      }
    }

    for (let k = 0; k <= fftFrameSize2; k += 1) {
      const magn = state.synMagn[k];
      let tmp = state.synFreq[k];
      tmp -= k * this.freqPerBin;
      tmp /= this.freqPerBin;
      tmp = (2 * Math.PI * tmp) / this.osamp;
      tmp += k * this.expct;
      state.sumPhase[k] += tmp;
      const phase = state.sumPhase[k];
      state.fftWork[2 * k] = magn * Math.cos(phase);
      state.fftWork[2 * k + 1] = magn * Math.sin(phase);
    }

    for (let k = fftFrameSize + 2; k < 2 * fftFrameSize; k += 1) {
      state.fftWork[k] = 0;
    }

    stft(state.fftWork, fftFrameSize, 1);

    for (let k = 0; k < fftFrameSize; k += 1) {
      const window = this.window[k];
      state.outputAccum[k] +=
        (2 * window * state.fftWork[2 * k]) / (fftFrameSize2 * this.osamp);
    }

    for (let k = 0; k < this.stepSize; k += 1) {
      state.outFIFO[k] = state.outputAccum[k];
    }

    for (let k = 0; k < fftFrameSize; k += 1) {
      state.outputAccum[k] = state.outputAccum[k + this.stepSize];
    }

    for (let k = 0; k < this.inFifoLatency; k += 1) {
      state.inFIFO[k] = state.inFIFO[k + this.stepSize];
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    this.ensureChannels(output.length);
    const pitch = parameters.pitch.length > 0 ? parameters.pitch[0] : 0;
    const pitchRatio = Math.pow(2, pitch / 12);

    for (let channel = 0; channel < output.length; channel += 1) {
      const outChannel = output[channel];
      const inChannel = input?.[channel];
      const state = this.channels[channel];

      for (let i = 0; i < outChannel.length; i += 1) {
        const sample = inChannel ? inChannel[i] : 0;
        state.inFIFO[state.rover] = sample;
        outChannel[i] = state.outFIFO[state.rover - this.inFifoLatency];
        state.rover += 1;

        if (state.rover >= this.fftFrameSize) {
          state.rover = this.inFifoLatency;
          this.processFrame(state, pitchRatio);
        }
      }
    }

    return true;
  }
}

registerProcessor("pitch-vocoder-processor", PitchVocoderProcessor);
