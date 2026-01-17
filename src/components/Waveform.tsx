import { useCallback, useEffect, useRef } from "react";

type WaveformProps = {
  buffer?: AudioBuffer;
  isPlaying?: boolean;
  startedAtMs?: number;
  duration?: number;
  offsetSeconds?: number;
  zoom?: number;
  follow?: boolean;
  onSeek?: (progress: number) => void;
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
  onSeek,
}: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const peaksRef = useRef<Array<{ min: number; max: number }>>([]);
  const windowStartRef = useRef(0);
  const visualDurationRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const dragMovedRef = useRef(false);
  const velocityRef = useRef(0);
  const inertiaRef = useRef<number | null>(null);

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
    const currentSeconds = Math.min(baseOffset + elapsed, duration);
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
  }, [buffer, duration, isPlaying, offsetSeconds, startedAtMs, zoom]);

  const clampWindowStart = (nextStart: number, durationSeconds: number, zoomValue: number) => {
    const visualDuration = durationSeconds / Math.max(1, zoomValue);
    const maxWindowStart = Math.max(0, durationSeconds - visualDuration);
    return Math.min(Math.max(0, nextStart), maxWindowStart);
  };

  useEffect(() => {
    if (!buffer || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;

    const updateWindow = (startSeconds: number, width: number) => {
      windowStartRef.current = startSeconds;
      peaksRef.current = buildPeaks(buffer, width, zoom, startSeconds);
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
  }, [buffer, renderOverlay, zoom]);

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
        const needsShift =
          follow &&
          !isDraggingRef.current &&
          currentSeconds - windowStartRef.current > visualDuration &&
          windowStartRef.current < maxWindowStart;
        const desiredWindowStart = needsShift
          ? Math.min(currentSeconds, maxWindowStart)
          : windowStartRef.current;

        if (desiredWindowStart !== windowStartRef.current && canvasRef.current) {
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
  }, [buffer, duration, follow, isPlaying, offsetSeconds, renderOverlay, startedAtMs, zoom]);

  if (!buffer) {
    return <div className="deck__waveform deck__waveform--empty">Waveform / Spectrum</div>;
  }

  return (
    <div
      className="deck__waveform deck__waveform--interactive"
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
      }}
    >
      <canvas ref={canvasRef} />
      <canvas ref={overlayRef} className="deck__waveform-overlay" />
    </div>
  );
};

export default Waveform;
