export {};

type ChannelState = {
  buffer: Float32Array;
  lastMagnitudes: Float32Array | null;
  lastNonSilentMagnitudes: Float32Array | null;
  lastPhases: Float32Array | null;
  phaseRe: Float32Array | null;
  phaseIm: Float32Array | null;
};

type PaulStretchWasmExports = WebAssembly.Exports & {
  memory?: WebAssembly.Memory;
  malloc?: (size: number) => number;
  free?: (ptr: number) => void;
  paulstretch_overlap_add_f32?: (
    fftPtr: number,
    windowPtr: number,
    outputAccumPtr: number,
    outBlockPtr: number,
    winSize: number,
    hopOut: number,
    gain: number
  ) => number;
  paulstretch_analyze_bins_f32?: (
    fftPtr: number,
    magnitudesPtr: number,
    phaseRePtr: number,
    phaseImPtr: number,
    tiltPtr: number,
    halfBins: number,
    smoothFactor: number,
    phaseRandomness: number,
    rngStatePtr: number
  ) => number;
  paulstretch_synthesize_bins_f32?: (
    fftPtr: number,
    magnitudesPtr: number,
    phaseRePtr: number,
    phaseImPtr: number,
    tiltPtr: number,
    halfBins: number,
    phaseRandomness: number,
    rngStatePtr: number
  ) => number;
  paulstretch_mirror_bins_f32?: (fftPtr: number, winSize: number, half: number) => number;
};

type DspCoreWasmExports = WebAssembly.Exports & {
  memory?: WebAssembly.Memory;
  malloc?: (size: number) => number;
  dsp_fft_f32?: (
    fftPtr: number,
    fftFrameSize: number,
    sign: number,
    normalizeInverse: number,
    bitrevPairsPtr: number,
    bitrevPairCount: number,
    twiddleRePtr: number,
    twiddleImPtr: number,
    twiddleCount: number
  ) => number;
  dsp_overlap_add_real_f32?: (
    fftPtr: number,
    windowPtr: number,
    outputAccumPtr: number,
    outBlockPtr: number,
    winSize: number,
    hopOut: number,
    windowScale: number,
    outGain: number
  ) => number;
};

const reverseBits = (value: number, bits: number) => {
  let input = value;
  let result = 0;
  for (let i = 0; i < bits; i += 1) {
    result = (result << 1) | (input & 1);
    input >>= 1;
  }
  return result;
};

const createBitrevSwapPairs = (fftFrameSize: number) => {
  const bits = Math.round(Math.log2(fftFrameSize));
  const pairs: number[] = [];
  for (let i = 0; i < fftFrameSize; i += 1) {
    const j = reverseBits(i, bits);
    if (i < j) {
      pairs.push(i, j);
    }
  }
  return Int32Array.from(pairs);
};

const createFftTwiddles = (fftFrameSize: number) => {
  const count = Math.max(1, fftFrameSize - 1);
  const re = new Float32Array(count);
  const im = new Float32Array(count);
  let index = 0;
  for (let step = 2; step <= fftFrameSize; step <<= 1) {
    const half = step >> 1;
    for (let m = 0; m < half; m += 1) {
      const arg = (2 * Math.PI * m) / step;
      re[index] = Math.cos(arg);
      im[index] = Math.sin(arg);
      index += 1;
    }
  }
  return { re, im, count: index };
};

class PaulStretchWasmOverlapAdd {
  private readonly fn: NonNullable<PaulStretchWasmExports["paulstretch_overlap_add_f32"]>;
  private readonly analyzeFn: NonNullable<PaulStretchWasmExports["paulstretch_analyze_bins_f32"]>;
  private readonly synthFn: NonNullable<PaulStretchWasmExports["paulstretch_synthesize_bins_f32"]>;
  private readonly mirrorFn: NonNullable<PaulStretchWasmExports["paulstretch_mirror_bins_f32"]>;
  private readonly fftPtr: number;
  private readonly windowPtr: number;
  private readonly outputAccumPtr: number;
  private readonly outBlockPtr: number;
  private readonly magnitudesPtr: number;
  private readonly phaseRePtr: number;
  private readonly phaseImPtr: number;
  private readonly tiltPtr: number;
  private readonly rngPtr: number;
  private readonly fftView: Float32Array;
  private readonly windowView: Float32Array;
  private readonly outputAccumView: Float32Array;
  private readonly outBlockView: Float32Array;
  private readonly magnitudesView: Float32Array;
  private readonly phaseReView: Float32Array;
  private readonly phaseImView: Float32Array;
  private readonly tiltView: Float32Array;
  private readonly rngView: Uint32Array;
  private readonly halfBins: number;

