const dspCoreWasmUrl = `${import.meta.env.BASE_URL}wasm/dsp-core.wasm`;

const dspCoreBytesByContext = new WeakMap<BaseAudioContext, ArrayBuffer | null>();
let dspCoreLoadPromise: Promise<ArrayBuffer | null> | null = null;

const loadDspCoreWasmBytes = () => {
  if (dspCoreLoadPromise) return dspCoreLoadPromise;
  if (typeof window === "undefined") {
    dspCoreLoadPromise = Promise.resolve(null);
    return dspCoreLoadPromise;
  }
  dspCoreLoadPromise = (async () => {
    try {
      const response = await fetch(dspCoreWasmUrl);
      if (!response.ok) return null;
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  })();
  return dspCoreLoadPromise;
};

export const ensureDspCoreWasmForContext = async (context: BaseAudioContext) => {
  const bytes = await loadDspCoreWasmBytes();
  dspCoreBytesByContext.set(context, bytes);
  return bytes;
};

export const getDspCoreWasmForContext = (context: BaseAudioContext) =>
  dspCoreBytesByContext.get(context) ?? null;
