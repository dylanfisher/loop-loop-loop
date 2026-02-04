import { createLimiter, createSoftClipper } from "../clipper";

export type MasterProtectParams = {
  enabled: boolean;
};

export const applyMasterProtectOffline = (
  context: OfflineAudioContext,
  input: AudioNode,
  params: MasterProtectParams
) => {
  if (!params.enabled) {
    return input;
  }
  const limiter = createLimiter(context);
  const clipper = createSoftClipper(context);
  input.connect(limiter);
  limiter.connect(clipper);
  return clipper;
};
