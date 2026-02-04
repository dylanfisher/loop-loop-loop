export type EffectPipeline = "live" | "saveLoop" | "exportMix";

export type OfflineEffectPlugin<Params> = {
  id: string;
  applyOffline: (
    context: OfflineAudioContext,
    input: AudioNode,
    params: Params,
    pipeline: EffectPipeline
  ) => AudioNode;
};
