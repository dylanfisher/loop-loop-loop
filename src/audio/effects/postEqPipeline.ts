import type { EffectPipeline } from "./plugin";
import { delayPlugin, type DelayParams, normalizeDelayParams } from "./delay";
import {
  normalizeSpectralSpaceParams,
  spectralSpacePlugin,
  type SpectralSpaceParams,
} from "./spectralSpace";

export type PostEqEffectParams = {
  delay: Partial<DelayParams>;
  spectralSpace: Partial<SpectralSpaceParams>;
};

export const normalizePostEqParams = (
  params: PostEqEffectParams
): { delay: DelayParams; spectralSpace: SpectralSpaceParams } => ({
  delay: normalizeDelayParams(params.delay),
  spectralSpace: normalizeSpectralSpaceParams(params.spectralSpace),
});

export const applyPostEqEffectsOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: PostEqEffectParams,
  pipeline: EffectPipeline
) => {
  const normalized = normalizePostEqParams(params);
  const delayed = delayPlugin.applyOffline(context, input, normalized.delay, pipeline);
  const chain = spectralSpacePlugin.applyOffline(
    context,
    delayed,
    normalized.spectralSpace,
    pipeline
  );
  return chain;
};
