# Paulstretch WASM Kernel

This project supports an optional WASM backend for part of the Paulstretch worklet.

Note: shared FFT lives in `dsp-core.wasm` (see `WASM_DSP_CORE.md`). This module only contains Paulstretch-specific kernels.

## Files

- `wasm-src/paulstretch.c`: C kernel source.
- `public/wasm/paulstretch.wasm`: precompiled binary loaded at runtime.
- `src/audio/paulStretch.ts`: loader that passes wasm bytes into the worklet.
- `src/audio/worklets/paulStretchProcessor.ts`: uses wasm overlap-add kernel when available and falls back to JS when unavailable.

## Compile Command (Clang)

```bash
mkdir -p public/wasm
clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=malloc \
  -Wl,--export=free \
  -Wl,--export=paulstretch_overlap_add_f32 \
  -Wl,--export=paulstretch_analyze_bins_f32 \
  -Wl,--export=paulstretch_synthesize_bins_f32 \
  -Wl,--export=paulstretch_mirror_bins_f32 \
  -Wl,--export-memory \
  -Wl,--initial-memory=1048576 \
  -o public/wasm/paulstretch.wasm \
  wasm-src/paulstretch.c
```

If Xcode clang does not support `wasm32`, use Homebrew LLVM clang:

```bash
/opt/homebrew/opt/llvm/bin/clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=malloc \
  -Wl,--export=free \
  -Wl,--export=paulstretch_overlap_add_f32 \
  -Wl,--export=paulstretch_analyze_bins_f32 \
  -Wl,--export=paulstretch_synthesize_bins_f32 \
  -Wl,--export=paulstretch_mirror_bins_f32 \
  -Wl,--export-memory \
  -Wl,--initial-memory=1048576 \
  -o public/wasm/paulstretch.wasm \
  wasm-src/paulstretch.c
```

## Exported ABI

- `malloc(size: i32) -> i32`
- `free(ptr: i32) -> void`
- `paulstretch_overlap_add_f32(fftPtr, windowPtr, outputAccumPtr, outBlockPtr, winSize, hopOut, gain) -> i32`
- `paulstretch_analyze_bins_f32(fftPtr, magnitudesPtr, phaseRePtr, phaseImPtr, tiltCurvePtr, halfBins, smoothFactor, phaseRandomness, rngStatePtr) -> i32`
- `paulstretch_synthesize_bins_f32(fftPtr, magnitudesPtr, phaseRePtr, phaseImPtr, tiltCurvePtr, halfBins, phaseRandomness, rngStatePtr) -> i32`
- `paulstretch_mirror_bins_f32(fftPtr, winSize, halfBinsWithoutNyquist) -> i32`

All pointers are byte offsets in linear memory.
