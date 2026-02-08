export {};

type PingPongConfigMessage = {
  type: "config";
  enabled: boolean;
  loopStart: number;
  loopEnd: number;
  playbackRate: number;
  regions: number[];
  sliceDelaySec: number;
  anchorTime: number;
  anchorPosition: number;
};

type PingPongDisableMessage = {
  type: "disable";
};

type PingPongMessage = PingPongConfigMessage | PingPongDisableMessage;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const toSafeRegions = (regions: number[]) => {
  const points = regions.filter((value) => Number.isFinite(value)).map((value) => clamp(value, 0, 1));
  if (points.length < 2) return [0, 1];
  points.sort((a, b) => a - b);
  if (points[0] > 0) points.unshift(0);
  if (points[points.length - 1] < 1) points.push(1);
  return points;
};

class RearrangerPingPongProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "amount",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }

  private enabled = false;
  private loopStart = 0;
  private loopEnd = 0;
  private playbackRate = 1;
  private regions: number[] = [0, 1];
  private sliceDelaySec = 0;
  private anchorTime = 0;
  private anchorPosition = 0;
  private readonly edgeFadeSec = 0.004;
  private readonly minAudibleSliceSec = 0.005;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<PingPongMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "disable") {
        this.enabled = false;
        return;
      }
      if (message.type !== "config") return;
      this.enabled = Boolean(message.enabled);
      this.loopStart = Number.isFinite(message.loopStart) ? message.loopStart : 0;
      this.loopEnd = Number.isFinite(message.loopEnd) ? message.loopEnd : 0;
      this.playbackRate = clamp(
        Number.isFinite(message.playbackRate) ? message.playbackRate : 1,
        0.01,
        16
      );
      this.regions = toSafeRegions(Array.isArray(message.regions) ? message.regions : [0, 1]);
      this.sliceDelaySec = clamp(
        Number.isFinite(message.sliceDelaySec) ? message.sliceDelaySec : 0,
        0,
        5
      );
      this.anchorTime = Number.isFinite(message.anchorTime) ? message.anchorTime : currentTime;
      this.anchorPosition = Number.isFinite(message.anchorPosition) ? message.anchorPosition : this.loopStart;
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] ?? output[0];
    const inL = input?.[0];
    const inR = input?.[1] ?? inL;
    const amountParam = parameters.amount;
    const loopLength = Math.max(0, this.loopEnd - this.loopStart);
    const sliceCount = Math.max(0, this.regions.length - 1);
    const active = this.enabled && loopLength > 0.0001 && sliceCount > 1;

    for (let i = 0; i < outL.length; i += 1) {
      const leftIn = inL?.[i] ?? 0;
      const rightIn = inR?.[i] ?? 0;
      const amount = clamp(amountParam.length === 1 ? amountParam[0] ?? 0 : amountParam[i] ?? 0, 0, 1);
      const hasPingPong = amount > 0.0001;
      const hasSliceDelay = this.sliceDelaySec > 0.0001;
      if (!active || (!hasPingPong && !hasSliceDelay)) {
        outL[i] = leftIn;
        if (output.length > 1) {
          outR[i] = rightIn;
        }
        continue;
      }
      const t = currentTime + i / sampleRate;
      const elapsed = (t - this.anchorTime) * this.playbackRate;
      const raw = (this.anchorPosition - this.loopStart) + elapsed;
      const wrapped = ((raw % loopLength) + loopLength) % loopLength;
      const progress = clamp(wrapped / loopLength, 0, 1 - 1e-9);
      let sliceIndex = sliceCount - 1;
      for (let index = 0; index < sliceCount; index += 1) {
        const start = this.regions[index] ?? 0;
        const end = this.regions[index + 1] ?? 1;
        if (progress >= start && progress < end) {
          sliceIndex = index;
          break;
        }
      }
      let gateGain = 1;
      if (hasSliceDelay) {
        const sliceStart = (this.regions[sliceIndex] ?? 0) * loopLength;
        const sliceEnd = (this.regions[sliceIndex + 1] ?? 1) * loopLength;
        const sliceDuration = Math.max(0, sliceEnd - sliceStart);
        const maxDelay = Math.max(0, sliceDuration - this.minAudibleSliceSec);
        const delayWindow = Math.min(this.sliceDelaySec, maxDelay);
        const offsetInSlice = Math.max(0, wrapped - sliceStart);
        const holdStart = Math.max(0, sliceDuration - delayWindow);
        if (delayWindow > 0.000001) {
          if (offsetInSlice >= holdStart) {
            gateGain = 0;
          } else {
            const fadeSec = Math.min(this.edgeFadeSec, Math.max(0.0005, sliceDuration * 0.25));
            if (offsetInSlice < fadeSec) {
              gateGain = Math.min(gateGain, offsetInSlice / fadeSec);
            }
            if (offsetInSlice > holdStart - fadeSec) {
              gateGain = Math.min(gateGain, (holdStart - offsetInSlice) / fadeSec);
            }
          }
        }
      }
      if (gateGain <= 0.0001) {
        outL[i] = 0;
        if (output.length > 1) {
          outR[i] = 0;
        }
        continue;
      }
      const pan = (sliceIndex % 2 === 0 ? -1 : 1) * amount;
      const angle = (pan + 1) * 0.25 * Math.PI;
      const leftGain = Math.cos(angle);
      const rightGain = Math.sin(angle);
      outL[i] = leftIn * leftGain * gateGain;
      if (output.length > 1) {
        outR[i] = rightIn * rightGain * gateGain;
      }
    }

    return true;
  }
}

registerProcessor("rearranger-pingpong-processor", RearrangerPingPongProcessor);
