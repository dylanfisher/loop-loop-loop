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

const postEqPlugins = [fractalPlugin, delayPlugin] as const;

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
  let chain = input;
  postEqPlugins.forEach((plugin) => {
    if (plugin.id === "fractal") {
      chain = plugin.applyOffline(context, chain, normalized.fractal, pipeline);
      return;
    }
    chain = plugin.applyOffline(context, chain, normalized.delay, pipeline);
  });
  return chain;
};
