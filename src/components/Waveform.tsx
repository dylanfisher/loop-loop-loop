import { useCallback, useEffect, useRef } from "react";

type WaveformProps = {
  buffer?: AudioBuffer;
  isPlaying?: boolean;
  startedAtMs?: number;
  duration?: number;
  offsetSeconds?: number;
  zoom?: number;
  follow?: boolean;
  loopEnabled?: boolean;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  onSeek?: (progress: number) => void;
  onLoopBoundsChange?: (
    startSeconds: number,
    endSeconds: number,
  ) => void;
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
  follow = true,
  loopEnabled = false,
  loopStartSeconds = 0,
  loopEndSeconds = 0,
  onSeek,
  onLoopBoundsChange,
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

  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay || !buffer || !duration) return;

    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;

    overlayContext.clearRect(0, 0, overlay.width, overlay.height);

    const baseOffset = offsetSeconds ?? 0;
    const visualDuration = duration / Math.max(1, zoom);
    const elapsed =
      isPlaying && startedAtMs !== undefined
        ? (performance.now() - startedAtMs) / 1000
        : 0;
    let currentSeconds = Math.min(baseOffset + elapsed, duration);
    if (!activeLoopDragRef.current && loopEnabled && loopEndSeconds > loopStartSeconds) {
      const loopDuration = loopEndSeconds - loopStartSeconds;
      const loopOffset = currentSeconds - loopStartSeconds;
      const wrapped =
        ((loopOffset % loopDuration) + loopDuration) % loopDuration;
      currentSeconds = loopStartSeconds + wrapped;
    }
    const progress = Math.min(
      (currentSeconds - windowStartRef.current) / visualDuration,
      1
    );
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

    const x = progress * overlay.clientWidth;

    overlayContext.strokeStyle = "#1a1a1a";
    overlayContext.lineWidth = 2;
    overlayContext.beginPath();
    overlayContext.moveTo(x, 0);
    overlayContext.lineTo(x, overlay.clientHeight);
    overlayContext.stroke();

    if (duration) {
      const loopStartProgress = Math.min(
        Math.max((loopStartSeconds - windowStartRef.current) / visualDuration, 0),
        1
      );
      const loopEndProgress = Math.min(
        Math.max((loopEndSeconds - windowStartRef.current) / visualDuration, 0),
        1
      );
      const clampedStart = Math.min(Math.max(loopStartProgress, 0), 1);
      const clampedEnd = Math.min(Math.max(loopEndProgress, 0), 1);
      const loopStartHandle = loopStartHandleRef.current;
      const loopEndHandle = loopEndHandleRef.current;
      const loopRegion = loopRegionRef.current;
      const loopConnector = loopConnectorRef.current;

      if (loopStartHandle) {
        loopStartHandle.style.left = `${clampedStart * 100}%`;
      }
      if (loopEndHandle) {
        loopEndHandle.style.left = `${clampedEnd * 100}%`;
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

      if (loopEnabled) {
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
    duration,
    isPlaying,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    offsetSeconds,
    startedAtMs,
    zoom,
  ]);

  const updateLoopFromPointer = (clientX: number) => {
    if (!duration || !onLoopBoundsChange) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;

    const visualDuration = duration / Math.max(1, zoom);
    const progress = (clientX - rect.left) / rect.width;
    const seconds = windowStartRef.current + progress * visualDuration;
    const minGap = 0.05;

    if (activeLoopDragRef.current === "start") {
      onLoopBoundsChange(seconds, Math.max(seconds + minGap, loopEndSeconds));
    } else if (activeLoopDragRef.current === "end") {
      onLoopBoundsChange(Math.min(seconds - minGap, loopStartSeconds), seconds);
    }
  };

  const shiftLoopByDelta = (deltaSeconds: number) => {
    if (!duration || !onLoopBoundsChange) return;
    const loopDuration = Math.max(0.05, loopEndSeconds - loopStartSeconds);
    const maxStart = Math.max(0, duration - loopDuration);
    const nextStart = Math.min(Math.max(0, loopStartSeconds + deltaSeconds), maxStart);
    const nextEnd = nextStart + loopDuration;
    onLoopBoundsChange(nextStart, nextEnd);
  };

  const clampWindowStart = (nextStart: number, durationSeconds: number, zoomValue: number) => {
    const visualDuration = durationSeconds / Math.max(1, zoomValue);
    const maxWindowStart = Math.max(0, durationSeconds - visualDuration);
    return Math.min(Math.max(0, nextStart), maxWindowStart);
  };
  const regionDragScale = 0.05;

  const getCurrentSeconds = useCallback(() => {
    if (!duration) return 0;
    const baseOffset = offsetSeconds ?? 0;
    const elapsed =
      isPlaying && startedAtMs !== undefined
        ? (performance.now() - startedAtMs) / 1000
        : 0;
    let currentSeconds = Math.min(baseOffset + elapsed, duration);
    if (loopEnabled && loopEndSeconds > loopStartSeconds) {
      const loopDuration = loopEndSeconds - loopStartSeconds;
      const loopOffset = currentSeconds - loopStartSeconds;
      const wrapped = ((loopOffset % loopDuration) + loopDuration) % loopDuration;
      currentSeconds = loopStartSeconds + wrapped;
    }
    return currentSeconds;
  }, [
    duration,
    isPlaying,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    offsetSeconds,
    startedAtMs,
  ]);

  useEffect(() => {
    if (!buffer || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;

    const updateWindow = (startSeconds: number, width: number) => {
      let nextStart = startSeconds;
      if (duration && !activeLoopDragRef.current) {
        const visualDuration = duration / Math.max(1, zoom);
        const currentSeconds = getCurrentSeconds();
        nextStart = clampWindowStart(currentSeconds - visualDuration / 2, duration, zoom);
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
  }, [buffer, duration, getCurrentSeconds, renderOverlay, zoom]);


  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;

    const animate = () => {
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);

      if (buffer && duration) {
        const baseOffset = offsetSeconds ?? 0;
        const visualDuration = duration / Math.max(1, zoom);
        const elapsed =
          isPlaying && startedAtMs !== undefined
            ? (performance.now() - startedAtMs) / 1000
            : 0;
        const currentSeconds = Math.min(baseOffset + elapsed, duration);
        const maxWindowStart = Math.max(0, duration - visualDuration);
        let desiredWindowStart = windowStartRef.current;
        if (follow && !isDraggingRef.current) {
          if (loopEnabled && loopEndSeconds > loopStartSeconds) {
            const loopDuration = loopEndSeconds - loopStartSeconds;
            if (loopDuration > visualDuration) {
              desiredWindowStart = Math.min(loopStartSeconds, maxWindowStart);
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

    if (isPlaying && buffer && startedAtMs !== undefined && duration) {
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
    duration,
    follow,
    isPlaying,
    loopEnabled,
    loopEndSeconds,
    loopStartSeconds,
    offsetSeconds,
    renderOverlay,
    startedAtMs,
    zoom,
  ]);

  if (!buffer) {
    return <div className="deck__waveform deck__waveform--empty">Waveform / Spectrum</div>;
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
        const visualDuration = visualDurationRef.current || duration || 0;
        const windowStart = windowStartRef.current;
        const absoluteSeconds = windowStart + progress * visualDuration;
        const clampedProgress = duration ? absoluteSeconds / duration : progress;
        onSeek(clampedProgress);
      }}
      onPointerDown={(event) => {
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
              lastXRef.current = event.clientX;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!isDraggingRef.current || activeLoopDragRef.current !== "region") return;
              const rect = event.currentTarget.getBoundingClientRect();
              const width = rect.width || 1;
              const deltaX = event.clientX - lastXRef.current;
              lastXRef.current = event.clientX;
              const visualDuration = duration / Math.max(1, zoom);
              const deltaSeconds = (deltaX / width) * visualDuration * regionDragScale;
              shiftLoopByDelta(deltaSeconds);
              renderOverlay();
            }}
            onPointerUp={(event) => {
              if (activeLoopDragRef.current === "region") {
                activeLoopDragRef.current = null;
                isDraggingRef.current = false;
              }
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
              lastXRef.current = event.clientX;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!isDraggingRef.current || activeLoopDragRef.current !== "region") return;
              const rect = event.currentTarget.getBoundingClientRect();
              const width = rect.width || 1;
              const deltaX = event.clientX - lastXRef.current;
              lastXRef.current = event.clientX;
              const visualDuration = duration / Math.max(1, zoom);
              const deltaSeconds = (deltaX / width) * visualDuration;
              shiftLoopByDelta(deltaSeconds);
              renderOverlay();
            }}
              onPointerUp={(event) => {
                if (activeLoopDragRef.current === "region") {
                  activeLoopDragRef.current = null;
                  isDraggingRef.current = false;
                }
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

export default Waveform;
