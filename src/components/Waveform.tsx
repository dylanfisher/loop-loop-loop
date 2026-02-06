import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { setPerfCounter, setPerfTiming } from "../utils/perf";
import {
  buildRearrangerMap,
  MAX_REARRANGER_SLICES,
  normalizeRearrangerRegionIds,
  normalizeRearrangerRegions,
} from "../utils/rearranger";

type WaveformProps = {
  buffer?: AudioBuffer;
  isPlaying?: boolean;
  startedAtMs?: number;
  duration?: number;
  offsetSeconds?: number;
  zoom?: number;
  gain?: number;
  balance?: number;
  eqLowGain?: number;
  eqMidGain?: number;
  eqHighGain?: number;
  loopEnabled?: boolean;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  onSeek?: (progress: number) => void;
  onLoopBoundsChange?: (
    startSeconds: number,
    endSeconds: number,
  ) => void;
  onLoopBoundsChangeComplete?: () => void;
  onLoopEnabledChange?: (enabled: boolean) => void;
  getCurrentSeconds?: () => number | null;
  onEmptyClick?: () => void;
  getPlaybackSnapshot?: () => {
    position: number;
    duration: number;
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
    playing: boolean;
    playbackRate: number;
  } | null;
  showRearrangerSlices?: boolean;
  rearrangerSlices?: number;
  rearrangerSwapCount?: number;
  rearrangerChaos?: number;
  rearrangerReverse?: number;
  rearrangerRegions?: number[];
  rearrangerRegionIds?: number[];
  rearrangerDeletePreviewRanges?: Array<{ start: number; end: number }>;
  onRearrangerRegionsChange?: (regions: number[]) => void;
  onRearrangerSliceDelete?: (sliceIndex: number) => void;
  onRearrangerSlicesChange?: (value: number) => void;
};

const buildPeaks = (
  buffer: AudioBuffer,
  width: number,
  zoom: number,
  startSeconds: number,
  balance: number,
  eqLowGain: number,
  eqMidGain: number,
  eqHighGain: number
) => {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const effectiveZoom = Math.max(1, zoom);
  const visibleSamples = Math.max(1, Math.floor(left.length / effectiveZoom));
  const startSample = Math.min(
    Math.max(0, Math.floor(startSeconds * buffer.sampleRate)),
    Math.max(0, left.length - visibleSamples)
  );
  const clampedBalance = Math.max(-1, Math.min(1, balance));
  const panAngle = (clampedBalance + 1) * 0.25 * Math.PI;
  const leftGain = Math.cos(panAngle);
  const rightGain = Math.sin(panAngle);
  const step = Math.max(1 / width, visibleSamples / width);
  const peaks: Array<{ min: number; max: number }> = [];
  const sampleRate = buffer.sampleRate;
  const lowCut = 120;
  const highCut = 8000;
  const lowAlpha = Math.exp((-2 * Math.PI * lowCut) / sampleRate);
  const highAlpha = Math.exp((-2 * Math.PI * highCut) / sampleRate);
  const dbToLinear = (db: number) => Math.pow(10, db / 20);
  const lowGain = dbToLinear(eqLowGain);
  const midGain = dbToLinear(eqMidGain);
  const highGain = dbToLinear(eqHighGain);
  let lowState = 0;
  let highLowState = 0;

  for (let i = 0; i < width; i += 1) {
    let min = 0;
    let max = 0;
    let hasSample = false;
    const start = startSample + Math.floor(i * step);
    const rawEnd = startSample + Math.floor((i + 1) * step);
    const end = Math.min(
      Math.max(rawEnd, start + 1),
      startSample + visibleSamples
    );
    for (let j = start; j < end; j += 1) {
      const sample = right ? left[j] * leftGain + right[j] * rightGain : left[j];
      lowState = (1 - lowAlpha) * sample + lowAlpha * lowState;
      highLowState = (1 - highAlpha) * sample + highAlpha * highLowState;
      const low = lowState;
      const high = sample - highLowState;
      const mid = highLowState - low;
      const shaped = low * lowGain + mid * midGain + high * highGain;
      if (!hasSample) {
        min = shaped;
        max = shaped;
        hasSample = true;
      } else {
        if (shaped < min) min = shaped;
        if (shaped > max) max = shaped;
      }
    }
    peaks.push({ min, max });
  }

  return peaks;
};

type BandPeaks = {
  peaksPerSecond: number;
  length: number;
  lowMin: Float32Array;
  lowMax: Float32Array;
  midMin: Float32Array;
  midMax: Float32Array;
  highMin: Float32Array;
  highMax: Float32Array;
};

const buildBandPeaks = (
  buffer: AudioBuffer,
  peaksPerSecond: number,
  balance: number
): BandPeaks => {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const sampleRate = buffer.sampleRate;
  const clampedBalance = Math.max(-1, Math.min(1, balance));
  const panAngle = (clampedBalance + 1) * 0.25 * Math.PI;
  const leftGain = Math.cos(panAngle);
  const rightGain = Math.sin(panAngle);
  const samplesPerPeak = Math.max(1, Math.floor(sampleRate / peaksPerSecond));
  const totalPeaks = Math.max(1, Math.ceil(left.length / samplesPerPeak));
  const lowMin = new Float32Array(totalPeaks);
  const lowMax = new Float32Array(totalPeaks);
  const midMin = new Float32Array(totalPeaks);
  const midMax = new Float32Array(totalPeaks);
  const highMin = new Float32Array(totalPeaks);
  const highMax = new Float32Array(totalPeaks);
  const lowCut = 120;
  const highCut = 8000;
  const lowAlpha = Math.exp((-2 * Math.PI * lowCut) / sampleRate);
  const highAlpha = Math.exp((-2 * Math.PI * highCut) / sampleRate);
  let lowState = 0;
  let highLowState = 0;

  let index = 0;
  for (let peakIndex = 0; peakIndex < totalPeaks; peakIndex += 1) {
    let lowMinValue = 1;
    let lowMaxValue = -1;
    let midMinValue = 1;
    let midMaxValue = -1;
    let highMinValue = 1;
    let highMaxValue = -1;
    const end = Math.min(index + samplesPerPeak, left.length);
    for (; index < end; index += 1) {
      const sample = right
        ? left[index] * leftGain + right[index] * rightGain
        : left[index];
      lowState = (1 - lowAlpha) * sample + lowAlpha * lowState;
      highLowState = (1 - highAlpha) * sample + highAlpha * highLowState;
      const low = lowState;
      const high = sample - highLowState;
      const mid = highLowState - low;
      if (low < lowMinValue) lowMinValue = low;
      if (low > lowMaxValue) lowMaxValue = low;
      if (mid < midMinValue) midMinValue = mid;
      if (mid > midMaxValue) midMaxValue = mid;
      if (high < highMinValue) highMinValue = high;
      if (high > highMaxValue) highMaxValue = high;
    }
    lowMin[peakIndex] = lowMinValue;
    lowMax[peakIndex] = lowMaxValue;
    midMin[peakIndex] = midMinValue;
    midMax[peakIndex] = midMaxValue;
    highMin[peakIndex] = highMinValue;
    highMax[peakIndex] = highMaxValue;
  }

  return {
    peaksPerSecond,
    length: totalPeaks,
    lowMin,
    lowMax,
    midMin,
    midMax,
    highMin,
    highMax,
  };
};

const buildPeaksFromBands = (
  bands: BandPeaks,
  duration: number,
  width: number,
  zoom: number,
  startSeconds: number,
  eqLowGain: number,
  eqMidGain: number,
  eqHighGain: number
) => {
  const visualDuration = duration / Math.max(1, zoom);
  const windowStart = Math.min(Math.max(0, startSeconds), Math.max(0, duration - visualDuration));
  const windowEnd = Math.min(duration, windowStart + visualDuration);
  const startIndex = Math.min(
    bands.length,
    Math.max(0, Math.floor(windowStart * bands.peaksPerSecond))
  );
  const endIndex = Math.min(
    bands.length,
    Math.max(startIndex + 1, Math.ceil(windowEnd * bands.peaksPerSecond))
  );
  const range = Math.max(1, endIndex - startIndex);

  const peaks: Array<{ min: number; max: number }> = new Array(Math.max(1, width));
  const lowGain = Math.pow(10, eqLowGain / 20);
  const midGain = Math.pow(10, eqMidGain / 20);
  const highGain = Math.pow(10, eqHighGain / 20);

  const scaleBand = (min: number, max: number, gain: number) => {
    const scaledMin = min * gain;
    const scaledMax = max * gain;
    return scaledMin < scaledMax
      ? [scaledMin, scaledMax]
      : [scaledMax, scaledMin];
  };

  for (let i = 0; i < peaks.length; i += 1) {
    const segStart = startIndex + Math.floor((i * range) / peaks.length);
    const segEnd = Math.min(
      endIndex,
      startIndex + Math.max(1, Math.floor(((i + 1) * range) / peaks.length))
    );
    let lowMinValue = 1;
    let lowMaxValue = -1;
    let midMinValue = 1;
    let midMaxValue = -1;
    let highMinValue = 1;
    let highMaxValue = -1;
    for (let j = segStart; j < segEnd; j += 1) {
      lowMinValue = Math.min(lowMinValue, bands.lowMin[j]);
      lowMaxValue = Math.max(lowMaxValue, bands.lowMax[j]);
      midMinValue = Math.min(midMinValue, bands.midMin[j]);
      midMaxValue = Math.max(midMaxValue, bands.midMax[j]);
      highMinValue = Math.min(highMinValue, bands.highMin[j]);
      highMaxValue = Math.max(highMaxValue, bands.highMax[j]);
    }

    const [lowMinScaled, lowMaxScaled] = scaleBand(lowMinValue, lowMaxValue, lowGain);
    const [midMinScaled, midMaxScaled] = scaleBand(midMinValue, midMaxValue, midGain);
    const [highMinScaled, highMaxScaled] = scaleBand(highMinValue, highMaxValue, highGain);

    peaks[i] = {
      min: lowMinScaled + midMinScaled + highMinScaled,
      max: lowMaxScaled + midMaxScaled + highMaxScaled,
    };
  }

  return peaks;
};

