import { useEffect, useRef } from "react";

type WaveformProps = {
  buffer?: AudioBuffer;
  isPlaying?: boolean;
  startedAtMs?: number;
  duration?: number;
  offsetSeconds?: number;
  onSeek?: (progress: number) => void;
};

const buildPeaks = (buffer: AudioBuffer, width: number) => {
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const peaks: Array<{ min: number; max: number }> = [];

  for (let i = 0; i < width; i += 1) {
    let min = 1;
    let max = -1;
    const start = i * step;
    const end = Math.min(start + step, data.length);
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
  onSeek,
}: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const peaksRef = useRef<Array<{ min: number; max: number }>>([]);

  useEffect(() => {
    if (!buffer || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;

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
      peaksRef.current = buildPeaks(buffer, Math.max(1, Math.floor(clientWidth)));
      drawWaveform(canvas, peaksRef.current, "#111111");
    };

    const observer = new ResizeObserver(resize);
    const parentElement = canvas.parentElement;
    if (parentElement) {
      observer.observe(parentElement);
    }
    resize();

    return () => observer.disconnect();
  }, [buffer]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;

    const animate = () => {
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);

      if (buffer && duration) {
        const baseOffset = offsetSeconds ?? 0;
        const elapsed =
          isPlaying && startedAtMs !== undefined
            ? (performance.now() - startedAtMs) / 1000
            : 0;
        const progress = Math.min((baseOffset + elapsed) / duration, 1);
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
  }, [buffer, duration, isPlaying, offsetSeconds, startedAtMs]);

  if (!buffer) {
    return <div className="deck__waveform deck__waveform--empty">Waveform / Spectrum</div>;
  }

  return (
    <div
      className="deck__waveform deck__waveform--interactive"
      onClick={(event) => {
        if (!onSeek) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width) return;
        const progress = (event.clientX - rect.left) / rect.width;
        onSeek(progress);
      }}
    >
      <canvas ref={canvasRef} />
      <canvas ref={overlayRef} className="deck__waveform-overlay" />
    </div>
  );
};

export default Waveform;
