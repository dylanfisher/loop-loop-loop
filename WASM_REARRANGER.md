# Rearranger WASM Kernel

This project can use a precompiled WASM binary for rearranger kernels while keeping the current JS path as fallback.

## Files

- `wasm-src/rearranger.c`: C kernel source with exported C ABI functions.
- `src/utils/rearrangerWasm.ts`: Runtime loader/wrapper used by the rearranger JS path.
- `public/wasm/rearranger.wasm`: Compiled binary (not generated automatically by Vite/npm scripts).

## Compile Command (Clang)

Build the binary manually and place it at `public/wasm/rearranger.wasm`:

```bash
mkdir -p public/wasm
clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=malloc \
  -Wl,--export=free \
  -Wl,--export=rearrange_segment_f32 \
  -Wl,--export=detect_regions_f32 \
  -Wl,--export=detect_regions_interleaved_f32 \
  -Wl,--export-memory \
  -o public/wasm/rearranger.wasm \
  wasm-src/rearranger.c
```

If Xcode clang does not support `wasm32`, use Homebrew LLVM clang:

```bash
/opt/homebrew/opt/llvm/bin/clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=malloc \
  -Wl,--export=free \
  -Wl,--export=rearrange_segment_f32 \
  -Wl,--export=detect_regions_f32 \
  -Wl,--export=detect_regions_interleaved_f32 \
  -Wl,--export-memory \
  -o public/wasm/rearranger.wasm \
  wasm-src/rearranger.c
```

## Exported ABI

- `malloc(size: i32) -> i32`
- `free(ptr: i32) -> void` (no-op in this simple bump allocator implementation)
- `rearrange_segment_f32(inputPtr, outputPtr, startsPtr, mapSourcePtr, mapReversePtr, sliceCount, startSample, segmentLength, fadeSamples) -> i32`
- `detect_regions_f32(inputPtr, inputLength, sampleRate, maxSlices, minSliceDurationMs, frameDurationMs, thresholdStdDev, sensitivity, outPtr, outCapacity) -> i32`
- `detect_regions_interleaved_f32(interleavedPtr, frameCount, channelCount, sampleRate, maxSlices, minSliceDurationMs, frameDurationMs, thresholdStdDev, sensitivity, outPtr, outCapacity) -> i32` (optional high-performance multi-channel path)

All pointers are byte offsets in linear memory.

## Usage

The app loads this binary from `${import.meta.env.BASE_URL}wasm/rearranger.wasm` via `src/utils/rearrangerWasm.ts`.

```ts
import { warmupRearrangerWasm } from "./src/utils/rearrangerWasm";
warmupRearrangerWasm();
```

Use this as an optional fast path and keep the JS rearranger as fallback on load/runtime failures.