  constructor(bytes: ArrayBuffer, winSize: number, hopOut: number, window: Float32Array) {
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module, {});
    const exports = instance.exports as PaulStretchWasmExports;
    const memory = exports.memory;
    const malloc = exports.malloc;
    const fn = exports.paulstretch_overlap_add_f32;
    const analyzeFn = exports.paulstretch_analyze_bins_f32;
    const synthFn = exports.paulstretch_synthesize_bins_f32;
    const mirrorFn = exports.paulstretch_mirror_bins_f32;
    if (!memory || !malloc || !fn || !analyzeFn || !synthFn || !mirrorFn) {
      throw new Error("Paulstretch wasm missing required exports");
    }
    this.fn = fn;
    this.analyzeFn = analyzeFn;
    this.synthFn = synthFn;
    this.mirrorFn = mirrorFn;
    const fftBytes = winSize * 2 * 4;
    const winBytes = winSize * 4;
    const outputAccumBytes = winSize * 4;
    const outBytes = hopOut * 4;
    const halfBins = (winSize >> 1) + 1;
    const binsBytes = halfBins * 4;
    this.fftPtr = malloc(fftBytes);
    this.windowPtr = malloc(winBytes);
    this.outputAccumPtr = malloc(outputAccumBytes);
    this.outBlockPtr = malloc(outBytes);
    this.magnitudesPtr = malloc(binsBytes);
    this.phaseRePtr = malloc(binsBytes);
    this.phaseImPtr = malloc(binsBytes);
    this.tiltPtr = malloc(binsBytes);
    this.rngPtr = malloc(4);
    if (
      !this.fftPtr ||
      !this.windowPtr ||
      !this.outputAccumPtr ||
      !this.outBlockPtr ||
      !this.magnitudesPtr ||
      !this.phaseRePtr ||
      !this.phaseImPtr ||
      !this.tiltPtr ||
      !this.rngPtr
    ) {
      throw new Error("Paulstretch wasm allocation failed");
    }
    this.fftView = new Float32Array(memory.buffer, this.fftPtr, winSize * 2);
    this.windowView = new Float32Array(memory.buffer, this.windowPtr, winSize);
    this.outputAccumView = new Float32Array(memory.buffer, this.outputAccumPtr, winSize);
    this.outBlockView = new Float32Array(memory.buffer, this.outBlockPtr, hopOut);
    this.halfBins = halfBins;
    this.magnitudesView = new Float32Array(memory.buffer, this.magnitudesPtr, halfBins);
    this.phaseReView = new Float32Array(memory.buffer, this.phaseRePtr, halfBins);
    this.phaseImView = new Float32Array(memory.buffer, this.phaseImPtr, halfBins);
    this.tiltView = new Float32Array(memory.buffer, this.tiltPtr, halfBins);
    this.rngView = new Uint32Array(memory.buffer, this.rngPtr, 1);
    this.rngView[0] = 0x12345678;
    this.windowView.set(window);
  }

  process(
    fft: Float32Array,
    outputAccum: Float32Array,
    outBlock: Float32Array,
    winSize: number,
    hopOut: number,
    gain: number
  ) {
    this.fftView.set(fft);
    this.outputAccumView.set(outputAccum);
    const ok = this.fn(
      this.fftPtr,
      this.windowPtr,
      this.outputAccumPtr,
      this.outBlockPtr,
      winSize,
      hopOut,
      gain
    );
    if (ok !== 1) return false;
    outputAccum.set(this.outputAccumView);
    outBlock.set(this.outBlockView);
    return true;
  }

  analyzeBins(
    fft: Float32Array,
    magnitudes: Float32Array,
    phaseRe: Float32Array,
    phaseIm: Float32Array,
    tiltCurve: Float32Array,
    smoothFactor: number,
    phaseRandomness: number
  ) {
    this.fftView.set(fft);
    this.magnitudesView.set(magnitudes);
    this.phaseReView.set(phaseRe);
    this.phaseImView.set(phaseIm);
    this.tiltView.set(tiltCurve);
    const ok = this.analyzeFn(
      this.fftPtr,
      this.magnitudesPtr,
      this.phaseRePtr,
      this.phaseImPtr,
      this.tiltPtr,
      this.halfBins,
      smoothFactor,
      phaseRandomness,
      this.rngPtr
    );
    if (ok !== 1) return false;
    fft.set(this.fftView);
    magnitudes.set(this.magnitudesView);
    phaseRe.set(this.phaseReView);
    phaseIm.set(this.phaseImView);
    return true;
  }

  synthesizeBins(
    fft: Float32Array,
    magnitudes: Float32Array,
    phaseRe: Float32Array,
    phaseIm: Float32Array,
    tiltCurve: Float32Array,
    phaseRandomness: number
  ) {
    this.fftView.set(fft);
    this.magnitudesView.set(magnitudes);
    this.phaseReView.set(phaseRe);
    this.phaseImView.set(phaseIm);
    this.tiltView.set(tiltCurve);
    const ok = this.synthFn(
      this.fftPtr,
      this.magnitudesPtr,
      this.phaseRePtr,
      this.phaseImPtr,
      this.tiltPtr,
      this.halfBins,
      phaseRandomness,
      this.rngPtr
    );
    if (ok !== 1) return false;
    fft.set(this.fftView);
    return true;
  }

  mirrorBins(fft: Float32Array, winSize: number, half: number) {
    this.fftView.set(fft);
    const ok = this.mirrorFn(this.fftPtr, winSize, half);
    if (ok !== 1) return false;
    fft.set(this.fftView);
    return true;
  }
}

