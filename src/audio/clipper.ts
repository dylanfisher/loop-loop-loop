export const createSoftClipper = (
  context: BaseAudioContext,
  drive = 1.5,
  curveSize = 4096
) => {
  const shaper = context.createWaveShaper();
  const curve = new Float32Array(curveSize);
  const norm = Math.tanh(drive);
  for (let i = 0; i < curveSize; i++) {
    const x = (i * 2) / (curveSize - 1) - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  shaper.curve = curve;
  shaper.oversample = "4x";
  return shaper;
};

export const createLimiter = (context: BaseAudioContext) => {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  return limiter;
};
