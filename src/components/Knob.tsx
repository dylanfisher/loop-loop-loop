import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

type KnobProps = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  centerSnap?: number;
  className?: string;
  ariaLabel?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const snap = (
  value: number,
  step: number,
  min: number,
  max: number,
  defaultValue: number,
  centerSnap?: number
) => {
  if (!step || step <= 0) return clamp(value, min, max);
  const snapped = Math.round((value - min) / step) * step + min;
  const clamped = clamp(snapped, min, max);
  const snapTarget = clamp(defaultValue, min, max);
  const tolerance = centerSnap ?? step;
  if (Math.abs(clamped - snapTarget) <= tolerance) {
    return snapTarget;
  }
  return clamped;
};

const Knob = ({
  label,
  min,
  max,
  step = 0.01,
  value,
  defaultValue,
  onChange,
  formatValue,
  centerSnap,
  className,
  ariaLabel,
}: KnobProps) => {
  const knobRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fineMode, setFineMode] = useState(false);
  const range = max - min;
  const normalized = range > 0 ? clamp((value - min) / range, 0, 1) : 0;
  const angle = -135 + normalized * 270;
  const display = formatValue ? formatValue(value) : value.toFixed(2);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!dragState.current) return;
      const deltaX = event.clientX - dragState.current.startX;
      const deltaY = event.clientY - dragState.current.startY;
      const delta = deltaX - deltaY;
      const isFine = event.shiftKey;
      const sensitivity = isFine ? 0.002 : 0.006;
      const next = dragState.current.startValue + delta * sensitivity * range;
      setFineMode(isFine);
      onChange(snap(next, step, min, max, defaultValue, centerSnap));
    };

    const handleUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      setDragging(false);
      setFineMode(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [centerSnap, defaultValue, max, min, onChange, range, step]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!knobRef.current) return;
    knobRef.current.setPointerCapture(event.pointerId);
    dragState.current = { startX: event.clientX, startY: event.clientY, startValue: value };
    setDragging(true);
    setFineMode(event.shiftKey);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const fine = event.shiftKey ? step : step * 5;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setFineMode(event.shiftKey);
      onChange(snap(value + fine, step, min, max, defaultValue, centerSnap));
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setFineMode(event.shiftKey);
      onChange(snap(value - fine, step, min, max, defaultValue, centerSnap));
    }
  };

  const handleKeyUp = () => {
    setFineMode(false);
  };

  return (
    <div className={`knob ${className ?? ""}`.trim()}>
      <div className="knob__label">{label}</div>
      <div
        ref={knobRef}
        className={`knob__control ${dragging ? "is-dragging" : ""}`}
        role="slider"
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onDoubleClick={() => {
          dragState.current = null;
          setDragging(false);
          setFineMode(false);
          onChange(clamp(defaultValue, min, max));
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        <svg className="knob__dial" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="knob__ring" cx="50" cy="50" r="38" />
          <line
            className="knob__indicator"
            x1="50"
            y1="50"
            x2="50"
            y2="16"
            transform={`rotate(${angle} 50 50)`}
          />
        </svg>
      </div>
      <div className="knob__value">
        {display}
        {fineMode ? <span className="knob__fine">Fine</span> : null}
      </div>
    </div>
  );
};

export default Knob;