class DspCoreFftWasm {
  private readonly fn: NonNullable<DspCoreWasmExports["dsp_fft_f32"]>;
  private readonly overlapFn: NonNullable<DspCoreWasmExports["dsp_overlap_add_real_f32"]>;
  private readonly fftPtr: number;
  private readonly windowPtr: number;
  private readonly outputAccumPtr: number;
  private readonly outBlockPtr: number;
  private readonly bitrevPairsPtr: number;
  private readonly twiddleRePtr: number;
  private readonly twiddleImPtr: number;
  private readonly fftView: Float32Array;
  private readonly outputAccumView: Float32Array;
  private readonly outBlockView: Float32Array;
  private readonly bitrevPairCount: number;
  private readonly twiddleCount: number;
  private readonly normalizeInverse: number;

  constructor(
    bytes: ArrayBuffer,
    fftFrameSize: number,
    window: Float32Array,
    normalizeInverse: number
  ) {
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module, {});
    const exports = instance.exports as DspCoreWasmExports;
    const memory = exports.memory;
    const malloc = exports.malloc;
    const fn = exports.dsp_fft_f32;
    const overlapFn = exports.dsp_overlap_add_real_f32;
    if (!memory || !malloc || !fn || !overlapFn) {
      throw new Error("DSP core wasm missing required FFT exports");
    }
    this.fn = fn;
    this.overlapFn = overlapFn;
    this.normalizeInverse = normalizeInverse ? 1 : 0;

    const bitrevPairs = createBitrevSwapPairs(fftFrameSize);
    const bitrevPairCount = bitrevPairs.length / 2;
    const twiddles = createFftTwiddles(fftFrameSize);
    const twiddleCount = twiddles.count;

    this.fftPtr = malloc(fftFrameSize * 2 * 4);
    this.windowPtr = malloc(fftFrameSize * 4);
    this.outputAccumPtr = malloc(fftFrameSize * 4);
    this.outBlockPtr = malloc(fftFrameSize * 4);
    this.bitrevPairsPtr = malloc(bitrevPairs.length * 4);
    this.twiddleRePtr = malloc(twiddleCount * 4);
    this.twiddleImPtr = malloc(twiddleCount * 4);
    if (
      !this.fftPtr ||
      !this.windowPtr ||
      !this.outputAccumPtr ||
      !this.outBlockPtr ||
      !this.bitrevPairsPtr ||
      !this.twiddleRePtr ||
      !this.twiddleImPtr
    ) {
      throw new Error("DSP core wasm FFT allocation failed");
    }

