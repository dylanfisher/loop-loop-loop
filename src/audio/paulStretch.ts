const workletPromises = new WeakMap<BaseAudioContext, Promise<void>>();
const workletReady = new WeakMap<BaseAudioContext, boolean>();

export const ensurePaulStretchWorklet = async (context: BaseAudioContext) => {
  if (!context.audioWorklet) return false;
  const ready = workletReady.get(context);
  if (ready) return true;

  let promise = workletPromises.get(context);
  if (!promise) {
    promise = context.audioWorklet
      .addModule(new URL("./worklets/paulStretchProcessor.ts", import.meta.url))
      .then(() => {
        workletReady.set(context, true);
      })
      .catch((error) => {
        workletPromises.delete(context);
        throw error;
      });
    workletPromises.set(context, promise);
  }

  await promise;
  return true;
};

export const createPaulStretchNode = (
  context: BaseAudioContext,
  ratio = 1,
  winSize = 4096,
  inputSamples?: number,
  outputSamples?: number
) => {
  const node = new AudioWorkletNode(context, "paul-stretch-processor", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    processorOptions: {
      ratio,
      winSize,
      inputSamples,
      outputSamples,
    },
    parameterData: {
      ratio,
    },
  });
  const param = node.parameters.get("ratio");
  if (param) {
    param.value = ratio;
  }
  return node;
};
