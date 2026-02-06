# DSP Core WASM Kernel

Shared utility WASM module for reusable DSP primitives used across effects.

## Files

- `wasm-src/dsp_core.c`: shared kernel source.
- `public/wasm/dsp-core.wasm`: precompiled shared binary.
- `src/audio/wasm/dspCore.ts`: shared loader/cache used by worklet setup modules.

## Compile Command (Clang)

```bash
mkdir -p public/wasm
clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=malloc \
  -Wl,--export=free \
  -Wl,--export=dsp_fft_f32 \
  -Wl,--export=dsp_window_to_complex_f32 \
  -Wl,--export=dsp_overlap_add_real_f32 \
  -Wl,--export-memory \
  -Wl,--initial-memory=1048576 \
  -o public/wasm/dsp-core.wasm \
  wasm-src/dsp_core.c
```

If Xcode clang does not support `wasm32`, use Homebrew LLVM clang:

```bash
/opt/homebrew/opt/llvm/bin/clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=malloc \
  -Wl,--export=free \
  -Wl,--export=dsp_fft_f32 \
  -Wl,--export=dsp_window_to_complex_f32 \
  -Wl,--export=dsp_overlap_add_real_f32 \
  -Wl,--export-memory \
  -Wl,--initial-memory=1048576 \
  -o public/wasm/dsp-core.wasm \
  wasm-src/dsp_core.c
```

## Exported ABI

- `malloc(size: i32) -> i32`
- `free(ptr: i32) -> void`
- `dsp_fft_f32(fftPtr, fftFrameSize, sign, normalizeInverse, bitrevPairsPtr, bitrevPairCount, twiddleRePtr, twiddleImPtr, twiddleCount) -> i32`
- `dsp_window_to_complex_f32(inputPtr, windowPtr, fftPtr, winSize) -> i32`
- `dsp_overlap_add_real_f32(fftPtr, windowPtr, outputAccumPtr, outBlockPtr, winSize, hopOut, windowScale, outGain) -> i32`
