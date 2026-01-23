import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type AutomationLaneProps = {
  label: string;
  min: number;
  max: number;
  value: number;
  samples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  getPlayhead: () => number;
  onDrawStart: () => void;
  onDrawEnd: () => void;
  onReset: () => void;
  onToggleActive: (active: boolean) => void;
  onDrawValueChange: (value: number) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const AutomationLane = ({
  label,
  min,
  max,
  value,
  samples,
  durationSec,
  recording,
  active,
  getPlayhead,
  onDrawStart,
  onDrawEnd,
  onReset,
  onToggleActive,
  onDrawValueChange,
}: AutomationLaneProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const parent = canvas.parentElement;
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

      if (samples.length > 1) {
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < samples.length; i += 1) {
          const t = i / (samples.length - 1);
          const sample = samples[i];
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

      if (active && durationSec > 0) {
        const playhead = clamp(getPlayhead(), 0, 1);
        const x = playhead * width;
        ctx.strokeStyle = "#0074FF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      if (recording) {
        ctx.fillStyle = "rgba(0, 116, 255, 0.15)";
        ctx.fillRect(0, 0, width, height);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, durationSec, getPlayhead, max, min, recording, samples]);

  const setValueFromPointer = useCallback(
    (event: PointerEvent | ReactPointerEvent<HTMLDivElement>) => {
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clampedY = clamp(event.clientY - rect.top, 0, rect.height);
      const normalized = 1 - clampedY / rect.height;
      const next = min + normalized * (max - min);
      onDrawValueChange(next);
    },
    [max, min, onDrawValueChange]
  );

  useEffect(() => {
    if (!recording) return;
    const handleMove = (event: PointerEvent) => {
      setValueFromPointer(event);
    };
    const handleUp = () => {
      onDrawEnd();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [onDrawEnd, recording, setValueFromPointer]);

  return (
    <div className="automation-lane">
      <div className="automation-lane__header">
        <span>{label}</span>
        <div className="automation-lane__actions">
          <button
            type="button"
            className={`automation-lane__toggle ${active ? "is-active" : ""}`}
            onClick={() => onToggleActive(!active)}
          >
            {active ? "Active" : "Bypass"}
          </button>
          <button type="button" className="automation-lane__reset" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
      <div
        ref={laneRef}
        className="automation-lane__canvas"
        onPointerDown={(event) => {
          onDrawStart();
          setValueFromPointer(event);
        }}
      >
        <canvas ref={canvasRef} width={220} height={70} />
      </div>
      <div className="automation-lane__value">
        {recording ? value.toFixed(2) : active ? `${durationSec.toFixed(2)}s` : "—"}
      </div>
    </div>
  );
};

export default AutomationLane;
