import { memo, useCallback, useEffect, useRef } from "react";

type WaveformProps = {
  buffer?: AudioBuffer;
  isPlaying?: boolean;
  startedAtMs?: number;
  duration?: number;
  offsetSeconds?: number;
  zoom?: number;
  loopEnabled?: boolean;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  onSeek?: (progress: number) => void;
  onLoopBoundsChange?: (
    startSeconds: number,
    endSeconds: number,
  ) => void;
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
};

const buildPeaks = (
  buffer: AudioBuffer,
  width: number,
  zoom: number,
  startSeconds: number
) => {
  const data = buffer.getChannelData(0);
  const effectiveZoom = Math.max(1, zoom);
  const visibleSamples = Math.max(1, Math.floor(data.length / effectiveZoom));
  const startSample = Math.min(
    Math.max(0, Math.floor(startSeconds * buffer.sampleRate)),
    Math.max(0, data.length - visibleSamples)
  );
  const step = Math.max(1, Math.floor(visibleSamples / width));
  const peaks: Array<{ min: number; max: number }> = [];

  for (let i = 0; i < width; i += 1) {
    let min = 1;
    let max = -1;
    const start = startSample + i * step;
    const end = Math.min(start + step, startSample + visibleSamples);
    for (let j = start; j < end; j += 1) {
      const sample = data[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks.push({ min, max });
  }

  return peaks;
};

const drawWaveform = (
  canvas: HTMLCanvasElement,
  peaks: Array<{ min: number; max: number }>,
  color: string
) => {
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#f6f9ff";
  context.fillRect(0, 0, width, height);

  const amp = height / 2;

  context.strokeStyle = color;
  context.lineWidth = 1;
  context.beginPath();

  for (let i = 0; i < peaks.length; i += 1) {
    const peak = peaks[i];
    context.moveTo(i, amp + peak.min * amp);
    context.lineTo(i, amp + peak.max * amp);
  }

  context.stroke();
};

const Waveform = ({
  buffer,
  isPlaying,
  startedAtMs,
  duration,
  offsetSeconds,
  zoom = 1,
  loopEnabled = false,
  loopStartSeconds = 0,
  loopEndSeconds = 0,
  onSeek,
  onLoopBoundsChange,
  getCurrentSeconds,
  onEmptyClick,
  getPlaybackSnapshot,
}: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
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
  const loopStartRef = useRef(loopStartSeconds);
  const loopEndRef = useRef(loopEndSeconds);
  const loopDragOffsetRef = useRef(0);
  const pointerDownRef = useRef(false);
  const lastDisplaySecondsRef = useRef(0);
  const localStartMsRef = useRef<number | null>(null);

  const getPlayback = useCallback(() => getPlaybackSnapshot?.() ?? null, [getPlaybackSnapshot]);
  const getResolvedDuration = useCallback(() => {
    const snapshot = getPlayback();
    const fallbackDuration = duration ?? buffer?.duration ?? 0;
    const nextDuration =
      snapshot && Number.isFinite(snapshot.duration) && snapshot.duration > 0
        ? snapshot.duration
        : fallbackDuration;
    return Number.isFinite(nextDuration) ? nextDuration : 0;
  }, [buffer?.duration, duration, getPlayback]);

  const getDisplaySeconds = useCallback(() => {
    const snapshot = getPlayback();
    const resolvedDuration = getResolvedDuration();
    const resolvedLoopEnabled = snapshot?.loopEnabled ?? loopEnabled;
    const resolvedLoopStart = snapshot?.loopStart ?? loopStartSeconds;
    const resolvedLoopEnd =
      snapshot?.loopEnd ?? (loopEndSeconds > resolvedLoopStart ? loopEndSeconds : resolvedDuration);
    const playbackRate = snapshot?.playbackRate ?? 1;

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
        return resolvedDuration ? Math.min(position, resolvedDuration) : position;
      }
    }

    if (snapshot) {
      return resolvedDuration ? Math.min(snapshot.position, resolvedDuration) : snapshot.position;
    }
    if (!resolvedDuration) return 0;
    const engineSeconds = getCurrentSeconds?.();
    if (engineSeconds !== null && engineSeconds !== undefined) {
      return Math.min(engineSeconds, resolvedDuration);
    }
    return Math.min(offsetSeconds ?? 0, resolvedDuration);
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

  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay || !buffer) return;
    const snapshot = getPlayback();
    const resolvedDuration = getResolvedDuration();
    if (!resolvedDuration) return;

    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;

    overlayContext.clearRect(0, 0, overlay.width, overlay.height);

    const visualDuration = resolvedDuration / Math.max(1, zoom);
    let currentSeconds = getDisplaySeconds();
    const resolvedLoopEnabled = snapshot?.loopEnabled ?? loopEnabled;
    const resolvedLoopStart = snapshot?.loopStart ?? loopStartSeconds;
    const resolvedLoopEnd =
      snapshot?.loopEnd ?? (loopEndSeconds > resolvedLoopStart ? loopEndSeconds : resolvedDuration);
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
      drawWaveform(overlay, peaks, "#0074FF");
      overlayContext.restore();
    }

    const maxX = Math.max(1, overlay.clientWidth - 1);
    const x = Math.min(Math.max(progress * overlay.clientWidth, 1), maxX);

    overlayContext.strokeStyle = "#1a1a1a";
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
  }, [
    buffer,
    getDisplaySeconds,
    getPlayback,
    getResolvedDuration,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    zoom,
  ]);

  const updateLoopFromPointer = (clientX: number) => {
    const resolvedDuration = getResolvedDuration();
    if (!resolvedDuration || !onLoopBoundsChange) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;

    const visualDuration = resolvedDuration / Math.max(1, zoom);
    const progress = (clientX - rect.left) / rect.width;
    const seconds = windowStartRef.current + progress * visualDuration;
    const minGap = Math.min(0.05, Math.max(0.005, resolvedDuration * 0.25));

    if (activeLoopDragRef.current === "start") {
      const nextEnd = loopEndRef.current;
      const nextStart = Math.min(seconds, nextEnd - minGap);
      loopStartRef.current = nextStart;
      loopEndRef.current = nextEnd;
      onLoopBoundsChange(nextStart, nextEnd);
    } else if (activeLoopDragRef.current === "end") {
      const nextStart = loopStartRef.current;
      const nextEnd = Math.max(seconds, nextStart + minGap);
      loopStartRef.current = nextStart;
      loopEndRef.current = nextEnd;
      onLoopBoundsChange(nextStart, nextEnd);
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

  const clampWindowStart = (nextStart: number, durationSeconds: number, zoomValue: number) => {
    const visualDuration = durationSeconds / Math.max(1, zoomValue);
    const maxWindowStart = Math.max(0, durationSeconds - visualDuration);
    return Math.min(Math.max(0, nextStart), maxWindowStart);
  };

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

    windowStartRef.current = 0;
    lastDisplaySecondsRef.current = 0;
    visualDurationRef.current = 0;

    const updateWindow = (startSeconds: number, width: number) => {
      let nextStart = startSeconds;
      const resolvedDuration = getResolvedDuration();
      if (resolvedDuration && isPlaying && !activeLoopDragRef.current) {
        const visualDuration = resolvedDuration / Math.max(1, zoom);
        const currentSeconds = getDisplaySeconds();
        const windowEnd = startSeconds + visualDuration;
        if (currentSeconds >= windowEnd) {
          nextStart = clampWindowStart(currentSeconds, resolvedDuration, zoom);
        } else if (currentSeconds < startSeconds) {
          nextStart = clampWindowStart(currentSeconds, resolvedDuration, zoom);
        }
      }
      windowStartRef.current = nextStart;
      peaksRef.current = buildPeaks(buffer, width, zoom, nextStart);
      drawWaveform(canvas, peaksRef.current, "#111111");
      renderOverlay();
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
      updateWindow(windowStartRef.current, Math.max(1, Math.floor(clientWidth)));
    };

    const observer = new ResizeObserver(resize);
    const parentElement = canvas.parentElement;
    if (parentElement) {
      observer.observe(parentElement);
    }
    resize();

    return () => observer.disconnect();
  }, [buffer, getDisplaySeconds, getResolvedDuration, isPlaying, renderOverlay, zoom]);

  useEffect(() => {
    if (activeLoopDragRef.current === "region") return;
    loopStartRef.current = loopStartSeconds;
    loopEndRef.current = loopEndSeconds;
  }, [loopEndSeconds, loopStartSeconds]);


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
        const currentSeconds = getDisplaySeconds();
        const maxWindowStart = Math.max(0, resolvedDuration - visualDuration);
        let desiredWindowStart = windowStartRef.current;
        if (isPlaying && !isDraggingRef.current) {
          const snapshot = getPlayback();
          const resolvedLoopEnabled = snapshot?.loopEnabled ?? loopEnabled;
          const resolvedLoopStart = snapshot?.loopStart ?? loopStartSeconds;
          const resolvedLoopEnd = snapshot?.loopEnd ?? loopEndSeconds;
          if (resolvedLoopEnabled && resolvedLoopEnd > resolvedLoopStart) {
            const loopDuration = resolvedLoopEnd - resolvedLoopStart;
            if (loopDuration > visualDuration) {
              desiredWindowStart = Math.min(resolvedLoopStart, maxWindowStart);
            }
          } else {
            const windowEnd = windowStartRef.current + visualDuration;
            if (currentSeconds >= windowEnd) {
              desiredWindowStart = Math.min(currentSeconds, maxWindowStart);
            } else if (currentSeconds < windowStartRef.current) {
              desiredWindowStart = Math.max(0, Math.min(currentSeconds, maxWindowStart));
            }
          }
        }

        if (
          Math.abs(desiredWindowStart - windowStartRef.current) > 0.0001 &&
          canvasRef.current
        ) {
          const width = Math.max(1, Math.floor(canvasRef.current.clientWidth));
          peaksRef.current = buildPeaks(buffer, width, zoom, desiredWindowStart);
          drawWaveform(canvasRef.current, peaksRef.current, "#111111");
          windowStartRef.current = desiredWindowStart;
        }

        visualDurationRef.current = visualDuration;
        renderOverlay();

        if (isPlaying) {
          rafRef.current = requestAnimationFrame(animate);
          return;
        }
      }

      rafRef.current = null;
    };

    if (isPlaying && buffer && startedAtMs !== undefined) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      animate();
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    buffer,
    isPlaying,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    offsetSeconds,
    getDisplaySeconds,
    getPlayback,
    getResolvedDuration,
    renderOverlay,
    startedAtMs,
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
        pointerDownRef.current = true;
        if (!buffer) return;
        activeLoopDragRef.current = null;
        if (inertiaRef.current) {
          cancelAnimationFrame(inertiaRef.current);
          inertiaRef.current = null;
        }
        isDraggingRef.current = true;
        dragMovedRef.current = false;
        lastXRef.current = event.clientX;
        lastTimeRef.current = performance.now();
        velocityRef.current = 0;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!isDraggingRef.current || !buffer || !duration) return;
        if (activeLoopDragRef.current && onLoopBoundsChange) {
          updateLoopFromPointer(event.clientX);
          dragMovedRef.current = true;
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
          peaksRef.current = buildPeaks(
            buffer,
            Math.max(1, Math.floor(canvasRef.current.clientWidth)),
            zoom,
            nextStart
          );
          drawWaveform(canvasRef.current, peaksRef.current, "#111111");
          visualDurationRef.current = visualDuration;
          renderOverlay();
        }
      }}
      onPointerUp={(event) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        activeLoopDragRef.current = null;
        pointerDownRef.current = false;
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
            peaksRef.current = buildPeaks(
              buffer,
              Math.max(1, Math.floor(canvasRef.current.clientWidth)),
              zoom,
              nextStart
            );
            drawWaveform(canvasRef.current, peaksRef.current, "#111111");
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
        isDraggingRef.current = false;
        activeLoopDragRef.current = null;
        pointerDownRef.current = false;
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
                const pointerSeconds = windowStartRef.current + progress * visualDuration;
                loopDragOffsetRef.current = pointerSeconds - loopStartRef.current;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!isDraggingRef.current || activeLoopDragRef.current !== "region") return;
              const resolvedDuration = getResolvedDuration();
              if (!resolvedDuration || !wrapperRef.current) return;
              const rect = wrapperRef.current.getBoundingClientRect();
              const visualDuration = resolvedDuration / Math.max(1, zoom);
              const progress = (event.clientX - rect.left) / rect.width;
              const pointerSeconds = windowStartRef.current + progress * visualDuration;
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
              onLoopBoundsChange?.(clampedStart, clampedEnd);
              renderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "region") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
              pointerDownRef.current = false;
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
                const pointerSeconds = windowStartRef.current + progress * visualDuration;
                loopDragOffsetRef.current = pointerSeconds - loopStartRef.current;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!isDraggingRef.current || activeLoopDragRef.current !== "region") return;
              const resolvedDuration = getResolvedDuration();
              if (!resolvedDuration || !wrapperRef.current) return;
              const rect = wrapperRef.current.getBoundingClientRect();
              const visualDuration = resolvedDuration / Math.max(1, zoom);
              const progress = (event.clientX - rect.left) / rect.width;
              const pointerSeconds = windowStartRef.current + progress * visualDuration;
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
              onLoopBoundsChange?.(clampedStart, clampedEnd);
              renderOverlay();
            }}
              onPointerUp={(event) => {
                if (activeLoopDragRef.current === "region") {
                  activeLoopDragRef.current = null;
                  isDraggingRef.current = false;
                }
                pointerDownRef.current = false;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            />
          )}
          <div
            ref={loopStartHandleRef}
            className={`deck__loop-handle ${loopEnabled ? "is-active" : ""}`}
            onPointerDown={(event) => {
              event.stopPropagation();
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
              if (!isDraggingRef.current || activeLoopDragRef.current !== "start") return;
              updateLoopFromPointer(event.clientX);
              renderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "start") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
              pointerDownRef.current = false;
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
              if (!isDraggingRef.current || activeLoopDragRef.current !== "end") return;
              updateLoopFromPointer(event.clientX);
              renderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "end") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
              pointerDownRef.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            OUT
          </div>
        </>
      )}
      <canvas ref={canvasRef} />
      <canvas ref={overlayRef} className="deck__waveform-overlay" />
    </div>
  );
};

export default memo(Waveform);
