type ChannelState = {
  buffer: Float32Array;
  lastMagnitudes: Float32Array | null;
  lastNonSilentMagnitudes: Float32Array | null;
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

  if (sign === 1) {
    const scale = 1.0 / (2 * fftFrameSize);
    for (i = 0; i < 2 * fftFrameSize; i += 1) {
      fftBuffer[i] *= scale;
    }
  }
};

const createWindow = (winSize: number) => {
  const winArray = new Float32Array(winSize);
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < winSize; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((twoPi * i) / (winSize - 1));
    winArray[i] = hann;
  }
  return winArray;
};

class PaulStretchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "ratio",
        defaultValue: 1,
        minValue: 1,
        maxValue: 16,
        automationRate: "k-rate",
      },
    ];
  }

  private readonly winSize: number;
  private readonly hopOut: number;
  private readonly window: Float32Array;
  private readonly hopScale: number;
  private baseRatio = 1;
  private debugSent = false;
  private inputDoneSent = false;
  private outputDoneSent = false;
  private inputFrames = 0;
  private tailFrames = 0;
  private zeroFrames = 0;
  private channels: ChannelState[] = [];
  private writePos = 0;
  private readPos = 0;
  private outPos = 0;
  private hopIn = 0;
  private outBlock: Float32Array[] = [];
  private fftWork: Float32Array[] = [];
  private outputAccum: Float32Array[] = [];
  private maxInputSamples: number | null = null;
  private maxOutputSamples: number | null = null;
  private inputSamplesWritten = 0;
  private outputSamplesEmitted = 0;
  private outputSamplesTotal = 0;
  private hasSpectrum = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const config = options?.processorOptions ?? {};
    const requestedSize = clamp(Number(config.winSize) || 4096, 1024, 16384);
    const winSize = isPowerOfTwo(requestedSize) ? requestedSize : 4096;
    const initialRatio = Number(config.ratio);
    const inputSamples = Number(config.inputSamples);
    const outputSamples = Number(config.outputSamples);
    this.winSize = winSize;
    this.hopOut = winSize >> 2;
    this.window = createWindow(winSize);
    // Normalize overlap-add so perceived loudness stays closer to the input.
    let windowEnergy = 0;
    for (let i = 0; i < winSize; i += 1) {
      windowEnergy += this.window[i] * this.window[i];
    }
    this.hopScale = windowEnergy > 0 ? this.hopOut / windowEnergy : 1;
    if (Number.isFinite(initialRatio) && initialRatio > 0) {
      this.baseRatio = clamp(initialRatio, 1, 16);
    }
    if (Number.isFinite(inputSamples) && inputSamples > 0) {
      this.maxInputSamples = Math.floor(inputSamples);
    }
    if (Number.isFinite(outputSamples) && outputSamples > 0) {
      this.maxOutputSamples = Math.floor(outputSamples);
    }
    if (
      this.maxInputSamples !== null &&
      this.maxOutputSamples !== null &&
      this.maxInputSamples > 0
    ) {
      const derivedRatio = this.maxOutputSamples / this.maxInputSamples;
      if (Number.isFinite(derivedRatio)) {
        this.baseRatio = clamp(derivedRatio, 1, 16);
      }
    }
    this.setRatio(this.baseRatio);
  }

  private setRatio(ratio: number) {
    const safeRatio = clamp(Number.isFinite(ratio) ? ratio : 1, 1, 16);
    this.hopIn = Math.max(1, Math.floor(this.hopOut / safeRatio));
  }

  private ensureChannels(count: number) {
    if (this.channels.length === count) return;
    this.channels = [];
    this.outBlock = [];
    this.fftWork = [];
    this.outputAccum = [];
    const bufferSize = this.winSize * 8;
    for (let i = 0; i < count; i += 1) {
      this.channels.push({
        buffer: new Float32Array(bufferSize),
        lastMagnitudes: null,
        lastNonSilentMagnitudes: null,
      });
      this.outBlock.push(new Float32Array(this.hopOut));
      this.fftWork.push(new Float32Array(2 * this.winSize));
      this.outputAccum.push(new Float32Array(this.winSize));
    }
    this.writePos = 0;
    this.readPos = 0;
    this.outPos = this.hopOut;
    this.inputSamplesWritten = 0;
    this.outputSamplesEmitted = 0;
    this.outputSamplesTotal = 0;
    this.hasSpectrum = false;
    this.debugSent = false;
    this.inputDoneSent = false;
    this.outputDoneSent = false;
    this.inputFrames = 0;
    this.tailFrames = 0;
    this.zeroFrames = 0;
  }

  private processFrameFromInput(allowZeroPad = false, inputDone = false) {
    const half = this.winSize >> 1;
    const inputLimit = this.maxInputSamples;
    let frameEnergy = 0;
    const minFrameEnergy = 1e-3;
    for (let ch = 0; ch < this.channels.length; ch += 1) {
      const channel = this.channels[ch];
      const buffer = channel.buffer;
      const fft = this.fftWork[ch];
      const outputAccum = this.outputAccum[ch];
      let magnitudes = channel.lastMagnitudes;
      if (!magnitudes || magnitudes.length !== half + 1) {
        magnitudes = new Float32Array(half + 1);
        channel.lastMagnitudes = magnitudes;
      }

      for (let i = 0; i < this.winSize; i += 1) {
        const absoluteIndex = this.readPos + i;
        let sample = 0;
        if (!allowZeroPad || inputLimit === null || absoluteIndex < inputLimit) {
          const idx = absoluteIndex % buffer.length;
          sample = buffer[idx];
        }
        fft[2 * i] = sample * this.window[i];
        fft[2 * i + 1] = 0;
        frameEnergy += sample * sample;
      }

      if (inputDone && this.hasSpectrum && frameEnergy < minFrameEnergy) {
        this.processFrameFromMagnitudes();
        continue;
      }

      stft(fft, this.winSize, -1);

      for (let i = 0; i <= half; i += 1) {
        const re = fft[2 * i];
        const im = fft[2 * i + 1];
        const magn = Math.sqrt(re * re + im * im);
        magnitudes[i] = magn;
        const phase = Math.random() * 2 * Math.PI;
        fft[2 * i] = magn * Math.cos(phase);
        fft[2 * i + 1] = magn * Math.sin(phase);
      }
      if (frameEnergy >= minFrameEnergy) {
        channel.lastNonSilentMagnitudes = new Float32Array(magnitudes);
      }

      for (let i = 1; i < half; i += 1) {
        const mirror = this.winSize - i;
        fft[2 * mirror] = fft[2 * i];
        fft[2 * mirror + 1] = -fft[2 * i + 1];
      }

      stft(fft, this.winSize, 1);

      for (let i = 0; i < this.winSize; i += 1) {
        outputAccum[i] += fft[2 * i] * this.window[i];
      }

      const out = this.outBlock[ch];
      for (let i = 0; i < this.hopOut; i += 1) {
        out[i] = outputAccum[i];
      }

      outputAccum.copyWithin(0, this.hopOut);
      outputAccum.fill(0, this.winSize - this.hopOut);
    }

    this.readPos += this.hopIn;
  }

  private processFrameFromMagnitudes() {
    const half = this.winSize >> 1;
    for (let ch = 0; ch < this.channels.length; ch += 1) {
      const channel = this.channels[ch];
      const fft = this.fftWork[ch];
      const outputAccum = this.outputAccum[ch];
      const magnitudes =
        channel.lastNonSilentMagnitudes ?? channel.lastMagnitudes;

      if (!magnitudes) {
        fft.fill(0);
      } else {
        for (let i = 0; i <= half; i += 1) {
          const magn = magnitudes[i];
          const phase = Math.random() * 2 * Math.PI;
          fft[2 * i] = magn * Math.cos(phase);
          fft[2 * i + 1] = magn * Math.sin(phase);
        }
        for (let i = 1; i < half; i += 1) {
          const mirror = this.winSize - i;
          fft[2 * mirror] = fft[2 * i];
          fft[2 * mirror + 1] = -fft[2 * i + 1];
        }
      }

      stft(fft, this.winSize, 1);

      for (let i = 0; i < this.winSize; i += 1) {
        outputAccum[i] += fft[2 * i] * this.window[i];
      }

      const out = this.outBlock[ch];
      for (let i = 0; i < this.hopOut; i += 1) {
        out[i] = outputAccum[i] * this.hopScale;
      }

      outputAccum.copyWithin(0, this.hopOut);
      outputAccum.fill(0, this.winSize - this.hopOut);
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    this.ensureChannels(output.length);
    const ratioParam = parameters.ratio.length ? parameters.ratio[0] : this.baseRatio;
    const ratioValue = Number.isFinite(ratioParam) ? ratioParam : this.baseRatio;
    const resolvedRatio =
      this.baseRatio !== 1 && ratioValue === 1 ? this.baseRatio : ratioValue;
    this.setRatio(resolvedRatio);
    if (!this.debugSent) {
      this.debugSent = true;
      this.port.postMessage({
        type: "paulstretch-debug",
        baseRatio: this.baseRatio,
        ratioParam: ratioParam,
        resolvedRatio,
        hopIn: this.hopIn,
        hopOut: this.hopOut,
        inputSamples: this.maxInputSamples,
        outputSamples: this.maxOutputSamples,
        paramLength: parameters.ratio.length,
      });
    }

    for (let i = 0; i < output[0].length; i += 1) {
      const canWriteInput =
        this.maxInputSamples === null || this.inputSamplesWritten < this.maxInputSamples;
      if (canWriteInput) {
        for (let ch = 0; ch < output.length; ch += 1) {
          const inChannel = input?.[ch];
          const sample = inChannel ? inChannel[i] : 0;
          const buffer = this.channels[ch].buffer;
          buffer[this.writePos % buffer.length] = sample;
        }
        this.writePos += 1;
        this.inputSamplesWritten += 1;
      }

      if (this.outPos >= this.hopOut) {
        const hasInputFrame = this.writePos - this.readPos >= this.winSize;
        const inputDone =
          this.maxInputSamples !== null && this.inputSamplesWritten >= this.maxInputSamples;
        const inputLimit = this.maxInputSamples;
        const inputFrameWouldPad =
          inputDone &&
          inputLimit !== null &&
          this.readPos + this.winSize > inputLimit &&
          this.hasSpectrum;
        const hasPartialFrame = inputDone && this.writePos > this.readPos;
        const canSynthesizeTail =
          this.maxOutputSamples !== null &&
          this.outputSamplesTotal < this.maxOutputSamples &&
          inputDone &&
          this.hasSpectrum;

        if (hasInputFrame && !inputFrameWouldPad) {
          this.processFrameFromInput(false, inputDone);
          this.inputFrames += 1;
          this.hasSpectrum = true;
          this.outPos = 0;
        } else if (hasPartialFrame && !this.hasSpectrum) {
          this.processFrameFromInput(true, inputDone);
          this.inputFrames += 1;
          this.hasSpectrum = true;
          this.outPos = 0;
        } else if (canSynthesizeTail) {
          // Preserve the last viable magnitudes when input is done to avoid
          // tail energy collapsing to silence.
          for (let ch = 0; ch < this.channels.length; ch += 1) {
            const channel = this.channels[ch];
            if (!channel.lastMagnitudes) continue;
            for (let i = 0; i < channel.lastMagnitudes.length; i += 1) {
              channel.lastMagnitudes[i] = Math.max(channel.lastMagnitudes[i], 1e-3);
            }
          }
          this.processFrameFromMagnitudes();
          this.tailFrames += 1;
          this.outPos = 0;
        } else {
          this.outPos = 0;
          for (let ch = 0; ch < output.length; ch += 1) {
            this.outBlock[ch].fill(0);
          }
          this.zeroFrames += 1;
        }
      }

      for (let ch = 0; ch < output.length; ch += 1) {
        output[ch][i] = this.outBlock[ch][this.outPos] ?? 0;
      }
      this.outPos += 1;
      this.outputSamplesTotal += 1;
      if (this.hasSpectrum) {
        this.outputSamplesEmitted += 1;
      }
    }

    const inputDoneNow =
      this.maxInputSamples !== null && this.inputSamplesWritten >= this.maxInputSamples;
    if (inputDoneNow && !this.inputDoneSent) {
      this.inputDoneSent = true;
      this.port.postMessage({
        type: "paulstretch-input-done",
        inputSamples: this.maxInputSamples,
        outputSamples: this.maxOutputSamples,
        outputSamplesEmitted: this.outputSamplesEmitted,
        outputSamplesTotal: this.outputSamplesTotal,
        inputFrames: this.inputFrames,
        tailFrames: this.tailFrames,
        zeroFrames: this.zeroFrames,
        readPos: this.readPos,
        writePos: this.writePos,
      });
    }
    if (
      this.maxOutputSamples !== null &&
      this.outputSamplesTotal >= this.maxOutputSamples
    ) {
      if (this.outputDoneSent) {
        return true;
      }
      this.outputDoneSent = true;
      this.port.postMessage({
        type: "paulstretch-output-done",
        inputSamples: this.maxInputSamples,
        outputSamples: this.maxOutputSamples,
        outputSamplesEmitted: this.outputSamplesEmitted,
        outputSamplesTotal: this.outputSamplesTotal,
        inputFrames: this.inputFrames,
        tailFrames: this.tailFrames,
        zeroFrames: this.zeroFrames,
        readPos: this.readPos,
        writePos: this.writePos,
      });
    }

    return true;
  }
}

registerProcessor("paul-stretch-processor", PaulStretchProcessor);
