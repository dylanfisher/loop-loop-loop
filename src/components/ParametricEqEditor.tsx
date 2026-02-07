import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ParametricEqBand, ParametricEqBandType } from "../types/deck";
import { defaultParametricEqBands } from "../audio/effects/parametricEq";

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN = -18;
const MAX_GAIN = 18;
const MIN_Q = 0.15;
const MAX_Q = 20;
const MAX_BANDS = 12;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 320;

type ParametricEqEditorProps = {
  bands: ParametricEqBand[];
  disabled?: boolean;
  onChange: (bands: ParametricEqBand[]) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const freqToX = (freq: number, width: number) => {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const clamped = clamp(freq, MIN_FREQ, MAX_FREQ);
  return ((Math.log10(clamped) - minLog) / (maxLog - minLog)) * width;
};

const xToFreq = (x: number, width: number) => {
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const t = clamp(x / Math.max(1, width), 0, 1);
  return Math.pow(10, minLog + t * (maxLog - minLog));
};

const gainToY = (gain: number) => {
  const t = (clamp(gain, MIN_GAIN, MAX_GAIN) - MIN_GAIN) / (MAX_GAIN - MIN_GAIN);
  return (1 - t) * VIEWBOX_HEIGHT;
};

const yToGain = (y: number) => {
  const t = 1 - clamp(y / VIEWBOX_HEIGHT, 0, 1);
  return MIN_GAIN + t * (MAX_GAIN - MIN_GAIN);
};
const defaultQForType = (type: ParametricEqBandType) =>
  type === "peaking" ? 1.2 : 0.8;
type ParametricMotionPreset = "sweep";
const cloneBands = (input: ParametricEqBand[]) => input.map((band) => ({ ...band }));
const clampCycleSeconds = (value: number) => clamp(value, 0.25, 60);

const createBandId = () => `peq-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const sortedBands = (bands: ParametricEqBand[]) => [...bands].sort((a, b) => a.frequency - b.frequency);

const ParametricEqEditor = ({ bands, disabled = false, onChange }: ParametricEqEditorProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [graphWidth, setGraphWidth] = useState(VIEWBOX_WIDTH);
  const [motionPreset, setMotionPreset] = useState<ParametricMotionPreset | null>(null);
  const [motionCycleSec, setMotionCycleSec] = useState(4);
  const dragBandIdRef = useRef<string | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointerDownBandIdRef = useRef<string | null>(null);
  const lastNodeTapRef = useRef<{ bandId: string | null; atMs: number }>({
    bandId: null,
    atMs: 0,
  });
  const nodeDragMovedRef = useRef(false);
  const nodeDragStartXRef = useRef(0);
  const nodeDragStartYRef = useRef(0);
  const [selectedBandId, setSelectedBandId] = useState<string | null>(bands[0]?.id ?? null);
  const motionBaseBandsRef = useRef<ParametricEqBand[] | null>(null);
  const motionStartMsRef = useRef<number>(0);
  useLayoutEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;
    const updateWidth = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextWidth = Math.max(1, (rect.width / rect.height) * VIEWBOX_HEIGHT);
      setGraphWidth((prev) => (Math.abs(prev - nextWidth) > 0.5 ? nextWidth : prev));
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const resolvedSelectedBandId =
    selectedBandId && bands.some((band) => band.id === selectedBandId)
      ? selectedBandId
      : bands[0]?.id ?? null;

  const selectedBand = useMemo(
    () => bands.find((band) => band.id === resolvedSelectedBandId) ?? null,
    [bands, resolvedSelectedBandId]
  );
  const motionRunning = motionPreset !== null;

  const updateBand = (id: string, updates: Partial<ParametricEqBand>) => {
    onChange(
      bands.map((band) =>
        band.id === id
          ? {
              ...band,
              ...updates,
              frequency:
                updates.frequency === undefined
                  ? band.frequency
                  : clamp(updates.frequency, MIN_FREQ, MAX_FREQ),
              gain:
                updates.gain === undefined ? band.gain : clamp(updates.gain, MIN_GAIN, MAX_GAIN),
              q: updates.q === undefined ? band.q : clamp(updates.q, MIN_Q, MAX_Q),
            }
          : band
      )
    );
  };

  const removeBand = (id: string) => {
    const next = bands.filter((band) => band.id !== id);
    onChange(next);
    if (resolvedSelectedBandId === id) {
      setSelectedBandId(next[0]?.id ?? null);
    }
  };

  const resetBands = () => {
    setMotionPreset(null);
    motionBaseBandsRef.current = null;
    const next = defaultParametricEqBands();
    onChange(next);
    setSelectedBandId(next[0]?.id ?? null);
  };
  const startMotionPreset = (preset: ParametricMotionPreset, startedAtMs: number) => {
    if (motionPreset === preset) {
      stopMotionPreset();
      return;
    }
    motionBaseBandsRef.current = cloneBands(bands);
    motionStartMsRef.current = startedAtMs;
    setMotionPreset(preset);
  };
  const stopMotionPreset = () => {
    setMotionPreset(null);
  };
  useEffect(() => {
    if (!motionPreset) return undefined;
    if (!motionBaseBandsRef.current || motionBaseBandsRef.current.length === 0) {
      motionBaseBandsRef.current = cloneBands(bands);
    }
    const intervalId = window.setInterval(() => {
      const baseBands = motionBaseBandsRef.current;
      if (!baseBands || baseBands.length === 0) return;
      const phase =
        ((performance.now() - motionStartMsRef.current) / 1000 / clampCycleSeconds(motionCycleSec)) %
        1;
      const sine = Math.sin(phase * Math.PI * 2);
      const normalizedSine = (sine + 1) * 0.5;
      const nextBands = cloneBands(baseBands);
      if (motionPreset === "sweep") {
        const targetId = resolvedSelectedBandId ?? nextBands[0]?.id;
        const index = nextBands.findIndex((band) => band.id === targetId);
        if (index >= 0) {
          const current = nextBands[index];
          const octaveSpan = 4;
          const ratio = Math.pow(2, (normalizedSine * 2 - 1) * octaveSpan);
          current.frequency = clamp(current.frequency * ratio, MIN_FREQ, MAX_FREQ);
        }
      }
      onChange(nextBands);
    }, 1000 / 30);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [bands, motionCycleSec, motionPreset, onChange, resolvedSelectedBandId]);

  const addBandAtPoint = (x: number, y: number) => {
    if (bands.length >= MAX_BANDS) return null;
    const band: ParametricEqBand = {
      id: createBandId(),
      type: "peaking",
      enabled: true,
      frequency: xToFreq(x, graphWidth),
      gain: yToGain(y),
      q: 1.2,
    };
    const next = sortedBands([...bands, band]);
    onChange(next);
    setSelectedBandId(band.id);
    return band;
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * graphWidth,
      y: ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT,
    };
  };

  const handleSvgPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as HTMLElement;
    if (target.dataset.bandId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const created = addBandAtPoint(point.x, point.y);
    if (!created) return;
    dragBandIdRef.current = created.id;
    pointerIdRef.current = event.pointerId;
    pointerDownBandIdRef.current = created.id;
    nodeDragMovedRef.current = false;
    nodeDragStartXRef.current = event.clientX;
    nodeDragStartYRef.current = event.clientY;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleBandPointerDown = (
    event: ReactPointerEvent<SVGCircleElement>,
    bandId: string
  ) => {
    event.stopPropagation();
    dragBandIdRef.current = bandId;
    pointerIdRef.current = event.pointerId;
    pointerDownBandIdRef.current = bandId;
    nodeDragMovedRef.current = false;
    nodeDragStartXRef.current = event.clientX;
    nodeDragStartYRef.current = event.clientY;
    setSelectedBandId(bandId);
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointerIdRef.current === null || pointerIdRef.current !== event.pointerId) return;
    if (!dragBandIdRef.current) return;
    if (
      !nodeDragMovedRef.current &&
      (Math.abs(event.clientX - nodeDragStartXRef.current) > 2 ||
        Math.abs(event.clientY - nodeDragStartYRef.current) > 2)
    ) {
      nodeDragMovedRef.current = true;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    updateBand(dragBandIdRef.current, {
      frequency: xToFreq(point.x, graphWidth),
      gain: yToGain(point.y),
      enabled: true,
    });
  };

  const handleSvgPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const activeBandId = pointerDownBandIdRef.current;
    if (pointerIdRef.current !== null && pointerIdRef.current === event.pointerId) {
      if (activeBandId && !nodeDragMovedRef.current) {
        if (event.shiftKey) {
          removeBand(activeBandId);
        } else {
          const now = event.timeStamp;
          const lastTap = lastNodeTapRef.current;
          if (lastTap.bandId === activeBandId && now - lastTap.atMs < 280) {
            const band = bands.find((item) => item.id === activeBandId);
            if (band) {
              updateBand(activeBandId, { enabled: !band.enabled });
            }
            lastNodeTapRef.current = { bandId: null, atMs: 0 };
          } else {
            lastNodeTapRef.current = { bandId: activeBandId, atMs: now };
          }
        }
      }
      pointerIdRef.current = null;
      dragBandIdRef.current = null;
      pointerDownBandIdRef.current = null;
      nodeDragMovedRef.current = false;
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const sorted = useMemo(() => sortedBands(bands), [bands]);
  const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const gridGains = [-18, -12, -6, 0, 6, 12, 18];

  return (
    <div className={`peq ${disabled ? "is-disabled" : ""}`.trim()}>
      <svg
        ref={svgRef}
        className="peq__graph"
        viewBox={`0 0 ${graphWidth} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Parametric EQ graph. Click to add a node and drag to change frequency and gain."
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        onPointerCancel={handleSvgPointerUp}
      >
        <rect x={0} y={0} width={graphWidth} height={VIEWBOX_HEIGHT} className="peq__bg" />
        {gridFreqs.map((freq) => {
          const x = freqToX(freq, graphWidth);
          return <line key={`f-${freq}`} x1={x} y1={0} x2={x} y2={VIEWBOX_HEIGHT} className="peq__grid" />;
        })}
        {gridGains.map((gain) => {
          const y = gainToY(gain);
          return (
            <line
              key={`g-${gain}`}
              x1={0}
              y1={y}
              x2={graphWidth}
              y2={y}
              className={`peq__grid ${gain === 0 ? "peq__grid--zero" : ""}`.trim()}
            />
          );
        })}
        <polyline
          points={sorted
            .map((band) => `${freqToX(band.frequency, graphWidth)},${gainToY(band.gain)}`)
            .join(" ")}
          className="peq__curve"
        />
        {sorted.map((band) => (
          <circle
            key={band.id}
            data-band-id={band.id}
            className={`peq__node ${resolvedSelectedBandId === band.id ? "is-selected" : ""} ${band.enabled ? "" : "is-muted"}`.trim()}
            cx={freqToX(band.frequency, graphWidth)}
            cy={gainToY(band.gain)}
            r={resolvedSelectedBandId === band.id ? 12 : 9}
            onPointerDown={(event) => handleBandPointerDown(event, band.id)}
          />
        ))}
      </svg>
      <div className="peq__toolbar">
        <span className="peq__hint">
          Click graph to add node. Drag node for freq/gain. Double-click node to bypass. Shift+click node to remove.
        </span>
          <button
            type="button"
            className="deck__action"
            disabled={bands.length >= MAX_BANDS}
            onClick={() => {
              addBandAtPoint(graphWidth * 0.5, VIEWBOX_HEIGHT * 0.5);
            }}
          >
            Add Node
          </button>
      </div>
      <div className="peq__motion-tools">
        <div className="peq__motion-presets">
          <button
            type="button"
            className={`automation-lane__tool ${motionPreset === "sweep" ? "is-active" : ""}`.trim()}
            onClick={(event) => startMotionPreset("sweep", event.timeStamp)}
          >
            Sweep
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            onClick={stopMotionPreset}
            disabled={!motionRunning}
          >
            Stop
          </button>
        </div>
        <div className="peq__motion-length">
          <button
            type="button"
            className="automation-lane__tool"
            onClick={() => setMotionCycleSec((value) => clampCycleSeconds(value * 0.5))}
          >
            1/2
          </button>
          <button
            type="button"
            className="automation-lane__tool"
            onClick={() => setMotionCycleSec((value) => clampCycleSeconds(value * 2))}
          >
            2x
          </button>
          <span className="peq__motion-value">{motionCycleSec.toFixed(2)}s</span>
        </div>
      </div>
      {selectedBand ? (
        <div className="peq__inspector">
          <label>
            Type
            <select
              value={selectedBand.type}
              onChange={(event) =>
                updateBand(selectedBand.id, { type: event.target.value as ParametricEqBandType })
              }
            >
              <option value="lowshelf">Low Shelf</option>
              <option value="peaking">Bell</option>
              <option value="highshelf">High Shelf</option>
            </select>
          </label>
          <label>
            Q
            <input
              type="range"
              min={MIN_Q}
              max={MAX_Q}
              step={0.01}
              value={selectedBand.q}
              onDoubleClick={() => {
                updateBand(selectedBand.id, { q: defaultQForType(selectedBand.type) });
              }}
              onChange={(event) => updateBand(selectedBand.id, { q: Number(event.target.value) })}
            />
          </label>
          <label className="peq__toggle">
            <input
              type="checkbox"
              checked={selectedBand.enabled}
              onChange={(event) => updateBand(selectedBand.id, { enabled: event.target.checked })}
            />
            Enabled
          </label>
          <button
            type="button"
            className="deck__action"
            onClick={() => removeBand(selectedBand.id)}
          >
            Remove
          </button>
          <button
            type="button"
            className="deck__action"
            onClick={resetBands}
          >
            Reset
          </button>
          <button
            type="button"
            className="deck__action"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="peq__inspector peq__inspector--empty">No EQ nodes yet.</div>
      )}
    </div>
  );
};

export default ParametricEqEditor;
