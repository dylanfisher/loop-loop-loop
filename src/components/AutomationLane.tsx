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
  getPlayhead: () => number;
  onDrawStart: () => void;
  onDrawEnd: () => void;
  onReset: () => void;
  onToggleActive: (active: boolean) => void;
  onDrawValueChange: (value: number) => void;
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
  getPlayhead,
  onDrawStart,
  onDrawEnd,
  onReset,
  onToggleActive,
  onDrawValueChange,
  disabled = false,
}: AutomationLaneProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const getPlayheadRef = useRef(getPlayhead);
  const [liveValue, setLiveValue] = useState<number | null>(null);

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

      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

      const activeSamples = recording && previewSamples.length > 1 ? previewSamples : samples;
      if (activeSamples.length > 1) {
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < activeSamples.length; i += 1) {
          const t = i / (activeSamples.length - 1);
          const sample = activeSamples[i];
          const normalized = (sample - min) / (max - min);
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
  }, [max, min, previewSamples, recording, samples]);

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
      setLiveValue(next);
      onDrawValueChange(next);
    },
    [disabled, max, min, onDrawValueChange]
  );

  const handleDrawEnd = useCallback(() => {
    if (disabled) return;
    setLiveValue(null);
    onDrawEnd();
  }, [disabled, onDrawEnd]);

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
            className={`automation-lane__toggle ${active ? "is-active" : ""}`}
            onClick={() => onToggleActive(!active)}
            disabled={disabled}
          >
            {active ? "Active" : "Bypass"}
          </button>
          <button
            type="button"
            className="automation-lane__reset"
            onClick={onReset}
            disabled={disabled}
          >
            Reset
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
      <div className="automation-lane__value">
        {recording
          ? (liveValue ?? value).toFixed(2)
          : active
            ? `${durationSec.toFixed(2)}s`
            : "—"}
      </div>
    </div>
  );
};

export default AutomationLane;
