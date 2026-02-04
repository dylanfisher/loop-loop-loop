import type { EffectPipeline } from "./plugin";
import { delayPlugin, type DelayParams, normalizeDelayParams } from "./delay";
import {
  fractalPlugin,
  type FractalParams,
  normalizeFractalParams,
} from "./fractalResonator";

export type PostEqEffectParams = {
  fractal: Partial<FractalParams>;
  delay: Partial<DelayParams>;
};

export const normalizePostEqParams = (
  params: PostEqEffectParams
): { fractal: FractalParams; delay: DelayParams } => ({
  fractal: normalizeFractalParams(params.fractal),
  delay: normalizeDelayParams(params.delay),
});

export const applyPostEqEffectsOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: PostEqEffectParams,
  pipeline: EffectPipeline
) => {
  const normalized = normalizePostEqParams(params);
  const chainWithFractal = fractalPlugin.applyOffline(
    context,
    input,
    normalized.fractal,
    pipeline
  );
  const chain = delayPlugin.applyOffline(context, chainWithFractal, normalized.delay, pipeline);
  return chain;
};
