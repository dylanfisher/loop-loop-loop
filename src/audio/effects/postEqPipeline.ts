import type { EffectPipeline } from "./plugin";
import { delayPlugin, type DelayParams, normalizeDelayParams } from "./delay";

export type PostEqEffectParams = {
  delay: Partial<DelayParams>;
};

export const normalizePostEqParams = (
  params: PostEqEffectParams
): { delay: DelayParams } => ({
  delay: normalizeDelayParams(params.delay),
});

export const applyPostEqEffectsOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: PostEqEffectParams,
  pipeline: EffectPipeline
) => {
  const normalized = normalizePostEqParams(params);
  const chain = delayPlugin.applyOffline(context, input, normalized.delay, pipeline);
  return chain;
};
