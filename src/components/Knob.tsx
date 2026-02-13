import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

type KnobProps = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  formatValue?: (value: number, fine?: boolean) => string;
  centerSnap?: number;
  className?: string;
  ariaLabel?: string;
  labelTitle?: string;
  isAutomated?: boolean;
  isSimpleAutomated?: boolean;
  onSimpleAutomationSet?: (
    value: number,
    baseline: number,
    recording?: { samples: number[]; sampleRate: number; durationSec: number }
  ) => void;
  onSimpleAutomationClear?: () => void;
  disabled?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const SIMPLE_AUTOMATION_CAPTURE_RATE = 30;

const snap = (
  value: number,
  step: number,
  min: number,
  max: number,
  defaultValue: number,
  centerSnap?: number,
  enableCenterSnap = true
) => {
  if (!step || step <= 0) return clamp(value, min, max);
  const snapped = Math.round((value - min) / step) * step + min;
  const clamped = clamp(snapped, min, max);
  if (!enableCenterSnap) {
    return clamped;
  }
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
  labelTitle,
  isAutomated = false,
  isSimpleAutomated = false,
  onSimpleAutomationSet,
  onSimpleAutomationClear,
  disabled = false,
}: KnobProps) => {
  const knobRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ lastX: number; lastY: number; currentValue: number } | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const changeRafRef = useRef<number | null>(null);
  const clearedSimpleAutomationRef = useRef(false);
  const simpleAutomationArmRef = useRef(false);
  const simpleAutomationPendingValueRef = useRef<number | null>(null);
  const simpleAutomationBaselineRef = useRef<number | null>(null);
  const simpleAutomationCaptureRef = useRef<{
    startedAtMs: number;
    samples: number[];
  } | null>(null);
  const simpleAutomationCaptureIntervalRef = useRef<number | null>(null);
  const simpleAutomationCaptureValueRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fineMode, setFineMode] = useState(false);
  const range = max - min;
  const normalized = range > 0 ? clamp((value - min) / range, 0, 1) : 0;
  const angle = -135 + normalized * 270;
  const display = formatValue
    ? formatValue(value, fineMode)
    : value.toFixed(fineMode ? 3 : 1);
  const supportsSimpleAutomation = Boolean(onSimpleAutomationSet) && !disabled;

  const flushPendingChange = useCallback(() => {
    if (pendingValueRef.current === null) return;
    onChange(pendingValueRef.current);
    pendingValueRef.current = null;
  }, [onChange]);

  const scheduleChange = useCallback(
    (nextValue: number) => {
      pendingValueRef.current = nextValue;
      if (changeRafRef.current !== null) return;
      changeRafRef.current = requestAnimationFrame(() => {
        changeRafRef.current = null;
        flushPendingChange();
      });
    },
    [flushPendingChange]
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      const deltaX = event.clientX - drag.lastX;
      const deltaY = event.clientY - drag.lastY;
      const delta = deltaX - deltaY;
      const isFine = event.shiftKey;
      const sensitivity = isFine ? 0.0008 : 0.006;
      const next = drag.currentValue + delta * sensitivity * range;
      setFineMode(isFine);
      const effectiveStep = isFine ? step * 0.1 : step;
      const resolved = snap(next, effectiveStep, min, max, defaultValue, centerSnap, !isFine);
      drag.currentValue = resolved;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (!event.altKey && isSimpleAutomated && !clearedSimpleAutomationRef.current) {
        onSimpleAutomationClear?.();
        clearedSimpleAutomationRef.current = true;
      }
      scheduleChange(resolved);
      if (event.altKey) {
        simpleAutomationArmRef.current = true;
        simpleAutomationPendingValueRef.current = resolved;
        simpleAutomationCaptureValueRef.current = resolved;
      }
    };

    const handleUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      flushPendingChange();
      setDragging(false);
      setFineMode(false);
      if (
        simpleAutomationArmRef.current &&
        simpleAutomationPendingValueRef.current !== null
      ) {
        const baseline =
          simpleAutomationBaselineRef.current ?? clamp(defaultValue, min, max);
        const capture = simpleAutomationCaptureRef.current;
        const durationSec = capture
          ? Math.max(0.05, (performance.now() - capture.startedAtMs) / 1000)
          : 0;
        const recording =
          capture && capture.samples.length > 1
            ? {
                samples: capture.samples,
                sampleRate: SIMPLE_AUTOMATION_CAPTURE_RATE,
                durationSec,
              }
            : undefined;
        onSimpleAutomationSet?.(
          simpleAutomationPendingValueRef.current,
          baseline,
          recording
        );
      }
      simpleAutomationArmRef.current = false;
      simpleAutomationPendingValueRef.current = null;
      simpleAutomationBaselineRef.current = null;
      if (simpleAutomationCaptureIntervalRef.current !== null) {
        window.clearInterval(simpleAutomationCaptureIntervalRef.current);
        simpleAutomationCaptureIntervalRef.current = null;
      }
      simpleAutomationCaptureValueRef.current = null;
      simpleAutomationCaptureRef.current = null;
      clearedSimpleAutomationRef.current = false;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [
    centerSnap,
    defaultValue,
    max,
    min,
    onSimpleAutomationSet,
    onSimpleAutomationClear,
    isSimpleAutomated,
    range,
    scheduleChange,
    flushPendingChange,
    step,
  ]);

  useEffect(() => {
    return () => {
      if (changeRafRef.current !== null) {
        cancelAnimationFrame(changeRafRef.current);
      }
      if (simpleAutomationCaptureIntervalRef.current !== null) {
        window.clearInterval(simpleAutomationCaptureIntervalRef.current);
      }
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!knobRef.current) return;
    knobRef.current.setPointerCapture(event.pointerId);
    dragState.current = {
      lastX: event.clientX,
      lastY: event.clientY,
      currentValue: clamp(value, min, max),
    };
    clearedSimpleAutomationRef.current = false;
    simpleAutomationArmRef.current = false;
    simpleAutomationPendingValueRef.current = null;
    simpleAutomationBaselineRef.current = event.altKey
      ? clamp(value, min, max)
      : null;
    simpleAutomationCaptureRef.current = event.altKey
      ? {
          startedAtMs: performance.now(),
          samples: [clamp(value, min, max)],
        }
      : null;
    simpleAutomationCaptureValueRef.current = event.altKey
      ? clamp(value, min, max)
      : null;
    if (simpleAutomationCaptureIntervalRef.current !== null) {
      window.clearInterval(simpleAutomationCaptureIntervalRef.current);
      simpleAutomationCaptureIntervalRef.current = null;
    }
    if (event.altKey) {
      simpleAutomationCaptureIntervalRef.current = window.setInterval(() => {
        const capture = simpleAutomationCaptureRef.current;
        const nextValue = simpleAutomationCaptureValueRef.current;
        if (!capture || nextValue === null) return;
        capture.samples.push(nextValue);
      }, 1000 / SIMPLE_AUTOMATION_CAPTURE_RATE);
    }
    if (event.altKey && isSimpleAutomated) {
      onSimpleAutomationClear?.();
      clearedSimpleAutomationRef.current = true;
    }
    setDragging(true);
    setFineMode(event.shiftKey);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const fine = event.shiftKey ? step * 0.1 : step * 5;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setFineMode(event.shiftKey);
      if (isSimpleAutomated) {
        onSimpleAutomationClear?.();
      }
      onChange(
        snap(value + fine, fine, min, max, defaultValue, centerSnap, !event.shiftKey)
      );
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setFineMode(event.shiftKey);
      if (isSimpleAutomated) {
        onSimpleAutomationClear?.();
      }
      onChange(
        snap(value - fine, fine, min, max, defaultValue, centerSnap, !event.shiftKey)
      );
    }
  };

  const handleKeyUp = () => {
    if (disabled) return;
    setFineMode(false);
  };

  return (
    <div
      className={`knob ${isAutomated ? "is-automated" : ""} ${isSimpleAutomated ? "is-simple-automated" : ""} ${supportsSimpleAutomation ? "is-simple-automation-capable" : ""} ${disabled ? "is-disabled" : ""} ${className ?? ""}`.trim()}
    >
      <div className="knob__label" title={labelTitle}>{label}</div>
      <div
        ref={knobRef}
        className={`knob__control ${dragging ? "is-dragging" : ""}`}
        role="slider"
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onDoubleClick={(event) => {
          if (disabled) return;
          if (onSimpleAutomationClear && event.altKey) {
            onSimpleAutomationClear();
            return;
          }
          dragState.current = null;
          setDragging(false);
          setFineMode(false);
          if (isSimpleAutomated) {
            onSimpleAutomationClear?.();
          }
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
