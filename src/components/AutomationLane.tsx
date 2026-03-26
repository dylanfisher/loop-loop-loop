import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type AutomationLaneProps = {
  label: string;
  min: number;
  max: number;
  value: number;
  samples: Float32Array;
  previewSamples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  amplitudeScale: number;
  getPlayhead: () => number;
  onDrawStart: () => void;
  onDrawEnd: () => void;
  onReset: () => void;
  onToggleActive: (active: boolean) => void;
  onDrawValueChange: (value: number) => void;
  onPreset: (preset: "sine" | "triangle" | "ramp") => void;
  onInvert: () => void;
  onLengthScale: (factor: number) => void;
  onAmplitudeScale: (factor: number) => void;
  onDurationChange: (durationSec: number) => void;
  disabled?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const AutomationLane = ({
  label,
  min,
  max,
  value,
  samples,
  previewSamples,
  durationSec,
  recording,
  active,
  amplitudeScale,
  getPlayhead,
  onDrawStart,
  onDrawEnd,
  onReset,
  onToggleActive,
  onDrawValueChange,
  onPreset,
  onInvert,
  onLengthScale,
  onAmplitudeScale,
  onDurationChange,
  disabled = false,
}: AutomationLaneProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const getPlayheadRef = useRef(getPlayhead);
  const [liveValue, setLiveValue] = useState<number | null>(null);
  const dragStateRef = useRef<{ startY: number; startDuration: number } | null>(null);
  const lastDrawValueRef = useRef<number | null>(null);
  const lastDurationValueRef = useRef<number | null>(null);
  const [liveDuration, setLiveDuration] = useState<number | null>(null);
  const [themeToken, setThemeToken] = useState(0);

  useEffect(() => {
    const handleThemeChange = () => setThemeToken((prev) => prev + 1);
    window.addEventListener("themechange", handleThemeChange);
    return () => window.removeEventListener("themechange", handleThemeChange);
  }, []);

  useEffect(() => {
    getPlayheadRef.current = getPlayhead;
  }, [getPlayhead]);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const parent = laneRef.current ?? canvas.parentElement;
      const nextWidth = parent ? parent.clientWidth : canvas.width;
      const nextHeight = parent ? parent.clientHeight : canvas.height;
      if (canvas.width !== nextWidth) {
        canvas.width = nextWidth;
      }
      if (canvas.height !== nextHeight) {
        canvas.height = nextHeight;
      }
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const styles = getComputedStyle(document.body);
      const canvasBg = styles.getPropertyValue("--canvas-bg").trim() || "#f8fafc";
      const canvasInk = styles.getPropertyValue("--canvas-ink").trim() || "#111";
      ctx.fillStyle = canvasBg;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = canvasInk;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

      const activeSamples = recording && previewSamples.length > 1 ? previewSamples : samples;
      if (activeSamples.length > 1) {
        ctx.strokeStyle = canvasInk;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < activeSamples.length; i += 1) {
          const t = i / (activeSamples.length - 1);
          const sample = activeSamples[i];
          const raw = (sample - min) / (max - min);
          const normalized = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0;
          const x = t * width;
          const y = height - normalized * height;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      if (recording) {
        ctx.fillStyle = "rgba(0, 116, 255, 0.15)";
        ctx.fillRect(0, 0, width, height);
      }
    };

    draw();
    if (!laneRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(laneRef.current);
    return () => {
      observer.disconnect();
    };
  }, [max, min, previewSamples, recording, samples, themeToken]);

  useEffect(() => {
    const playheadEl = playheadRef.current;
    if (!playheadEl) return;
    if (!active || durationSec <= 0) {
      playheadEl.style.opacity = "0";
      playheadEl.style.transform = "translateX(0)";
      return;
    }
    playheadEl.style.opacity = "1";
    const intervalId = window.setInterval(() => {
      const lane = laneRef.current;
      if (!lane) return;
      const width = lane.clientWidth;
      const playhead = clamp(getPlayheadRef.current(), 0, 1);
      playheadEl.style.transform = `translateX(${playhead * width}px)`;
    }, 1000 / 30);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, durationSec]);

  const setValueFromPointer = useCallback(
    (event: PointerEvent | ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clampedY = clamp(event.clientY - rect.top, 0, rect.height);
      const normalized = 1 - clampedY / rect.height;
      const next = min + normalized * (max - min);
      if (lastDrawValueRef.current !== null && Math.abs(lastDrawValueRef.current - next) < 1e-4) {
        return;
      }
      lastDrawValueRef.current = next;
      setLiveValue((prev) => (prev !== null && Math.abs(prev - next) < 1e-4 ? prev : next));
      onDrawValueChange(next);
    },
    [disabled, max, min, onDrawValueChange]
  );

  const handleDrawEnd = useCallback(() => {
    if (disabled) return;
    setLiveValue(null);
    lastDrawValueRef.current = null;
    onDrawEnd();
  }, [disabled, onDrawEnd]);

  const handleDurationPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      dragStateRef.current = {
        startY: event.clientY,
        startDuration: durationSec || 1,
      };
      setLiveDuration(durationSec || 1);
    },
    [disabled, durationSec]
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const deltaY = dragStateRef.current.startY - event.clientY;
      const next = dragStateRef.current.startDuration + deltaY * 0.02;
      const clamped = clamp(next, 0.25, 60);
      if (lastDurationValueRef.current !== null && Math.abs(lastDurationValueRef.current - clamped) < 1e-4) {
        return;
      }
      lastDurationValueRef.current = clamped;
      setLiveDuration((prev) => (prev !== null && Math.abs(prev - clamped) < 1e-4 ? prev : clamped));
      onDurationChange(clamped);
    };
    const handleUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      lastDurationValueRef.current = null;
      setLiveDuration(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [onDurationChange]);

  useEffect(() => {
    if (!recording || disabled) return;
    const handleMove = (event: PointerEvent) => {
      setValueFromPointer(event);
    };
    const handleUp = () => {
      handleDrawEnd();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [disabled, handleDrawEnd, recording, setValueFromPointer]);

  return (
    <div className={`automation-lane ${disabled ? "is-disabled" : ""}`}>
      <div className="automation-lane__header">
        <span>{label}</span>
        <div className="automation-lane__actions">
          <button
            type="button"
            className={`automation-lane__toggle button--small ${active ? "is-active" : ""}`}
            onClick={() => onToggleActive(!active)}
            disabled={disabled}
          >
            {active ? "Active" : "Bypass"}
          </button>
          <button
            type="button"
            className="automation-lane__reset button--small"
            onClick={onReset}
            disabled={disabled}
          >
            Reset
          </button>
          <button
            type="button"
            className="automation-lane__reset button--small"
            onClick={onInvert}
            disabled={disabled}
            title="Invert automation around center"
          >
            Inv
          </button>
        </div>
      </div>
      <div
        ref={laneRef}
        className="automation-lane__canvas"
        onPointerDown={(event) => {
          if (disabled) return;
          onDrawStart();
          setValueFromPointer(event);
        }}
      >
        <canvas ref={canvasRef} width={220} height={70} />
        <div ref={playheadRef} className="automation-lane__playhead" />
      </div>
      <div className="automation-lane__tools">
        <div className="automation-lane__preset-tools">
          <button
            type="button"
            className="automation-lane__tool"
            title="Preset: Sine wave"
            onClick={() => onPreset("sine")}
            disabled={disabled}
          >
            Sin
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            title="Preset: Triangle wave"
            onClick={() => onPreset("triangle")}
            disabled={disabled}
          >
            Tri
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            title="Preset: Ramp up"
            onClick={() => onPreset("ramp")}
            disabled={disabled}
          >
            Ramp
          </button>
        </div>
        <div className="automation-lane__length-tools">
          <button
            type="button"
            className="automation-lane__tool"
            title="Half automation length"
            onClick={() => onLengthScale(0.5)}
            disabled={disabled}
          >
            1/2
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            title="Double automation length"
            onClick={() => onLengthScale(2)}
            disabled={disabled}
          >
            2x
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            title="Half automation amplitude"
            onClick={() => onAmplitudeScale(0.5)}
            disabled={disabled || amplitudeScale <= 1 / 3}
          >
            1/2 Y
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            title="Double automation amplitude"
            onClick={() => onAmplitudeScale(2)}
            disabled={disabled || amplitudeScale >= 1}
          >
            2x Y
          </button>
        </div>
      </div>
      <div
        className="automation-lane__value"
        onPointerDown={handleDurationPointerDown}
      >
        {recording
          ? (liveValue ?? value).toFixed(2)
          : active
            ? `${(liveDuration ?? durationSec).toFixed(2)}s`
            : "—"}
      </div>
    </div>
  );
};

export default AutomationLane;