const drawWaveform = (
  canvas: HTMLCanvasElement,
  peaks: Array<{ min: number; max: number }>,
  color: string,
  scale: number
) => {
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width));
  const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height));
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.body);
  const canvasBg = styles.getPropertyValue("--canvas-bg").trim() || "#f6f9ff";
  context.fillStyle = canvasBg;
  context.fillRect(0, 0, width, height);

  const amp = height / 2;

  context.fillStyle = color;

  const count = Math.max(1, peaks.length);
  let maxAbs = 0;
  for (let i = 0; i < count; i += 1) {
    const peak = peaks[i];
    maxAbs = Math.max(maxAbs, Math.abs(peak.min), Math.abs(peak.max));
  }
  const normalize = maxAbs > 1 ? 1 / maxAbs : 1;
  const finalScale = scale * normalize;
  const step = width / count;
  const barWidth = Math.max(1, Math.ceil(step));
  for (let i = 0; i < count; i += 1) {
    const peak = peaks[i];
    const scaledMin = Math.max(-1, Math.min(1, peak.min * finalScale));
    const scaledMax = Math.max(-1, Math.min(1, peak.max * finalScale));
    const yMin = amp + scaledMin * amp;
    const yMax = amp + scaledMax * amp;
    const top = Math.min(yMin, yMax);
    const height = Math.max(1, Math.abs(yMax - yMin));
    const x = Math.floor(i * step);
    context.fillRect(x, top, barWidth, height);
  }
};

const formatTimeLabel = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
};

