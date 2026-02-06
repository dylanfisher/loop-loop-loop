Place the precompiled rearranger backend binary here:

- `public/wasm/rearranger.wasm`

The app will load it at runtime via `/wasm/rearranger.wasm` and automatically
fall back to the existing JavaScript implementation when the file is missing
or incompatible.

Expected wasm exports:

- `memory: WebAssembly.Memory`
- `malloc(size: i32) -> i32`
- `free(ptr: i32) -> void`
- `rearrange_segment_f32(inputPtr, outputPtr, startsPtr, mapSourcePtr, mapReversePtr, sliceCount, startSample, segmentLength, fadeSamples) -> i32`
- `detect_regions_f32(inputPtr, inputLength, sampleRate, maxSlices, minSliceDurationMs, frameDurationMs, thresholdStdDev, sensitivity, outPtr, outCapacity) -> i32`

Optional expanded detection export (recommended):

- `detect_regions_interleaved_f32(interleavedPtr, frameCount, channelCount, sampleRate, maxSlices, minSliceDurationMs, frameDurationMs, thresholdStdDev, sensitivity, outPtr, outCapacity) -> i32`