    this.fftView = new Float32Array(memory.buffer, this.fftPtr, fftFrameSize * 2);
    new Float32Array(memory.buffer, this.windowPtr, fftFrameSize).set(window);
    this.outputAccumView = new Float32Array(memory.buffer, this.outputAccumPtr, fftFrameSize);
    this.outBlockView = new Float32Array(memory.buffer, this.outBlockPtr, fftFrameSize);
    new Int32Array(memory.buffer, this.bitrevPairsPtr, bitrevPairs.length).set(bitrevPairs);
    new Float32Array(memory.buffer, this.twiddleRePtr, twiddleCount).set(
      twiddles.re.subarray(0, twiddleCount)
    );
    new Float32Array(memory.buffer, this.twiddleImPtr, twiddleCount).set(
      twiddles.im.subarray(0, twiddleCount)
    );
    this.bitrevPairCount = bitrevPairCount;
    this.twiddleCount = twiddleCount;
  }

  run(fftBuffer: Float32Array, fftFrameSize: number, sign: number) {
    this.fftView.set(fftBuffer);
    const ok = this.fn(
      this.fftPtr,
      fftFrameSize,
      sign,
      this.normalizeInverse,
      this.bitrevPairsPtr,
      this.bitrevPairCount,
      this.twiddleRePtr,
      this.twiddleImPtr,
      this.twiddleCount
    );
    if (ok !== 1) return false;
    fftBuffer.set(this.fftView);
    return true;
  }

  overlapAdd(
    fftBuffer: Float32Array,
    outputAccum: Float32Array,
    outBlock: Float32Array,
    fftFrameSize: number,
    hopOut: number,
    windowScale: number,
    outGain: number
  ) {
    this.fftView.set(fftBuffer);
    this.outputAccumView.set(outputAccum.subarray(0, fftFrameSize));
    const ok = this.overlapFn(
      this.fftPtr,
      this.windowPtr,
      this.outputAccumPtr,
      this.outBlockPtr,
      fftFrameSize,
      hopOut,
      windowScale,
      outGain
    );
    if (ok !== 1) return false;
    outputAccum.set(this.outputAccumView, 0);
    outBlock.set(this.outBlockView.subarray(0, hopOut));
    return true;
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0;

const blendPhase = (base: number, random: number, amount: number) => {
  if (amount <= 0) return base;
  if (amount >= 1) return random;
  const baseRe = Math.cos(base);
  const baseIm = Math.sin(base);
  const randRe = Math.cos(random);
  const randIm = Math.sin(random);
  const mixRe = baseRe * (1 - amount) + randRe * amount;
  const mixIm = baseIm * (1 - amount) + randIm * amount;
  return Math.atan2(mixIm, mixRe);
};

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
      {
        name: "phaseRandomness",
        defaultValue: 0.5,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "stereoWidth",
        defaultValue: 1,
        minValue: 0,
        maxValue: 2,
        automationRate: "k-rate",
      },
      {
        name: "tilt",
        defaultValue: 0,
        minValue: -18,
        maxValue: 18,
        automationRate: "k-rate",
      },
      {
        name: "scatter",
        defaultValue: 1,
        minValue: 1,
        maxValue: 4,
        automationRate: "k-rate",
      },
    ];
  }

  private readonly winSize: number;
  private readonly hopOut: number;
  private readonly window: Float32Array;
  private readonly hopScale: number;
  private readonly overlapAddWasm: PaulStretchWasmOverlapAdd | null;
  private readonly fftWasm: DspCoreFftWasm | null;
  private outputStride: number;
  private smoothFactor = 0.6;
  private baseRatio = 1;
  private phaseRandomness = 1;
  private stereoWidth = 1;
  private tiltDb = 0;
  private scatter = 1;
  private tiltCurve: Float32Array = new Float32Array(0);
  private baseHopIn = 0;
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
  private hasInitialRatio = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const config = options?.processorOptions ?? {};
    const requestedSize = clamp(Number(config.winSize) || 4096, 1024, 16384);
    const winSize = isPowerOfTwo(requestedSize) ? requestedSize : 4096;
    const initialRatio = Number(config.ratio);
    const inputSamples = Number(config.inputSamples);
    const outputSamples = Number(config.outputSamples);
    this.winSize = winSize;
    this.hopOut = winSize >> 3;
    this.outputStride = this.hopOut;
    this.window = createWindow(winSize);
    const paulStretchWasmBytes = config.paulStretchWasmBytes;
    if (paulStretchWasmBytes instanceof ArrayBuffer) {
      try {
        this.overlapAddWasm = new PaulStretchWasmOverlapAdd(
          paulStretchWasmBytes,
          this.winSize,
          this.hopOut,
          this.window
        );
      } catch {
        this.overlapAddWasm = null;
      }
    } else {
      this.overlapAddWasm = null;
    }
    const dspCoreWasmBytes = config.dspCoreWasmBytes;
    if (dspCoreWasmBytes instanceof ArrayBuffer) {
      try {
        this.fftWasm = new DspCoreFftWasm(dspCoreWasmBytes, this.winSize, this.window, 1);
      } catch {
        this.fftWasm = null;
      }
    } else {
      this.fftWasm = null;
    }
    // Normalize overlap-add so perceived loudness stays closer to the input.
    let windowEnergy = 0;
    for (let i = 0; i < winSize; i += 1) {
      windowEnergy += this.window[i] * this.window[i];
    }
    this.hopScale = windowEnergy > 0 ? (this.hopOut / windowEnergy) * 0.9 : 0.9;
    if (Number.isFinite(initialRatio) && initialRatio > 0) {
      this.hasInitialRatio = true;
      this.baseRatio = clamp(initialRatio, 1, 16);
    }
    if (Number.isFinite(inputSamples) && inputSamples > 0) {
      this.maxInputSamples = Math.floor(inputSamples);
    }
    if (Number.isFinite(outputSamples) && outputSamples > 0) {
      this.maxOutputSamples = Math.floor(outputSamples);
    }
    if (
      !this.hasInitialRatio &&
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
    this.setTilt(this.tiltDb);
  }

  private setRatio(ratio: number) {
    const safeRatio = clamp(Number.isFinite(ratio) ? ratio : 1, 1, 16);
    this.baseHopIn = Math.max(1, Math.floor(this.hopOut / safeRatio));
    this.hopIn = this.baseHopIn;
  }

  private advanceReadPos() {
    this.readPos += this.hopIn;
  }

  private setTilt(tiltDb: number) {
    const safeTilt = clamp(Number.isFinite(tiltDb) ? tiltDb : 0, -18, 18);
    if (Math.abs(safeTilt - this.tiltDb) < 0.001 && this.tiltCurve.length) {
      return;
    }
    this.tiltDb = safeTilt;
    const half = this.winSize >> 1;
    const curve = new Float32Array(half + 1);
    for (let i = 0; i <= half; i += 1) {
      const t = half > 0 ? i / half : 0;
      const gainDb = safeTilt * (t - 0.5);
      curve[i] = Math.pow(10, gainDb / 20);
    }
    this.tiltCurve = curve;
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
        lastPhases: null,
        phaseRe: null,
        phaseIm: null,
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

  private ensureInputRingCapacity(extraSamples = 0) {
    const unreadSamples = Math.max(0, this.writePos - this.readPos);
    const required = unreadSamples + Math.max(0, extraSamples) + 1;
    const current = this.channels[0]?.buffer.length ?? 0;
    if (required < current) return;
    let nextSize = Math.max(current, this.winSize * 8);
    while (nextSize <= required + this.winSize * 2) {
      nextSize <<= 1;
    }
    for (let ch = 0; ch < this.channels.length; ch += 1) {
      const previous = this.channels[ch].buffer;
      const next = new Float32Array(nextSize);
      for (let pos = this.readPos; pos < this.writePos; pos += 1) {
        next[pos % nextSize] = previous[pos % previous.length];
      }
      this.channels[ch].buffer = next;
    }
  }

  private overlapAdd(
    fft: Float32Array,
    outputAccum: Float32Array,
    out: Float32Array,
    gain: number
  ) {
    const usedSharedWasm =
      this.fftWasm?.overlapAdd(
        fft,
        outputAccum,
        out,
        this.winSize,
        this.hopOut,
        1,
        gain
      ) ?? false;
    if (usedSharedWasm) return;

    const usedEffectWasm =
      this.overlapAddWasm?.process(
        fft,
        outputAccum,
        out,
        this.winSize,
        this.hopOut,
        gain
      ) ?? false;
    if (usedEffectWasm) return;

    for (let i = 0; i < this.winSize; i += 1) {
      outputAccum[i] += fft[2 * i] * this.window[i];
    }

    for (let i = 0; i < this.hopOut; i += 1) {
      out[i] = outputAccum[i] * gain;
    }

    outputAccum.copyWithin(0, this.hopOut);
    outputAccum.fill(0, this.winSize - this.hopOut);
  }

  private runFft(fft: Float32Array, sign: number) {
    const usedWasm = this.fftWasm?.run(fft, this.winSize, sign) ?? false;
    if (usedWasm) return;
    stft(fft, this.winSize, sign);
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
      let phases = channel.lastPhases;
      let phaseRe = channel.phaseRe;
      let phaseIm = channel.phaseIm;
      if (!magnitudes || magnitudes.length !== half + 1) {
        magnitudes = new Float32Array(half + 1);
        channel.lastMagnitudes = magnitudes;
      }
      if (!phases || phases.length !== half + 1) {
        phases = new Float32Array(half + 1);
        channel.lastPhases = phases;
      }
      if (!phaseRe || phaseRe.length !== half + 1) {
        phaseRe = new Float32Array(half + 1);
        phaseRe.fill(1);
        channel.phaseRe = phaseRe;
      }
      if (!phaseIm || phaseIm.length !== half + 1) {
        phaseIm = new Float32Array(half + 1);
        channel.phaseIm = phaseIm;
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

      this.runFft(fft, -1);

      let usedWasmBins = false;
      if (this.overlapAddWasm) {
        usedWasmBins = this.overlapAddWasm.analyzeBins(
          fft,
          magnitudes,
          phaseRe,
          phaseIm,
          this.tiltCurve,
          this.smoothFactor,
          this.phaseRandomness
        );
      }
      if (!usedWasmBins) {
        for (let i = 0; i <= half; i += 1) {
          const re = fft[2 * i];
          const im = fft[2 * i + 1];
          const magn = Math.sqrt(re * re + im * im);
          const phase = Math.atan2(im, re);
          phases[i] = phase;
          const prev = magnitudes[i];
          const smoothed = prev
            ? this.smoothFactor * prev + (1 - this.smoothFactor) * magn
            : magn;
          magnitudes[i] = smoothed;
          const tiltGain = this.tiltCurve[i] ?? 1;
          const magnTilted = smoothed * tiltGain;
          const randomPhase = Math.random() * 2 * Math.PI;
          const phaseRand = blendPhase(phase, randomPhase, this.phaseRandomness);
          fft[2 * i] = magnTilted * Math.cos(phaseRand);
          fft[2 * i + 1] = magnTilted * Math.sin(phaseRand);
        }
      }
      if (frameEnergy >= minFrameEnergy) {
        channel.lastNonSilentMagnitudes = new Float32Array(magnitudes);
      }

      let usedWasmMirror = false;
      if (this.overlapAddWasm) {
        usedWasmMirror = this.overlapAddWasm.mirrorBins(fft, this.winSize, half);
      }
      if (!usedWasmMirror) {
        for (let i = 1; i < half; i += 1) {
          const mirror = this.winSize - i;
          fft[2 * mirror] = fft[2 * i];
          fft[2 * mirror + 1] = -fft[2 * i + 1];
        }
      }

      this.runFft(fft, 1);

      const out = this.outBlock[ch];
      this.overlapAdd(fft, outputAccum, out, this.hopScale);
    }

    this.advanceReadPos();
  }

  private processFrameFromMagnitudes() {
    const half = this.winSize >> 1;
    for (let ch = 0; ch < this.channels.length; ch += 1) {
      const channel = this.channels[ch];
      const fft = this.fftWork[ch];
      const outputAccum = this.outputAccum[ch];
      const magnitudes =
        channel.lastNonSilentMagnitudes ?? channel.lastMagnitudes;
      let phases = channel.lastPhases;
      let phaseRe = channel.phaseRe;
      let phaseIm = channel.phaseIm;
      if (!phases || phases.length !== half + 1) {
        phases = new Float32Array(half + 1);
        channel.lastPhases = phases;
      }
      if (!phaseRe || phaseRe.length !== half + 1) {
        phaseRe = new Float32Array(half + 1);
        phaseRe.fill(1);
        channel.phaseRe = phaseRe;
      }
      if (!phaseIm || phaseIm.length !== half + 1) {
        phaseIm = new Float32Array(half + 1);
        channel.phaseIm = phaseIm;
      }

      if (!magnitudes) {
        fft.fill(0);
      } else {
        let usedWasmBins = false;
        if (this.overlapAddWasm) {
          usedWasmBins = this.overlapAddWasm.synthesizeBins(
            fft,
            magnitudes,
            phaseRe,
            phaseIm,
            this.tiltCurve,
            this.phaseRandomness
          );
        }
        if (!usedWasmBins) {
          for (let i = 0; i <= half; i += 1) {
            const magn = magnitudes[i];
            const tiltGain = this.tiltCurve[i] ?? 1;
            const magnTilted = magn * tiltGain;
            const phase = phases[i] ?? 0;
            const randomPhase = Math.random() * 2 * Math.PI;
            const phaseRand = blendPhase(phase, randomPhase, this.phaseRandomness);
            fft[2 * i] = magnTilted * Math.cos(phaseRand);
            fft[2 * i + 1] = magnTilted * Math.sin(phaseRand);
          }
        }
        let usedWasmMirror = false;
        if (this.overlapAddWasm) {
          usedWasmMirror = this.overlapAddWasm.mirrorBins(fft, this.winSize, half);
        }
        if (!usedWasmMirror) {
          for (let i = 1; i < half; i += 1) {
            const mirror = this.winSize - i;
            fft[2 * mirror] = fft[2 * i];
            fft[2 * mirror + 1] = -fft[2 * i + 1];
          }
        }
      }

      this.runFft(fft, 1);

      const out = this.outBlock[ch];
      this.overlapAdd(fft, outputAccum, out, this.hopScale);
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
    const phaseParam = parameters.phaseRandomness.length
      ? parameters.phaseRandomness[0]
      : this.phaseRandomness;
    this.phaseRandomness = clamp(
      Number.isFinite(phaseParam) ? phaseParam : this.phaseRandomness,
      0,
      1
    );
    const widthParam = parameters.stereoWidth.length
      ? parameters.stereoWidth[0]
      : this.stereoWidth;
    this.stereoWidth = clamp(
      Number.isFinite(widthParam) ? widthParam : this.stereoWidth,
      0,
      2
    );
    const tiltParam = parameters.tilt.length ? parameters.tilt[0] : this.tiltDb;
    this.setTilt(tiltParam);
    const scatterParam = parameters.scatter.length ? parameters.scatter[0] : this.scatter;
    this.scatter = clamp(
      Number.isFinite(scatterParam) ? scatterParam : this.scatter,
      1,
      16
    );
    this.outputStride = Math.max(1, Math.floor(this.hopOut * this.scatter * this.scatter));
    if (!this.debugSent) {
      this.debugSent = true;
      this.port.postMessage({
        type: "paulstretch-debug",
        baseRatio: this.baseRatio,
        ratioParam: ratioParam,
        resolvedRatio,
        hopIn: this.hopIn,
        hopOut: this.hopOut,
        outputStride: this.outputStride,
        inputSamples: this.maxInputSamples,
        outputSamples: this.maxOutputSamples,
        paramLength: parameters.ratio.length,
        phaseRandomness: this.phaseRandomness,
        stereoWidth: this.stereoWidth,
        tiltDb: this.tiltDb,
        scatter: this.scatter,
        wasmOverlapAdd: this.overlapAddWasm !== null,
        wasmSharedOverlapAdd: this.fftWasm !== null,
        wasmBins: this.overlapAddWasm !== null,
        wasmFft: this.fftWasm !== null,
      });
    }

    for (let i = 0; i < output[0].length; i += 1) {
      const canWriteInput =
        this.maxInputSamples === null || this.inputSamplesWritten < this.maxInputSamples;
      if (canWriteInput) {
        this.ensureInputRingCapacity(1);
        for (let ch = 0; ch < output.length; ch += 1) {
          const inChannel = input?.[ch];
          const sample = inChannel ? inChannel[i] : 0;
          const buffer = this.channels[ch].buffer;
          buffer[this.writePos % buffer.length] = sample;
        }
        this.writePos += 1;
        this.inputSamplesWritten += 1;
      }

      if (this.outPos >= this.outputStride) {
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
        if (this.outPos < this.hopOut) {
          output[ch][i] = this.outBlock[ch][this.outPos] ?? 0;
        } else {
          const gap = this.outputStride - this.hopOut;
          const fade =
            gap > 0 ? Math.max(0, 1 - (this.outPos - this.hopOut) / gap) : 0;
          const index = this.outPos % this.hopOut;
          output[ch][i] = (this.outBlock[ch][index] ?? 0) * fade;
        }
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