const Waveform = ({
  buffer,
  isPlaying,
  startedAtMs,
  duration,
  offsetSeconds,
  zoom = 1,
  gain = 1,
  balance = 0,
  eqLowGain = 0,
  eqMidGain = 0,
  eqHighGain = 0,
  loopEnabled = false,
  loopStartSeconds = 0,
  loopEndSeconds = 0,
  onSeek,
  onLoopBoundsChange,
  onLoopBoundsChangeComplete,
  onLoopEnabledChange,
  getCurrentSeconds,
  onEmptyClick,
  getPlaybackSnapshot,
  showRearrangerSlices = false,
  rearrangerSlices = 8,
  rearrangerSwapCount = 0,
  rearrangerChaos = 0,
  rearrangerReverse = 0,
  rearrangerRegions,
  rearrangerRegionIds,
  rearrangerDeletePreviewRanges,
  onRearrangerRegionsChange,
  onRearrangerSliceDelete,
  onRearrangerSlicesChange: _onRearrangerSlicesChange,
}: WaveformProps) => {
  const MAX_BAND_PEAKS_PER_SECOND = 4000;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const peaksRef = useRef<Array<{ min: number; max: number }>>([]);
  const windowStartRef = useRef(0);
  const visualDurationRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const dragMovedRef = useRef(false);
  const velocityRef = useRef(0);
  const inertiaRef = useRef<number | null>(null);
  const activeLoopDragRef = useRef<"start" | "end" | "region" | null>(null);
  const loopStartHandleRef = useRef<HTMLDivElement | null>(null);
  const loopEndHandleRef = useRef<HTMLDivElement | null>(null);
  const loopRegionRef = useRef<HTMLDivElement | null>(null);
  const loopConnectorRef = useRef<HTMLDivElement | null>(null);
  const sliceHandlesRef = useRef<HTMLDivElement | null>(null);
  const loopStartRef = useRef(loopStartSeconds);
  const loopEndRef = useRef(loopEndSeconds);
  const loopDragOffsetRef = useRef(0);
  const loopDragActiveRef = useRef(false);
  const loopDragWindowStartRef = useRef(0);
  const rearrangerHandleDragRef = useRef<{ pointerId: number; boundaryIndex: number } | null>(null);
  const rearrangerHandleMovedRef = useRef(false);
  const rearrangerHandleStartXRef = useRef(0);
  const rearrangerInsertPreviewRef = useRef<number | null>(null);
  const [rearrangerInsertPreview, setRearrangerInsertPreview] = useState<number | null>(null);
  const [optimisticRearrangerRegions, setOptimisticRearrangerRegions] = useState<number[] | null>(null);
  const [optimisticSourceKey, setOptimisticSourceKey] = useState<string | null>(null);
  const hasInitializedWindowRef = useRef(false);
  const prevZoomRef = useRef(zoom);
  const panPointerIdRef = useRef<number | null>(null);
  const loopChangeRafRef = useRef<number | null>(null);
  const pendingLoopChangeRef = useRef<{ start: number; end: number } | null>(null);
  const bandPeaksRef = useRef<BandPeaks | null>(null);
  const pointerDownRef = useRef(false);
  const lastDisplaySecondsRef = useRef(0);
  const localStartMsRef = useRef<number | null>(null);
  const shiftDragRef = useRef(false);
  const shiftDragPendingRef = useRef(false);
  const shiftPointerStartXRef = useRef(0);
  const shiftPointerStartSecondsRef = useRef(0);
  const shiftStartRef = useRef(0);
  const [themeToken, setThemeToken] = useState(0);
  const renderCountRef = useRef(0);
  const peaksPerSecondRef = useRef(200);
  const balanceRef = useRef(0);
  const lastBufferRef = useRef<AudioBuffer | null>(null);
  const totalTimeLabelRef = useRef<HTMLSpanElement | null>(null);
  const getResolvedDurationRef = useRef<() => number>(() => 0);
  const getDisplaySecondsRef = useRef<() => number>(() => 0);
  const renderOverlayRef = useRef<() => void>(() => {});
  const [rearrangerDeleteSliceIndex, setRearrangerDeleteSliceIndex] = useState<number | null>(null);
  const [isSliceZoneHovered, setIsSliceZoneHovered] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const rearrangerDeleteMode = isSliceZoneHovered && isShiftPressed && rearrangerSlices > 1;
  const effectiveDeleteSliceIndex = rearrangerDeleteMode ? rearrangerDeleteSliceIndex : null;

  useEffect(() => {
    renderCountRef.current += 1;
    setPerfCounter("waveformRenders", renderCountRef.current);
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setIsShiftPressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setIsShiftPressed(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const waveformGainScale = useMemo(() => {
    const safeGain = Number.isFinite(gain) ? gain : 1;
    return Math.min(Math.max(safeGain, 0), 3);
  }, [gain]);

  const getPlayback = useCallback(() => getPlaybackSnapshot?.() ?? null, [getPlaybackSnapshot]);
  const rearrangerRegionsKey =
    rearrangerRegions?.map((value) => value.toFixed(6)).join("|") ?? "";
  const rearrangerSourceKey = [
    buffer?.length ?? 0,
    rearrangerSlices,
    loopStartSeconds.toFixed(4),
    loopEndSeconds.toFixed(4),
    rearrangerRegionsKey,
  ].join(":");
  const applyOptimisticRearrangerRegions = useCallback((regions: number[] | null) => {
    setOptimisticSourceKey(regions ? rearrangerSourceKey : null);
    setOptimisticRearrangerRegions(regions);
  }, [rearrangerSourceKey]);
  const optimisticRegionsPending = optimisticSourceKey === rearrangerSourceKey;
  const getResolvedDuration = useCallback(() => {
    const snapshot = getPlayback();
    const fallbackDuration = duration ?? buffer?.duration ?? 0;
    const nextDuration =
      snapshot && Number.isFinite(snapshot.duration) && snapshot.duration > 0
        ? snapshot.duration
        : fallbackDuration;
    return Number.isFinite(nextDuration) ? nextDuration : 0;
  }, [buffer?.duration, duration, getPlayback]);

  const fillWaveformBackground = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const styles = getComputedStyle(document.body);
    const bg = styles.getPropertyValue("--canvas-bg").trim() || "#f8fafc";
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = bg;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }, []);

  const buildPeaksWithPerf = useCallback(
    (
      bufferValue: AudioBuffer,
      width: number,
      zoomValue: number,
      startSeconds: number,
      balanceValue: number,
      lowGain: number,
      midGain: number,
      highGain: number
    ) => {
      const start = performance.now();
      const bands = bandPeaksRef.current;
      const peaks = bands
        ? buildPeaksFromBands(
            bands,
            bufferValue.duration,
            width,
            zoomValue,
            startSeconds,
            lowGain,
            midGain,
            highGain
          )
        : buildPeaks(
            bufferValue,
            width,
            zoomValue,
            startSeconds,
            balanceValue,
            lowGain,
            midGain,
            highGain
          );
      setPerfTiming("buildPeaksMs", performance.now() - start);
      return peaks;
    },
    []
  );

  const computePeaksPerSecond = useCallback(
    (width: number, durationSeconds: number, zoomValue: number) => {
      if (!durationSeconds || !Number.isFinite(durationSeconds)) return 200;
      const visualDuration = durationSeconds / Math.max(1, zoomValue);
      if (!visualDuration || !Number.isFinite(visualDuration)) return 200;
      const target = (Math.max(1, width) / visualDuration) * 2;
      return Math.max(200, Math.round(target));
    },
    []
  );

  const rebuildBandPeaks = useCallback(
    (nextPeaksPerSecond: number) => {
      if (!buffer) return;
      const start = performance.now();
      bandPeaksRef.current = buildBandPeaks(
        buffer,
        nextPeaksPerSecond,
        balanceRef.current
      );
      peaksPerSecondRef.current = nextPeaksPerSecond;
      setPerfTiming("buildBandPeaksMs", performance.now() - start);
    },
    [buffer]
  );

  const resolveBandPeaks = useCallback(
    (nextPeaksPerSecond: number, balanceValue: number) => {
      if (!buffer) return;
      if (balanceRef.current !== balanceValue) {
        balanceRef.current = balanceValue;
        if (nextPeaksPerSecond <= MAX_BAND_PEAKS_PER_SECOND) {
          rebuildBandPeaks(nextPeaksPerSecond);
          return;
        }
      }
      if (nextPeaksPerSecond > MAX_BAND_PEAKS_PER_SECOND) {
        bandPeaksRef.current = null;
        peaksPerSecondRef.current = 0;
        return;
      }
      if (nextPeaksPerSecond !== peaksPerSecondRef.current) {
        rebuildBandPeaks(nextPeaksPerSecond);
      }
    },
    [buffer, rebuildBandPeaks]
  );

  useEffect(() => {
    const handleThemeChange = () => setThemeToken((prev) => prev + 1);
    window.addEventListener("themechange", handleThemeChange);
    return () => window.removeEventListener("themechange", handleThemeChange);
  }, []);

  const getDisplaySeconds = useCallback(() => {
    const snapshot = getPlayback();
    const resolvedDuration = getResolvedDuration();
    const resolvedLoopEnabled = loopEnabled;
    const resolvedLoopStart = loopStartSeconds;
    const resolvedLoopEnd =
      loopEndSeconds > resolvedLoopStart ? loopEndSeconds : resolvedDuration;
    const playbackRate = snapshot?.playbackRate ?? 1;

    if (snapshot) {
      const snapshotPosition = resolvedDuration
        ? Math.min(snapshot.position, resolvedDuration)
        : snapshot.position;
      if (Number.isFinite(snapshotPosition)) {
        return snapshotPosition;
      }
      return lastDisplaySecondsRef.current;
    }

    if (isPlaying) {
      const startMs = localStartMsRef.current ?? startedAtMs ?? null;
      if (startMs !== null) {
        const elapsedSec = (performance.now() - startMs) / 1000;
        let position =
          (offsetSeconds ?? 0) + elapsedSec * (Number.isFinite(playbackRate) ? playbackRate : 1);
        if (resolvedLoopEnabled && resolvedDuration && resolvedLoopEnd > resolvedLoopStart + 0.01) {
          const loopDuration = resolvedLoopEnd - resolvedLoopStart;
          const loopOffset = position - resolvedLoopStart;
          const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
          position = resolvedLoopStart + wrapped;
        } else if (resolvedDuration) {
          position = Math.min(position, resolvedDuration);
        }
        const resolvedPosition = resolvedDuration ? Math.min(position, resolvedDuration) : position;
        if (Number.isFinite(resolvedPosition)) {
          return resolvedPosition;
        }
        return lastDisplaySecondsRef.current;
      }
    }
    if (!resolvedDuration) return 0;
    const engineSeconds = getCurrentSeconds?.();
    if (engineSeconds !== null && engineSeconds !== undefined) {
      return Math.min(engineSeconds, resolvedDuration);
    }
    const fallback = Math.min(offsetSeconds ?? 0, resolvedDuration);
    return Number.isFinite(fallback) ? fallback : lastDisplaySecondsRef.current;
  }, [
    getCurrentSeconds,
    getPlayback,
    getResolvedDuration,
    isPlaying,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    offsetSeconds,
    startedAtMs,
  ]);

  useEffect(() => {
    getResolvedDurationRef.current = getResolvedDuration;
  }, [getResolvedDuration]);

  useEffect(() => {
    getDisplaySecondsRef.current = getDisplaySeconds;
  }, [getDisplaySeconds]);

  const normalizedRearrangerRegions = normalizeRearrangerRegions(
    rearrangerRegions,
    rearrangerSlices
  );
  const rearrangerHandleRegions = (() => {
    if (!optimisticRearrangerRegions) return normalizedRearrangerRegions;
    if (optimisticRearrangerRegions.length !== normalizedRearrangerRegions.length) {
      return optimisticRegionsPending
        ? optimisticRearrangerRegions
        : normalizedRearrangerRegions;
    }
    for (let i = 0; i < optimisticRearrangerRegions.length; i += 1) {
      if (Math.abs(optimisticRearrangerRegions[i] - normalizedRearrangerRegions[i]) > 1e-4) {
        return optimisticRegionsPending
          ? optimisticRearrangerRegions
          : normalizedRearrangerRegions;
      }
    }
    return normalizedRearrangerRegions;
  })();
  const rearrangerIds = normalizeRearrangerRegionIds(
    rearrangerRegionIds,
    rearrangerSlices
  );
  const rearrangerHandleMap = buildRearrangerMap({
    slices: rearrangerSlices,
    swapCount: rearrangerSwapCount,
    chaos: rearrangerChaos,
    reverse: rearrangerReverse,
    regions: rearrangerHandleRegions,
  });

  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay || !buffer) return;
    const resolvedDuration = getResolvedDuration();
    if (!resolvedDuration) return;

    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;

    const renderStart = performance.now();
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);

    const visualDuration = resolvedDuration / Math.max(1, zoom);
    let currentSeconds = getDisplaySeconds();
    const resolvedLoopEnabled = loopEnabled;
    const resolvedLoopStart = loopStartSeconds;
    const resolvedLoopEnd =
      loopEndSeconds > resolvedLoopStart ? loopEndSeconds : resolvedDuration;
    if (
      activeLoopDragRef.current &&
      resolvedLoopEnabled &&
      resolvedLoopEnd > resolvedLoopStart
    ) {
      currentSeconds = Math.min(
        Math.max(currentSeconds, resolvedLoopStart),
        Math.max(resolvedLoopStart, resolvedLoopEnd - 0.01)
      );
    }
    lastDisplaySecondsRef.current = currentSeconds;
    if (totalTimeLabelRef.current) {
      totalTimeLabelRef.current.textContent = formatTimeLabel(resolvedDuration);
    }
    const rawProgress = visualDuration
      ? (currentSeconds - windowStartRef.current) / visualDuration
      : 0;
    const progress = Math.min(Math.max(rawProgress, 0), 1);
    const peaks = peaksRef.current;

    if (peaks.length) {
      const clipWidth = progress * overlay.clientWidth;
      overlayContext.save();
      overlayContext.beginPath();
      overlayContext.rect(0, 0, clipWidth, overlay.clientHeight);
      overlayContext.clip();
      const styles = getComputedStyle(document.body);
      const accent = styles.getPropertyValue("--canvas-accent").trim() || "#0074FF";
      drawWaveform(overlay, peaks, accent, waveformGainScale);
      overlayContext.restore();
    }

    if (
      resolvedLoopEnabled &&
      resolvedLoopEnd > resolvedLoopStart + 0.01
    ) {
      const overlayAlpha = showRearrangerSlices ? 1 : 0.45;
      const loopDuration = resolvedLoopEnd - resolvedLoopStart;
      const visibleStart = windowStartRef.current;
      const visibleEnd = visibleStart + visualDuration;
      const regionStart = Math.max(visibleStart, resolvedLoopStart);
      const regionEnd = Math.min(visibleEnd, resolvedLoopEnd);
      if (regionEnd > regionStart) {
        const regions = normalizeRearrangerRegions(rearrangerRegions, rearrangerSlices);
        if (rearrangerSlices > 1) {
          const map = buildRearrangerMap({
            slices: rearrangerSlices,
            swapCount: rearrangerSwapCount,
            chaos: rearrangerChaos,
            reverse: rearrangerReverse,
            regions: rearrangerRegions,
          });
          for (let i = 0; i < map.length; i += 1) {
            const sliceStart = resolvedLoopStart + loopDuration * regions[i];
            const sliceEnd = resolvedLoopStart + loopDuration * regions[i + 1];
            const drawStart = Math.max(sliceStart, regionStart);
            const drawEnd = Math.min(sliceEnd, regionEnd);
            if (drawEnd <= drawStart) continue;
            const x0 = ((drawStart - visibleStart) / visualDuration) * overlay.clientWidth;
            const x1 = ((drawEnd - visibleStart) / visualDuration) * overlay.clientWidth;
            const width = Math.max(1, x1 - x0);
            const id = rearrangerIds[i] ?? i;
            const hue = ((id % Math.max(1, map.length)) / Math.max(1, map.length)) * 360;
            overlayContext.fillStyle = `hsla(${hue.toFixed(1)} 82% 58% / ${(0.14 * overlayAlpha).toFixed(3)})`;
            overlayContext.fillRect(x0, 0, width, overlay.clientHeight);
            overlayContext.strokeStyle = `hsla(${hue.toFixed(1)} 86% 44% / ${(0.28 * overlayAlpha).toFixed(3)})`;
            overlayContext.lineWidth = 1;
            overlayContext.beginPath();
            overlayContext.moveTo(x0, 0);
            overlayContext.lineTo(x0, overlay.clientHeight);
            overlayContext.stroke();
            if (map[i].reversed) {
              overlayContext.strokeStyle = `hsla(${hue.toFixed(1)} 92% 36% / ${(0.5 * overlayAlpha).toFixed(3)})`;
              overlayContext.beginPath();
              overlayContext.moveTo(x0 + 1, 2);
              overlayContext.lineTo(Math.max(x0 + 1, x1 - 1), 2);
              overlayContext.stroke();
            }
          }
          if (
            effectiveDeleteSliceIndex !== null &&
            rearrangerDeleteMode &&
            effectiveDeleteSliceIndex >= 0 &&
            effectiveDeleteSliceIndex < regions.length - 1
          ) {
            const sliceStart = resolvedLoopStart + loopDuration * regions[effectiveDeleteSliceIndex];
            const sliceEnd = resolvedLoopStart + loopDuration * regions[effectiveDeleteSliceIndex + 1];
            const drawStart = Math.max(sliceStart, regionStart);
            const drawEnd = Math.min(sliceEnd, regionEnd);
            if (drawEnd > drawStart) {
              const x0 = ((drawStart - visibleStart) / visualDuration) * overlay.clientWidth;
              const x1 = ((drawEnd - visibleStart) / visualDuration) * overlay.clientWidth;
              const width = Math.max(2, x1 - x0);
              overlayContext.save();
              overlayContext.fillStyle = "rgba(0, 0, 0, 0.22)";
              overlayContext.fillRect(x0, 0, width, overlay.clientHeight);
              overlayContext.strokeStyle = "rgba(0, 0, 0, 0.58)";
              overlayContext.lineWidth = 2;
              overlayContext.beginPath();
              overlayContext.moveTo(x0, 0);
              overlayContext.lineTo(x0, overlay.clientHeight);
              overlayContext.moveTo(x1, 0);
              overlayContext.lineTo(x1, overlay.clientHeight);
              overlayContext.stroke();
              overlayContext.restore();
            }
          }
        }
        if (rearrangerDeletePreviewRanges && rearrangerDeletePreviewRanges.length > 0) {
          for (const range of rearrangerDeletePreviewRanges) {
            const startNorm = Math.max(0, Math.min(1, range.start));
            const endNorm = Math.max(startNorm, Math.min(1, range.end));
            if (endNorm <= startNorm) continue;
            const sliceStart = resolvedLoopStart + loopDuration * startNorm;
            const sliceEnd = resolvedLoopStart + loopDuration * endNorm;
            const drawStart = Math.max(sliceStart, regionStart);
            const drawEnd = Math.min(sliceEnd, regionEnd);
            if (drawEnd <= drawStart) continue;
            const x0 = ((drawStart - visibleStart) / visualDuration) * overlay.clientWidth;
            const x1 = ((drawEnd - visibleStart) / visualDuration) * overlay.clientWidth;
            const width = Math.max(2, x1 - x0);
            overlayContext.save();
            overlayContext.fillStyle = "rgba(0, 0, 0, 0.22)";
            overlayContext.fillRect(x0, 0, width, overlay.clientHeight);
            overlayContext.strokeStyle = "rgba(0, 0, 0, 0.58)";
            overlayContext.lineWidth = 2;
            overlayContext.beginPath();
            overlayContext.moveTo(x0, 0);
            overlayContext.lineTo(x0, overlay.clientHeight);
            overlayContext.moveTo(x1, 0);
            overlayContext.lineTo(x1, overlay.clientHeight);
            overlayContext.stroke();
            overlayContext.restore();
          }
        }
      }
    }

    const maxX = Math.max(1, overlay.clientWidth - 1);
    const x = Math.min(Math.max(progress * overlay.clientWidth, 1), maxX);

    const styles = getComputedStyle(document.body);
    const ink = styles.getPropertyValue("--canvas-ink").trim() || "#1a1a1a";
    overlayContext.strokeStyle = ink;
    overlayContext.lineWidth = 2;
    overlayContext.beginPath();
    overlayContext.moveTo(x, 0);
    overlayContext.lineTo(x, overlay.clientHeight);
    overlayContext.stroke();

    if (resolvedDuration) {
      const loopStartValue = activeLoopDragRef.current
        ? loopStartRef.current
        : resolvedLoopStart;
      const loopEndValue = activeLoopDragRef.current ? loopEndRef.current : resolvedLoopEnd;
      const loopStartProgress = Math.min(
        Math.max((loopStartValue - windowStartRef.current) / visualDuration, 0),
        1
      );
      const loopEndProgress = Math.min(
        Math.max((loopEndValue - windowStartRef.current) / visualDuration, 0),
        1
      );
      const clampedStart = Math.min(Math.max(loopStartProgress, 0), 1);
      const clampedEnd = Math.min(Math.max(loopEndProgress, 0), 1);
      const loopStartHandle = loopStartHandleRef.current;
      const loopEndHandle = loopEndHandleRef.current;
      const loopRegion = loopRegionRef.current;
      const loopConnector = loopConnectorRef.current;
      const sliceHandles = sliceHandlesRef.current;

      const overlayWidth = overlay.clientWidth;
      if (overlayWidth > 0) {
        const startHandleWidth = loopStartHandle?.offsetWidth ?? 0;
        const endHandleWidth = loopEndHandle?.offsetWidth ?? 0;
        const startHalf = startHandleWidth / 2;
        const endHalf = endHandleWidth / 2;
        const startLeftPx = Math.min(
          Math.max(clampedStart * overlayWidth, startHalf),
          overlayWidth - startHalf
        );
        const endLeftPx = Math.min(
          Math.max(clampedEnd * overlayWidth, endHalf),
          overlayWidth - endHalf
        );
        if (loopStartHandle) {
          loopStartHandle.style.left = `${(startLeftPx / overlayWidth) * 100}%`;
        }
        if (loopEndHandle) {
          loopEndHandle.style.left = `${(endLeftPx / overlayWidth) * 100}%`;
        }
      }
      if (loopRegion) {
        const left = Math.min(clampedStart, clampedEnd);
        const width = Math.max(0, Math.abs(clampedEnd - clampedStart));
        loopRegion.style.left = `${left * 100}%`;
        loopRegion.style.width = `${width * 100}%`;
      }
      if (loopConnector) {
        const left = Math.min(clampedStart, clampedEnd);
        const width = Math.max(0, Math.abs(clampedEnd - clampedStart));
        loopConnector.style.left = `${left * 100}%`;
        loopConnector.style.width = `${width * 100}%`;
      }
      if (sliceHandles) {
        const left = Math.min(clampedStart, clampedEnd);
        const width = Math.max(0, Math.abs(clampedEnd - clampedStart));
        sliceHandles.style.left = `${left * 100}%`;
        sliceHandles.style.width = `${width * 100}%`;
      }

      if (resolvedLoopEnabled) {
        const startX = loopStartProgress * overlay.clientWidth;
        const endX = loopEndProgress * overlay.clientWidth;

        overlayContext.strokeStyle = "#0074FF";
        overlayContext.lineWidth = 2;
        overlayContext.beginPath();
        overlayContext.moveTo(startX, 0);
        overlayContext.lineTo(startX, overlay.clientHeight);
        overlayContext.stroke();

        overlayContext.beginPath();
        overlayContext.moveTo(endX, 0);
        overlayContext.lineTo(endX, overlay.clientHeight);
        overlayContext.stroke();
      }
    }
    setPerfTiming("renderOverlayMs", performance.now() - renderStart);
  }, [
    buffer,
    getDisplaySeconds,
    getResolvedDuration,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    waveformGainScale,
    zoom,
    rearrangerChaos,
    rearrangerSwapCount,
    rearrangerIds,
    rearrangerReverse,
    rearrangerRegions,
    rearrangerSlices,
    rearrangerDeletePreviewRanges,
    rearrangerDeleteMode,
    effectiveDeleteSliceIndex,
    showRearrangerSlices,
  ]);

  useLayoutEffect(() => {
    renderOverlayRef.current = renderOverlay;
  }, [renderOverlay]);

  useEffect(() => {
    renderOverlay();
  }, [renderOverlay, themeToken]);

  const scheduleRenderOverlay = useCallback(() => {
    if (overlayRafRef.current !== null) return;
    overlayRafRef.current = requestAnimationFrame(() => {
      overlayRafRef.current = null;
      renderOverlayRef.current();
    });
  }, []);

  useEffect(() => {
    if (!showRearrangerSlices) return;
    scheduleRenderOverlay();
  }, [rearrangerRegions, rearrangerSlices, scheduleRenderOverlay, showRearrangerSlices]);

  useEffect(() => {
    return () => {
      if (overlayRafRef.current !== null) {
        cancelAnimationFrame(overlayRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (loopChangeRafRef.current !== null) {
        cancelAnimationFrame(loopChangeRafRef.current);
      }
    };
  }, []);

  const flushLoopBoundsChange = useCallback(() => {
    if (!pendingLoopChangeRef.current) return;
    onLoopBoundsChange?.(
      pendingLoopChangeRef.current.start,
      pendingLoopChangeRef.current.end
    );
    pendingLoopChangeRef.current = null;
  }, [onLoopBoundsChange]);

  const scheduleLoopBoundsChange = useCallback(
    (start: number, end: number) => {
      if (!onLoopBoundsChange) return;
      pendingLoopChangeRef.current = { start, end };
      if (loopChangeRafRef.current !== null) return;
      loopChangeRafRef.current = requestAnimationFrame(() => {
        loopChangeRafRef.current = null;
        flushLoopBoundsChange();
      });
    },
    [flushLoopBoundsChange, onLoopBoundsChange]
  );

  const updateLoopFromPointer = (clientX: number) => {
    const resolvedDuration = getResolvedDuration();
    if (!resolvedDuration || !onLoopBoundsChange) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;

    const visualDuration = resolvedDuration / Math.max(1, zoom);
    const progress = (clientX - rect.left) / rect.width;
    const baseWindowStart = loopDragActiveRef.current
      ? loopDragWindowStartRef.current
      : windowStartRef.current;
    const seconds = baseWindowStart + progress * visualDuration;
    const minGap = Math.min(0.05, Math.max(0.005, resolvedDuration * 0.25));

    if (activeLoopDragRef.current === "start") {
      const nextEnd = loopEndRef.current;
      const nextStart = Math.min(seconds, nextEnd - minGap);
      loopStartRef.current = nextStart;
      loopEndRef.current = nextEnd;
      scheduleLoopBoundsChange(nextStart, nextEnd);
    } else if (activeLoopDragRef.current === "end") {
      const nextStart = loopStartRef.current;
      const nextEnd = Math.max(seconds, nextStart + minGap);
      loopStartRef.current = nextStart;
      loopEndRef.current = nextEnd;
      scheduleLoopBoundsChange(nextStart, nextEnd);
    }
  };

  const clampLoopStart = (
    nextStart: number,
    loopDuration: number,
    frameStart: number,
    frameDuration: number
  ) => {
    const resolvedDuration = getResolvedDuration();
    if (!resolvedDuration) return nextStart;
    const maxStart = Math.max(0, resolvedDuration - loopDuration);
    let minStart = 0;
    let maxStartClamp = maxStart;

    if (frameDuration > 0 && loopDuration <= frameDuration) {
      const frameEnd = frameStart + frameDuration;
      minStart = Math.max(frameStart, 0);
      maxStartClamp = Math.min(frameEnd - loopDuration, maxStart);
    }

    return Math.min(Math.max(nextStart, minStart), maxStartClamp);
  };

  const updateShiftLoopFromPointer = (clientX: number) => {
    const resolvedDuration = getResolvedDuration();
    if (!resolvedDuration || !onLoopBoundsChange) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;

    const visualDuration = resolvedDuration / Math.max(1, zoom);
    const progress = (clientX - rect.left) / rect.width;
    const baseWindowStart = loopDragWindowStartRef.current;
    const seconds = baseWindowStart + progress * visualDuration;
    const startSeconds = shiftStartRef.current;
    const clampedStart = Math.min(Math.max(Math.min(startSeconds, seconds), 0), resolvedDuration);
    const clampedEnd = Math.min(Math.max(Math.max(startSeconds, seconds), 0), resolvedDuration);
    const minGap = Math.min(0.05, Math.max(0.005, resolvedDuration * 0.25));
    const adjustedEnd =
      clampedEnd - clampedStart < minGap ? clampedStart + minGap : clampedEnd;
    const finalEnd = Math.min(adjustedEnd, resolvedDuration);

    loopStartRef.current = clampedStart;
    loopEndRef.current = finalEnd;
    scheduleLoopBoundsChange(clampedStart, finalEnd);
    scheduleRenderOverlay();
  };

  const clampWindowStart = (nextStart: number, durationSeconds: number, zoomValue: number) => {
    const visualDuration = durationSeconds / Math.max(1, zoomValue);
    const maxWindowStart = Math.max(0, durationSeconds - visualDuration);
    return Math.min(Math.max(0, nextStart), maxWindowStart);
  };

  useEffect(() => {
    if (!buffer) {
      bandPeaksRef.current = null;
      peaksPerSecondRef.current = 0;
      lastBufferRef.current = null;
      return;
    }
    if (lastBufferRef.current !== buffer) {
      lastBufferRef.current = buffer;
      bandPeaksRef.current = null;
      peaksPerSecondRef.current = 0;
    }
    const width = Math.max(1, Math.floor(canvasRef.current?.clientWidth ?? 1));
    const nextPeaksPerSecond = computePeaksPerSecond(
      width,
      buffer.duration,
      zoom
    );
    resolveBandPeaks(nextPeaksPerSecond, balance);
  }, [balance, buffer, computePeaksPerSecond, resolveBandPeaks, zoom]);

  useEffect(() => {
    if (isPlaying && startedAtMs !== undefined) {
      localStartMsRef.current = startedAtMs;
      return;
    }
    if (!isPlaying) {
      localStartMsRef.current = null;
    }
  }, [isPlaying, startedAtMs]);

  useEffect(() => {
    if (!buffer || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;

    if (!hasInitializedWindowRef.current) {
      windowStartRef.current = 0;
      lastDisplaySecondsRef.current = 0;
      visualDurationRef.current = 0;
      hasInitializedWindowRef.current = true;
    }

    const updateWindow = (startSeconds: number, width: number) => {
      windowStartRef.current = startSeconds;
      peaksRef.current = buildPeaksWithPerf(
        buffer,
        width,
        zoom,
        startSeconds,
        balance,
        eqLowGain,
        eqMidGain,
        eqHighGain
      );
      const styles = getComputedStyle(document.body);
      const ink = styles.getPropertyValue("--canvas-ink").trim() || "#111111";
      fillWaveformBackground(canvas);
      drawWaveform(canvas, peaksRef.current, ink, waveformGainScale);
      renderOverlayRef.current();
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { clientWidth, clientHeight } = parent;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(clientWidth * ratio));
      canvas.height = Math.max(1, Math.floor(clientHeight * ratio));
      const context = canvas.getContext("2d");
      if (context) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      if (overlay) {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        const overlayContext = overlay.getContext("2d");
        if (overlayContext) {
          overlayContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
      }
      const nextPeaksPerSecond = computePeaksPerSecond(
        Math.max(1, Math.floor(clientWidth)),
        buffer.duration,
        zoom
      );
      resolveBandPeaks(nextPeaksPerSecond, balance);
      updateWindow(windowStartRef.current, Math.max(1, Math.floor(clientWidth)));
    };

    const observer = new ResizeObserver(resize);
    const parentElement = canvas.parentElement;
    if (parentElement) {
      observer.observe(parentElement);
    }
    resize();

    return () => observer.disconnect();
  }, [
    balance,
    buffer,
    buildPeaksWithPerf,
    eqHighGain,
    eqLowGain,
    eqMidGain,
    themeToken,
    fillWaveformBackground,
    computePeaksPerSecond,
    resolveBandPeaks,
    waveformGainScale,
    zoom,
  ]);

  useEffect(() => {
    if (activeLoopDragRef.current === "region") return;
    loopStartRef.current = loopStartSeconds;
    loopEndRef.current = loopEndSeconds;
  }, [loopEndSeconds, loopStartSeconds]);


  useEffect(() => {
    if (!canvasRef.current || !buffer) return;
    const resolvedDuration = getResolvedDurationRef.current();
    const zoomChanged = zoom !== prevZoomRef.current;
    if (resolvedDuration && zoomChanged) {
      const visualDuration = resolvedDuration / Math.max(1, zoom);
      let centerSeconds: number | null = null;
      if (loopEnabled && loopEndSeconds > loopStartSeconds) {
        centerSeconds = (loopStartSeconds + loopEndSeconds) / 2;
      } else {
        const playheadSeconds = getDisplaySecondsRef.current();
        centerSeconds = Math.min(Math.max(playheadSeconds, 0), resolvedDuration);
      }
      const nextWindowStart = clampWindowStart(
        centerSeconds - visualDuration / 2,
        resolvedDuration,
        zoom
      );
      windowStartRef.current = nextWindowStart;
    }
    prevZoomRef.current = zoom;
    const width = Math.max(1, Math.floor(canvasRef.current.clientWidth));
    const nextPeaksPerSecond = computePeaksPerSecond(width, buffer.duration, zoom);
    resolveBandPeaks(nextPeaksPerSecond, balance);
    peaksRef.current = buildPeaksWithPerf(
      buffer,
      width,
      zoom,
      windowStartRef.current,
      balance,
      eqLowGain,
      eqMidGain,
      eqHighGain
    );
    const styles = getComputedStyle(document.body);
    const ink = styles.getPropertyValue("--canvas-ink").trim() || "#111111";
    fillWaveformBackground(canvasRef.current);
    drawWaveform(canvasRef.current, peaksRef.current, ink, waveformGainScale);
    renderOverlayRef.current();
  }, [
    balance,
    buffer,
    buildPeaksWithPerf,
    eqHighGain,
    eqLowGain,
    eqMidGain,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    themeToken,
    fillWaveformBackground,
    computePeaksPerSecond,
    resolveBandPeaks,
    waveformGainScale,
    zoom,
  ]);


  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;

    const animate = () => {
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);

      if (buffer) {
        const resolvedDuration = getResolvedDuration();
        if (!resolvedDuration) {
          rafRef.current = null;
          return;
        }
        const visualDuration = resolvedDuration / Math.max(1, zoom);

        visualDurationRef.current = visualDuration;
        renderOverlay();

      }

      if (isPlaying) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        rafRef.current = null;
      }
    };

    if (buffer) {
      if (isPlaying) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        animate();
      }
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    buffer,
    buildPeaksWithPerf,
    eqHighGain,
    eqLowGain,
    eqMidGain,
    isPlaying,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    offsetSeconds,
    getDisplaySeconds,
    getPlayback,
    getResolvedDuration,
    renderOverlay,
    themeToken,
    startedAtMs,
    fillWaveformBackground,
    waveformGainScale,
    zoom,
  ]);

  if (!buffer) {
    return (
      <div
        className="deck__waveform deck__waveform--empty"
        role="button"
        tabIndex={0}
        onClick={() => onEmptyClick?.()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onEmptyClick?.();
          }
        }}
      >
        Waveform / Spectrum
      </div>
    );
  }

  return (
    <div
      className="deck__waveform deck__waveform--interactive"
      ref={wrapperRef}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".deck__slice-handles, .deck__slice-handle")) {
          return;
        }
        if (dragMovedRef.current) {
          dragMovedRef.current = false;
          return;
        }
        if (!onSeek) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width) return;
        const progress = (event.clientX - rect.left) / rect.width;
        const visualDuration = visualDurationRef.current || getResolvedDuration();
        const windowStart = windowStartRef.current;
        const absoluteSeconds = windowStart + progress * visualDuration;
        const resolvedDuration = getResolvedDuration();
        const clampedProgress = resolvedDuration ? absoluteSeconds / resolvedDuration : progress;
        onSeek(clampedProgress);
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            ".deck__loop-region, .deck__loop-connector, .deck__loop-handle"
            + ", .deck__slice-handles, .deck__slice-handle"
          )
        ) {
          return;
        }
        if (loopDragActiveRef.current) return;
        pointerDownRef.current = true;
        panPointerIdRef.current = event.pointerId;
        if (!buffer) return;
        activeLoopDragRef.current = null;
        if (inertiaRef.current) {
          cancelAnimationFrame(inertiaRef.current);
          inertiaRef.current = null;
        }
        if (event.shiftKey && onLoopBoundsChange) {
          shiftDragPendingRef.current = true;
          shiftDragRef.current = false;
          isDraggingRef.current = false;
          dragMovedRef.current = false;
          shiftPointerStartXRef.current = event.clientX;
          const resolvedDuration = getResolvedDuration();
          if (resolvedDuration) {
            const rect = event.currentTarget.getBoundingClientRect();
            const visualDuration = resolvedDuration / Math.max(1, zoom);
            const progress = (event.clientX - rect.left) / rect.width;
            loopDragWindowStartRef.current = windowStartRef.current;
            shiftPointerStartSecondsRef.current =
              windowStartRef.current + progress * visualDuration;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        isDraggingRef.current = true;
        dragMovedRef.current = false;
        lastXRef.current = event.clientX;
        lastTimeRef.current = performance.now();
        velocityRef.current = 0;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (
          loopDragActiveRef.current ||
          activeLoopDragRef.current ||
          (event.target as HTMLElement | null)?.closest(
            ".deck__loop-region, .deck__loop-connector, .deck__loop-handle"
            + ", .deck__slice-handle"
          )
        ) {
          return;
        }
        if (
          !isDraggingRef.current ||
          !pointerDownRef.current ||
          panPointerIdRef.current !== event.pointerId ||
          !buffer ||
          !duration
        ) {
          if (
            shiftDragPendingRef.current &&
            pointerDownRef.current &&
            panPointerIdRef.current === event.pointerId &&
            buffer &&
            duration
          ) {
            if (Math.abs(event.clientX - shiftPointerStartXRef.current) > 2) {
              shiftDragPendingRef.current = false;
              shiftDragRef.current = true;
              isDraggingRef.current = true;
              dragMovedRef.current = true;
              shiftStartRef.current = shiftPointerStartSecondsRef.current;
              loopStartRef.current = shiftStartRef.current;
              loopEndRef.current = shiftStartRef.current;
              scheduleLoopBoundsChange(shiftStartRef.current, shiftStartRef.current);
              onLoopEnabledChange?.(true);
              updateShiftLoopFromPointer(event.clientX);
            }
          }
          return;
        }
        if (shiftDragRef.current) {
          updateShiftLoopFromPointer(event.clientX);
          return;
        }
        const now = performance.now();
        const deltaX = event.clientX - lastXRef.current;
        const deltaT = Math.max(1, now - lastTimeRef.current);
        if (Math.abs(deltaX) > 1) {
          dragMovedRef.current = true;
        }
        lastXRef.current = event.clientX;
        lastTimeRef.current = now;
        const visualDuration = duration / Math.max(1, zoom);
        const width = event.currentTarget.getBoundingClientRect().width || 1;
        const deltaSeconds = (deltaX / width) * visualDuration;
        const maxWindowStart = Math.max(0, duration - visualDuration);
        const nextStart = Math.min(
          Math.max(0, windowStartRef.current - deltaSeconds),
          maxWindowStart
        );
        velocityRef.current = deltaSeconds / (deltaT / 1000);
        if (nextStart !== windowStartRef.current && canvasRef.current) {
          windowStartRef.current = nextStart;
          peaksRef.current = buildPeaksWithPerf(
            buffer,
            Math.max(1, Math.floor(canvasRef.current.clientWidth)),
            zoom,
            nextStart,
            balance,
            eqLowGain,
            eqMidGain,
            eqHighGain
          );
          const styles = getComputedStyle(document.body);
          const ink = styles.getPropertyValue("--canvas-ink").trim() || "#111111";
          fillWaveformBackground(canvasRef.current);
          drawWaveform(canvasRef.current, peaksRef.current, ink, waveformGainScale);
          visualDurationRef.current = visualDuration;
          renderOverlay();
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (shiftDragPendingRef.current) {
          shiftDragPendingRef.current = false;
          shiftDragRef.current = false;
          pointerDownRef.current = false;
          if (panPointerIdRef.current === event.pointerId) {
            panPointerIdRef.current = null;
          }
          return;
        }
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        activeLoopDragRef.current = null;
        if (shiftDragRef.current) {
          shiftDragRef.current = false;
          pointerDownRef.current = false;
          flushLoopBoundsChange();
          onLoopBoundsChangeComplete?.();
          return;
        }
        pointerDownRef.current = false;
        if (panPointerIdRef.current === event.pointerId) {
          panPointerIdRef.current = null;
        }
        if (!buffer || !duration) return;

        const friction = 6;
        let velocity = velocityRef.current;

        const step = (timestamp: number) => {
          if (isDraggingRef.current) {
            inertiaRef.current = null;
            return;
          }

          const dt = Math.min(0.05, (timestamp - lastTimeRef.current) / 1000 || 0.016);
          lastTimeRef.current = timestamp;
          velocity *= Math.exp(-friction * dt);
          if (Math.abs(velocity) < 0.02) {
            inertiaRef.current = null;
            return;
          }

          const nextStart = clampWindowStart(
            windowStartRef.current - velocity * dt,
            duration,
            zoom
          );
          if (nextStart !== windowStartRef.current && canvasRef.current) {
            windowStartRef.current = nextStart;
            peaksRef.current = buildPeaksWithPerf(
              buffer,
              Math.max(1, Math.floor(canvasRef.current.clientWidth)),
              zoom,
              nextStart,
              balance,
              eqLowGain,
              eqMidGain,
              eqHighGain
            );
            const styles = getComputedStyle(document.body);
            const ink = styles.getPropertyValue("--canvas-ink").trim() || "#111111";
            fillWaveformBackground(canvasRef.current);
            drawWaveform(canvasRef.current, peaksRef.current, ink, waveformGainScale);
            visualDurationRef.current = duration / Math.max(1, zoom);
            renderOverlay();
          }

          inertiaRef.current = requestAnimationFrame(step);
        };

        if (Math.abs(velocity) >= 0.02) {
          lastTimeRef.current = performance.now();
          inertiaRef.current = requestAnimationFrame(step);
        }
      }}
      onPointerLeave={() => {
        const wasLoopAdjusting = activeLoopDragRef.current !== null || shiftDragRef.current;
        isDraggingRef.current = false;
        activeLoopDragRef.current = null;
        shiftDragRef.current = false;
        shiftDragPendingRef.current = false;
        pointerDownRef.current = false;
        loopDragActiveRef.current = false;
        panPointerIdRef.current = null;
        flushLoopBoundsChange();
        if (wasLoopAdjusting) {
          onLoopBoundsChangeComplete?.();
        }
      }}
    >
      {buffer && (
        <>
          <div
            ref={loopRegionRef}
            className={`deck__loop-region ${loopEnabled ? "is-active" : ""}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!loopEnabled) return;
              loopDragActiveRef.current = true;
              loopDragWindowStartRef.current = windowStartRef.current;
              panPointerIdRef.current = null;
              if (wrapperRef.current?.hasPointerCapture(event.pointerId)) {
                wrapperRef.current.releasePointerCapture(event.pointerId);
              }
              isDraggingRef.current = false;
              pointerDownRef.current = false;
              if (inertiaRef.current) {
                cancelAnimationFrame(inertiaRef.current);
                inertiaRef.current = null;
              }
              activeLoopDragRef.current = "region";
              isDraggingRef.current = true;
              dragMovedRef.current = true;
              lastDisplaySecondsRef.current = getDisplaySeconds();
              const resolvedDuration = getResolvedDuration();
              if (resolvedDuration && wrapperRef.current) {
                const rect = wrapperRef.current.getBoundingClientRect();
                const visualDuration = resolvedDuration / Math.max(1, zoom);
                const progress = (event.clientX - rect.left) / rect.width;
                const pointerSeconds =
                  loopDragWindowStartRef.current + progress * visualDuration;
                loopDragOffsetRef.current = pointerSeconds - loopStartRef.current;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (!isDraggingRef.current || activeLoopDragRef.current !== "region") return;
              const resolvedDuration = getResolvedDuration();
              if (!resolvedDuration || !wrapperRef.current) return;
              const rect = wrapperRef.current.getBoundingClientRect();
              const visualDuration = resolvedDuration / Math.max(1, zoom);
              const progress = (event.clientX - rect.left) / rect.width;
              const pointerSeconds =
                loopDragWindowStartRef.current + progress * visualDuration;
              const minGap = Math.min(
                0.05,
                Math.max(0.005, resolvedDuration * 0.25)
              );
              const loopDuration = Math.max(
                minGap,
                loopEndRef.current - loopStartRef.current
              );
              const targetStart = pointerSeconds - loopDragOffsetRef.current;
              const clampedStart = clampLoopStart(
                targetStart,
                loopDuration,
                windowStartRef.current,
                visualDuration
              );
              const clampedEnd = clampedStart + loopDuration;
              loopStartRef.current = clampedStart;
              loopEndRef.current = clampedEnd;
              scheduleLoopBoundsChange(clampedStart, clampedEnd);
              scheduleRenderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "region") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
              pointerDownRef.current = false;
              flushLoopBoundsChange();
              onLoopBoundsChangeComplete?.();
              loopDragActiveRef.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
          {loopEnabled && (
            <div
              ref={loopConnectorRef}
              className="deck__loop-connector is-active"
              onPointerDown={(event) => {
                event.stopPropagation();
                if (!loopEnabled) return;
                loopDragActiveRef.current = true;
                loopDragWindowStartRef.current = windowStartRef.current;
                panPointerIdRef.current = null;
                if (wrapperRef.current?.hasPointerCapture(event.pointerId)) {
                  wrapperRef.current.releasePointerCapture(event.pointerId);
                }
                isDraggingRef.current = false;
                pointerDownRef.current = false;
                if (inertiaRef.current) {
                  cancelAnimationFrame(inertiaRef.current);
                  inertiaRef.current = null;
                }
                activeLoopDragRef.current = "region";
                isDraggingRef.current = true;
                dragMovedRef.current = true;
                const resolvedDuration = getResolvedDuration();
              if (resolvedDuration && wrapperRef.current) {
                const rect = wrapperRef.current.getBoundingClientRect();
                const visualDuration = resolvedDuration / Math.max(1, zoom);
                const progress = (event.clientX - rect.left) / rect.width;
                const pointerSeconds =
                  loopDragWindowStartRef.current + progress * visualDuration;
                loopDragOffsetRef.current = pointerSeconds - loopStartRef.current;
              }
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (!isDraggingRef.current || activeLoopDragRef.current !== "region") return;
              const resolvedDuration = getResolvedDuration();
              if (!resolvedDuration || !wrapperRef.current) return;
              const rect = wrapperRef.current.getBoundingClientRect();
              const visualDuration = resolvedDuration / Math.max(1, zoom);
              const progress = (event.clientX - rect.left) / rect.width;
              const pointerSeconds =
                loopDragWindowStartRef.current + progress * visualDuration;
              const minGap = Math.min(
                0.05,
                Math.max(0.005, resolvedDuration * 0.25)
              );
              const loopDuration = Math.max(
                minGap,
                loopEndRef.current - loopStartRef.current
              );
              const targetStart = pointerSeconds - loopDragOffsetRef.current;
              const clampedStart = clampLoopStart(
                targetStart,
                loopDuration,
                windowStartRef.current,
                visualDuration
              );
              const clampedEnd = clampedStart + loopDuration;
              loopStartRef.current = clampedStart;
              loopEndRef.current = clampedEnd;
              scheduleLoopBoundsChange(clampedStart, clampedEnd);
              scheduleRenderOverlay();
            }}
              onPointerUp={(event) => {
                if (activeLoopDragRef.current === "region") {
                  activeLoopDragRef.current = null;
                  isDraggingRef.current = false;
                }
                pointerDownRef.current = false;
                flushLoopBoundsChange();
                onLoopBoundsChangeComplete?.();
                loopDragActiveRef.current = false;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            />
          )}
          <div
            ref={loopStartHandleRef}
            className={`deck__loop-handle ${loopEnabled ? "is-active" : ""}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.shiftKey && onLoopBoundsChange) {
                const resolvedDuration = getResolvedDuration();
                if (!resolvedDuration) return;
                const minGap = Math.min(0.05, Math.max(0.005, resolvedDuration * 0.25));
                const nextEnd = Math.max(loopEndRef.current, minGap);
                const nextStart = Math.min(0, nextEnd - minGap);
                loopStartRef.current = nextStart;
                loopEndRef.current = nextEnd;
                scheduleLoopBoundsChange(nextStart, nextEnd);
                flushLoopBoundsChange();
                scheduleRenderOverlay();
                onLoopBoundsChangeComplete?.();
                return;
              }
              loopDragActiveRef.current = true;
              loopDragWindowStartRef.current = windowStartRef.current;
              panPointerIdRef.current = null;
              if (wrapperRef.current?.hasPointerCapture(event.pointerId)) {
                wrapperRef.current.releasePointerCapture(event.pointerId);
              }
              isDraggingRef.current = false;
              pointerDownRef.current = false;
              if (inertiaRef.current) {
                cancelAnimationFrame(inertiaRef.current);
                inertiaRef.current = null;
              }
              activeLoopDragRef.current = "start";
              isDraggingRef.current = true;
              dragMovedRef.current = true;
              lastDisplaySecondsRef.current = getDisplaySeconds();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (!isDraggingRef.current || activeLoopDragRef.current !== "start") return;
              updateLoopFromPointer(event.clientX);
              scheduleRenderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "start") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
              pointerDownRef.current = false;
              flushLoopBoundsChange();
              onLoopBoundsChangeComplete?.();
              loopDragActiveRef.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            IN
          </div>
          <div
            ref={loopEndHandleRef}
            className={`deck__loop-handle ${loopEnabled ? "is-active" : ""}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.shiftKey && onLoopBoundsChange) {
                const resolvedDuration = getResolvedDuration();
                if (!resolvedDuration) return;
                const minGap = Math.min(0.05, Math.max(0.005, resolvedDuration * 0.25));
                const nextStart = Math.max(0, Math.min(loopStartRef.current, resolvedDuration - minGap));
                const nextEnd = resolvedDuration;
                loopStartRef.current = nextStart;
                loopEndRef.current = nextEnd;
                scheduleLoopBoundsChange(nextStart, nextEnd);
                flushLoopBoundsChange();
                scheduleRenderOverlay();
                onLoopBoundsChangeComplete?.();
                return;
              }
              loopDragActiveRef.current = true;
              loopDragWindowStartRef.current = windowStartRef.current;
              panPointerIdRef.current = null;
              if (wrapperRef.current?.hasPointerCapture(event.pointerId)) {
                wrapperRef.current.releasePointerCapture(event.pointerId);
              }
              isDraggingRef.current = false;
              pointerDownRef.current = false;
              if (inertiaRef.current) {
                cancelAnimationFrame(inertiaRef.current);
                inertiaRef.current = null;
              }
              activeLoopDragRef.current = "end";
              isDraggingRef.current = true;
              dragMovedRef.current = true;
              lastDisplaySecondsRef.current = getDisplaySeconds();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (!isDraggingRef.current || activeLoopDragRef.current !== "end") return;
              updateLoopFromPointer(event.clientX);
              scheduleRenderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "end") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
              pointerDownRef.current = false;
              flushLoopBoundsChange();
              onLoopBoundsChangeComplete?.();
              loopDragActiveRef.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            OUT
          </div>
        </>
      )}
      <canvas ref={canvasRef} />
      <canvas ref={overlayRef} className="deck__waveform-overlay" />
      {showRearrangerSlices &&
      loopEnabled &&
      loopEndSeconds > loopStartSeconds + 0.01 &&
      rearrangerInsertPreview !== null ? (
        <div
          className="deck__slice-preview-line"
          aria-hidden="true"
          style={{ left: `${rearrangerInsertPreview * 100}%` }}
        />
      ) : null}
      {showRearrangerSlices && loopEnabled && loopEndSeconds > loopStartSeconds + 0.01 ? (
        <div
          ref={sliceHandlesRef}
          className={`deck__slice-handles ${rearrangerDeleteMode ? "is-delete-mode" : ""}`.trim()}
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            if (
              event.target !== event.currentTarget ||
              !onRearrangerRegionsChange
            ) {
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              setRearrangerDeleteSliceIndex(null);
              scheduleRenderOverlay();
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            if (!rect.width) {
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              setRearrangerDeleteSliceIndex(null);
              scheduleRenderOverlay();
              return;
            }
            const raw = (event.clientX - rect.left) / rect.width;
            const minGap = 0.002;
            const nextPoint = Math.max(0, Math.min(1, raw));
            let insertAfter = -1;
            for (let i = 0; i < rearrangerHandleRegions.length - 1; i += 1) {
              const a = rearrangerHandleRegions[i];
              const b = rearrangerHandleRegions[i + 1];
              if (nextPoint >= a && nextPoint <= b) {
                insertAfter = i;
                break;
              }
            }
            if (insertAfter < 0) {
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              setRearrangerDeleteSliceIndex(null);
              scheduleRenderOverlay();
              return;
            }
            if (event.shiftKey && rearrangerSlices > 1) {
              if (onRearrangerSliceDelete) {
                applyOptimisticRearrangerRegions(null);
                onRearrangerSliceDelete(insertAfter);
              }
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              setRearrangerDeleteSliceIndex(null);
              scheduleRenderOverlay();
              return;
            }
            if (rearrangerSlices >= MAX_REARRANGER_SLICES) {
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              setRearrangerDeleteSliceIndex(null);
              scheduleRenderOverlay();
              return;
            }
            const previous = rearrangerHandleRegions[insertAfter] + minGap;
            const next = rearrangerHandleRegions[insertAfter + 1] - minGap;
            const clamped = Math.min(Math.max(nextPoint, previous), next);
            if (clamped <= previous || clamped >= next) {
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              setRearrangerDeleteSliceIndex(null);
              scheduleRenderOverlay();
              return;
            }
            const nextRegions = [...rearrangerHandleRegions];
            nextRegions.splice(insertAfter + 1, 0, clamped);
            applyOptimisticRearrangerRegions(nextRegions);
            onRearrangerRegionsChange(nextRegions);
            rearrangerInsertPreviewRef.current = null;
            setRearrangerInsertPreview(null);
            setRearrangerDeleteSliceIndex(null);
            scheduleRenderOverlay();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onPointerEnter={() => {
            setIsSliceZoneHovered(true);
          }}
          onPointerMove={(event) => {
            if (
              event.target !== event.currentTarget ||
              !onRearrangerRegionsChange
            ) {
              if (rearrangerInsertPreviewRef.current !== null) {
                rearrangerInsertPreviewRef.current = null;
                setRearrangerInsertPreview(null);
                scheduleRenderOverlay();
              }
              if (rearrangerDeleteSliceIndex !== null) {
                setRearrangerDeleteSliceIndex(null);
              }
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            if (!rect.width) {
              if (rearrangerInsertPreviewRef.current !== null) {
                rearrangerInsertPreviewRef.current = null;
                setRearrangerInsertPreview(null);
                scheduleRenderOverlay();
              }
              if (rearrangerDeleteSliceIndex !== null) {
                setRearrangerDeleteSliceIndex(null);
              }
              return;
            }
            const raw = (event.clientX - rect.left) / rect.width;
            const minGap = 0.002;
            const nextPoint = Math.max(0, Math.min(1, raw));
            let insertAfter = -1;
            for (let i = 0; i < rearrangerHandleRegions.length - 1; i += 1) {
              const a = rearrangerHandleRegions[i];
              const b = rearrangerHandleRegions[i + 1];
              if (nextPoint >= a && nextPoint <= b) {
                insertAfter = i;
                break;
              }
            }
            if (insertAfter < 0) {
              if (rearrangerInsertPreviewRef.current !== null) {
                rearrangerInsertPreviewRef.current = null;
                setRearrangerInsertPreview(null);
                scheduleRenderOverlay();
              }
              if (rearrangerDeleteSliceIndex !== null) {
                setRearrangerDeleteSliceIndex(null);
              }
              return;
            }
            if (event.shiftKey && rearrangerSlices > 1) {
              if (insertAfter !== rearrangerDeleteSliceIndex) {
                setRearrangerDeleteSliceIndex(insertAfter);
              }
              if (rearrangerInsertPreviewRef.current !== null) {
                rearrangerInsertPreviewRef.current = null;
                setRearrangerInsertPreview(null);
                scheduleRenderOverlay();
              }
              return;
            }
            if (rearrangerDeleteSliceIndex !== null) {
              setRearrangerDeleteSliceIndex(null);
            }
            if (rearrangerSlices >= MAX_REARRANGER_SLICES) {
              if (rearrangerInsertPreviewRef.current !== null) {
                rearrangerInsertPreviewRef.current = null;
                setRearrangerInsertPreview(null);
                scheduleRenderOverlay();
              }
              return;
            }
            const previous = rearrangerHandleRegions[insertAfter] + minGap;
            const next = rearrangerHandleRegions[insertAfter + 1] - minGap;
            const clamped = Math.min(Math.max(nextPoint, previous), next);
            const preview =
              clamped <= previous || clamped >= next ? null : clamped;
            if (
              (preview === null && rearrangerInsertPreviewRef.current !== null) ||
              (preview !== null &&
                Math.abs((rearrangerInsertPreviewRef.current ?? -1) - preview) > 1e-4)
            ) {
              rearrangerInsertPreviewRef.current = preview;
              setRearrangerInsertPreview(preview);
              scheduleRenderOverlay();
            }
          }}
          onPointerLeave={() => {
            if (rearrangerInsertPreviewRef.current !== null) {
              rearrangerInsertPreviewRef.current = null;
              setRearrangerInsertPreview(null);
              scheduleRenderOverlay();
            }
            setRearrangerDeleteSliceIndex(null);
            setIsSliceZoneHovered(false);
          }}
        >
          {rearrangerHandleRegions.slice(1, -1).map((point, localIndex) => {
            const boundaryIndex = localIndex + 1;
            const colorIndex = Math.min(
              boundaryIndex,
              rearrangerHandleMap.length - 1
            );
            const id = rearrangerIds[colorIndex] ?? colorIndex;
            const hue =
              ((id % Math.max(1, rearrangerHandleMap.length)) /
                Math.max(1, rearrangerHandleMap.length)) *
              360;
            return (
              <button
                key={`slice-handle-${boundaryIndex}`}
                type="button"
                className="deck__slice-handle"
                style={{
                  left: `${point * 100}%`,
                  backgroundColor: `hsl(${hue.toFixed(1)} 82% 58%)`,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  rearrangerHandleDragRef.current = {
                    pointerId: event.pointerId,
                    boundaryIndex,
                  };
                  rearrangerHandleMovedRef.current = false;
                  rearrangerHandleStartXRef.current = event.clientX;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = rearrangerHandleDragRef.current;
                  if (
                    !drag ||
                    drag.pointerId !== event.pointerId ||
                    !onRearrangerRegionsChange
                  ) {
                    return;
                  }
                  event.stopPropagation();
                  if (Math.abs(event.clientX - rearrangerHandleStartXRef.current) > 2) {
                    rearrangerHandleMovedRef.current = true;
                  }
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (!rect) return;
                  if (!rect.width) return;
                  const raw = (event.clientX - rect.left) / rect.width;
                  const minGap = 0.002;
                  const previous = rearrangerHandleRegions[drag.boundaryIndex - 1] + minGap;
                  const next = rearrangerHandleRegions[drag.boundaryIndex + 1] - minGap;
                  const clamped = Math.min(Math.max(raw, previous), next);
                  if (Math.abs(clamped - rearrangerHandleRegions[drag.boundaryIndex]) < 1e-4) {
                    return;
                  }
                  const nextRegions = [...rearrangerHandleRegions];
                  nextRegions[drag.boundaryIndex] = clamped;
                  applyOptimisticRearrangerRegions(nextRegions);
                  onRearrangerRegionsChange(nextRegions);
                }}
                onPointerUp={(event) => {
                  if (rearrangerHandleDragRef.current?.pointerId === event.pointerId) {
                    rearrangerHandleDragRef.current = null;
                  }
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (rearrangerHandleMovedRef.current) {
                    rearrangerHandleMovedRef.current = false;
                    return;
                  }
                  if (!onRearrangerRegionsChange) return;
                  if (rearrangerSlices <= 1) return;
                  const nextRegions = [...rearrangerHandleRegions];
                  nextRegions.splice(boundaryIndex, 1);
                  applyOptimisticRearrangerRegions(nextRegions);
                  onRearrangerRegionsChange(nextRegions);
                }}
                onPointerLeave={() => {
                  rearrangerHandleDragRef.current = null;
                }}
              />
            );
          })}
        </div>
      ) : null}
      <div className="deck__waveform-time" aria-hidden="true">
        <span ref={totalTimeLabelRef}>{formatTimeLabel(buffer.duration)}</span>
      </div>
    </div>
  );
};

export default memo(Waveform);
