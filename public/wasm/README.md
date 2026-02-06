Place precompiled optional wasm backends here:

- `public/wasm/rearranger.wasm`
- `public/wasm/paulstretch.wasm`

The app will load these binaries at runtime via `/wasm/*.wasm` and automatically
fall back to JavaScript implementations when a file is missing or incompatible.

`rearranger.wasm` expected exports:

- `memory: WebAssembly.Memory`
- `malloc(size: i32) -> i32`
- `free(ptr: i32) -> void`
- `rearrange_segment_f32(inputPtr, outputPtr, startsPtr, mapSourcePtr, mapReversePtr, sliceCount, startSample, segmentLength, fadeSamples) -> i32`
- `detect_regions_f32(inputPtr, inputLength, sampleRate, maxSlices, minSliceDurationMs, frameDurationMs, thresholdStdDev, sensitivity, outPtr, outCapacity) -> i32`

Optional expanded detection export (recommended):

- `detect_regions_interleaved_f32(interleavedPtr, frameCount, channelCount, sampleRate, maxSlices, minSliceDurationMs, frameDurationMs, thresholdStdDev, sensitivity, outPtr, outCapacity) -> i32`

`paulstretch.wasm` expected exports:

- `memory: WebAssembly.Memory`
- `malloc(size: i32) -> i32`
- `free(ptr: i32) -> void`
- `paulstretch_overlap_add_f32(fftPtr, windowPtr, outputAccumPtr, outBlockPtr, winSize, hopOut, gain) -> i32`
- `paulstretch_analyze_bins_f32(fftPtr, magnitudesPtr, phaseRePtr, phaseImPtr, tiltCurvePtr, halfBins, smoothFactor, phaseRandomness, rngStatePtr) -> i32`
- `paulstretch_synthesize_bins_f32(fftPtr, magnitudesPtr, phaseRePtr, phaseImPtr, tiltCurvePtr, halfBins, phaseRandomness, rngStatePtr) -> i32`
- `paulstretch_mirror_bins_f32(fftPtr, winSize, halfBinsWithoutNyquist) -> i32`
