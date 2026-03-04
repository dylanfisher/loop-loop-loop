import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ParametricEqBand,
  ParametricEqBandType,
  ParametricEqBandWander,
} from "../types/deck";
import { defaultParametricEqBands } from "../audio/effects/parametricEq";
import Knob from "./Knob";

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN = -18;
const MAX_GAIN = 18;
const MIN_Q = 0.15;
const MAX_Q = 20;
const MAX_BANDS = 12;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 320;
const JITTER_DEBOUNCE_MS = 90;
const SPREAD_DEBOUNCE_MS = 90;

type ParametricEqEditorProps = {
  bands: ParametricEqBand[];
  playbackActive?: boolean;
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
const clampUnit = (value: number) => clamp(value, 0, 1);
const ensureWander = (band: ParametricEqBand): ParametricEqBandWander => ({
  jitter: clampUnit(band.wander?.jitter ?? 0),
  spread: clampUnit(band.wander?.spread ?? 0),
  seed: Number.isFinite(band.wander?.seed) ? Number(band.wander?.seed) : Math.random() * Math.PI * 2,
  baseFrequency: clamp(
    Number.isFinite(band.wander?.baseFrequency)
      ? Number(band.wander?.baseFrequency)
      : band.frequency,
    MIN_FREQ,
    MAX_FREQ
  ),
  baseGain: clamp(
    Number.isFinite(band.wander?.baseGain) ? Number(band.wander?.baseGain) : band.gain,
    MIN_GAIN,
    MAX_GAIN
  ),
});

const createBandId = () => `peq-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const sortedBands = (bands: ParametricEqBand[]) => [...bands].sort((a, b) => a.frequency - b.frequency);

const ParametricEqEditor = ({
  bands,
  playbackActive = false,
  disabled = false,
  onChange,
}: ParametricEqEditorProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [graphWidth, setGraphWidth] = useState(VIEWBOX_WIDTH);
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
  const bandsRef = useRef(bands);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    bandsRef.current = bands;
  }, [bands]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [jitterDraft, setJitterDraft] = useState<{ bandId: string; value: number } | null>(null);
  const [spreadDraft, setSpreadDraft] = useState<{ bandId: string; value: number } | null>(null);
  const jitterDebounceTimeoutRef = useRef<number | null>(null);
  const pendingJitterRef = useRef<{ bandId: string; value: number } | null>(null);
  const spreadDebounceTimeoutRef = useRef<number | null>(null);
  const pendingSpreadRef = useRef<{ bandId: string; value: number } | null>(null);
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
      : null;

  const selectedBand = useMemo(
    () => bands.find((band) => band.id === resolvedSelectedBandId) ?? null,
    [bands, resolvedSelectedBandId]
  );

  const applyWanderPatch = useCallback((bandId: string, patch: Partial<ParametricEqBandWander>) => {
    const sourceBands = bandsRef.current;
    let changed = false;
    const next = sourceBands.map((band) => {
      if (band.id !== bandId) return band;
      const nextWander = {
        ...ensureWander(band),
        ...patch,
      };
      const normalized = {
        ...nextWander,
        jitter: clampUnit(nextWander.jitter),
        spread: clampUnit(nextWander.spread),
      };
      if (
        band.wander &&
        Math.abs((band.wander.jitter ?? 0) - normalized.jitter) <= 1e-4 &&
        Math.abs((band.wander.spread ?? 0) - normalized.spread) <= 1e-4
      ) {
        return band;
      }
      changed = true;
      return {
        ...band,
        wander: normalized,
      };
    });
    if (changed) {
      onChangeRef.current(next);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (jitterDebounceTimeoutRef.current !== null) {
        window.clearTimeout(jitterDebounceTimeoutRef.current);
      }
      if (spreadDebounceTimeoutRef.current !== null) {
        window.clearTimeout(spreadDebounceTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (jitterDebounceTimeoutRef.current !== null) {
      window.clearTimeout(jitterDebounceTimeoutRef.current);
      jitterDebounceTimeoutRef.current = null;
    }
    pendingJitterRef.current = null;
    if (spreadDebounceTimeoutRef.current !== null) {
      window.clearTimeout(spreadDebounceTimeoutRef.current);
      spreadDebounceTimeoutRef.current = null;
    }
    pendingSpreadRef.current = null;
  }, [resolvedSelectedBandId]);

  useEffect(() => {
    const handlePointerDownOutside = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(event.target as Node)) return;
      setSelectedBandId(null);
    };
    window.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, []);
  const hasActiveWander = bands.some((band) => {
    const wander = band.wander;
    return Boolean(wander && wander.jitter > 0.001 && wander.spread > 0.001);
  });

  useEffect(() => {
    if (hasActiveWander) return;
    let changed = false;
    const resetBands = bands.map((band) => {
      const wander = band.wander;
      if (!wander) return band;
      const baseFrequency = clamp(wander.baseFrequency, MIN_FREQ, MAX_FREQ);
      const baseGain = clamp(wander.baseGain, MIN_GAIN, MAX_GAIN);
      if (
        Math.abs(band.frequency - baseFrequency) <= 1e-4 &&
        Math.abs(band.gain - baseGain) <= 1e-4
      ) {
        return band;
      }
      changed = true;
      return {
        ...band,
        frequency: baseFrequency,
        gain: baseGain,
      };
    });
    if (changed) {
      onChange(resetBands);
    }
  }, [bands, hasActiveWander, onChange]);

  useEffect(() => {
    if (!playbackActive || !hasActiveWander) return undefined;
    const startedAtMs = performance.now();
    const intervalId = window.setInterval(() => {
      if (dragBandIdRef.current) return;
      const sourceBands = bandsRef.current;
      const elapsedSec = (performance.now() - startedAtMs) / 1000;
      let changed = false;
      const nextBands = sourceBands.map((band) => {
        const wander = band.wander;
        if (!wander || wander.jitter <= 0.001 || wander.spread <= 0.001) {
          return band;
        }
        const speedHz = 0.08 + wander.jitter * 1.7;
        const phaseA = elapsedSec * Math.PI * 2 * speedHz + wander.seed;
        const phaseB = elapsedSec * Math.PI * 2 * (speedHz * 1.37) + wander.seed * 1.91;
        const freqNoise = (Math.sin(phaseA) + 0.65 * Math.sin(phaseB)) / 1.65;
        const gainNoise = (
          Math.sin(phaseA * 0.79 + 1.7) +
          0.6 * Math.sin(phaseB * 1.11 + 0.2)
        ) / 1.6;
        const octaveSpan = 0.08 + wander.spread * 1.1;
        const gainSpan = 0.5 + wander.spread * 10;
        const frequency = clamp(
          wander.baseFrequency * Math.pow(2, freqNoise * octaveSpan),
          MIN_FREQ,
          MAX_FREQ
        );
        const gain = clamp(wander.baseGain + gainNoise * gainSpan, MIN_GAIN, MAX_GAIN);
        if (Math.abs(frequency - band.frequency) > 1e-4 || Math.abs(gain - band.gain) > 1e-4) {
          changed = true;
          return { ...band, frequency, gain };
        }
        return band;
      });
      if (changed) {
        onChangeRef.current(nextBands);
      }
    }, 1000 / 30);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [playbackActive, hasActiveWander]);

  const updateBand = useCallback((id: string, updates: Partial<ParametricEqBand>) => {
    const sourceBands = bandsRef.current;
    onChangeRef.current(
      sourceBands.map((band) =>
        band.id === id
          ? (() => {
              const nextFrequency =
                updates.frequency === undefined
                  ? band.frequency
                  : clamp(updates.frequency, MIN_FREQ, MAX_FREQ);
              const nextGain =
                updates.gain === undefined ? band.gain : clamp(updates.gain, MIN_GAIN, MAX_GAIN);
              const nextWander =
                updates.wander === undefined
                  ? band.wander
                  : {
                      ...ensureWander(band),
                      ...updates.wander,
                    };
              const hasDirectFrequencyUpdate = updates.frequency !== undefined;
              const hasDirectGainUpdate = updates.gain !== undefined;
              return {
                ...band,
                ...updates,
                frequency: nextFrequency,
                gain: nextGain,
                q: updates.q === undefined ? band.q : clamp(updates.q, MIN_Q, MAX_Q),
                wander:
                  nextWander === undefined
                    ? undefined
                    : {
                        ...nextWander,
                        jitter: clampUnit(nextWander.jitter),
                        spread: clampUnit(nextWander.spread),
                        seed: Number.isFinite(nextWander.seed)
                          ? Number(nextWander.seed)
                          : ensureWander(band).seed,
                        baseFrequency: hasDirectFrequencyUpdate
                          ? nextFrequency
                          : clamp(nextWander.baseFrequency, MIN_FREQ, MAX_FREQ),
                        baseGain: hasDirectGainUpdate
                          ? nextGain
                          : clamp(nextWander.baseGain, MIN_GAIN, MAX_GAIN),
                      },
              };
            })()
          : band
      )
    );
  }, []);

  const removeBand = (id: string) => {
    const next = bands.filter((band) => band.id !== id);
    onChange(next);
    if (resolvedSelectedBandId === id) {
      setSelectedBandId(null);
    }
  };

  const resetBands = () => {
    const next = defaultParametricEqBands();
    onChange(next);
    setSelectedBandId(null);
  };

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
            removeBand(activeBandId);
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
    <div ref={containerRef} className={`peq ${disabled ? "is-disabled" : ""}`.trim()}>
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
        {sorted.map((band) => {
          const nodeX = freqToX(band.frequency, graphWidth);
          const nodeY = gainToY(band.gain);
          const isSelected = resolvedSelectedBandId === band.id;
          const nodeRadius = isSelected ? 12 : 9;
          const wander = ensureWander(band);
          const jitter = band.wander ? clampUnit(wander.jitter) : 0;
          const spread = band.wander ? clampUnit(wander.spread) : 0;
          const ringRadius = nodeRadius + 2 + spread * 16;
          const hue = 212 + jitter * 4;
          const saturation = 72 + jitter * 24;
          const lightness = 70 - jitter * 18;
          return (
            <g key={band.id}>
              {spread > 0.001 ? (
                <circle
                  className={`peq__node-spread ${isSelected ? "is-selected" : ""}`.trim()}
                  cx={nodeX}
                  cy={nodeY}
                  r={ringRadius}
                  style={{
                    strokeOpacity: 0.12 + spread * 0.38,
                    strokeWidth: 0.9 + spread * 1.4,
                  }}
                />
              ) : null}
              <circle
                data-band-id={band.id}
                className={`peq__node ${isSelected ? "is-selected" : ""} ${band.enabled ? "" : "is-muted"}`.trim()}
                cx={nodeX}
                cy={nodeY}
                r={nodeRadius}
                style={
                  band.enabled
                    ? {
                        fill: `hsl(${hue} ${saturation}% ${lightness}%)`,
                      }
                    : undefined
                }
                onPointerDown={(event) => handleBandPointerDown(event, band.id)}
              />
            </g>
          );
        })}
      </svg>
      <div className="peq__toolbar">
        <span className="peq__hint">
          Click graph to add node. Drag node for freq/gain. Double-click or Shift+click node to remove.
        </span>
        <div className="peq__toolbar-row">
          <div className="peq__toolbar-left">
            <button
              type="button"
              className="deck__action"
              disabled={bands.length >= MAX_BANDS}
              title="Add a new parametric EQ node at the graph center."
              onClick={() => {
                addBandAtPoint(graphWidth * 0.5, VIEWBOX_HEIGHT * 0.5);
              }}
            >
              Add Node
            </button>
            <button
              type="button"
              className="deck__action"
              disabled={!selectedBand}
              title="Remove the selected parametric EQ node."
              onClick={() => {
                if (!selectedBand) return;
                removeBand(selectedBand.id);
              }}
            >
              Remove
            </button>
          </div>
          <button
            type="button"
            className="deck__action"
            title="Reset parametric EQ nodes to the default set."
            onClick={resetBands}
          >
            Reset
          </button>
        </div>
        {sorted.length > 0 ? (
          <div className="peq__node-selectors" role="group" aria-label="Select parametric EQ node">
            {sorted.map((band, index) => (
              <button
                key={band.id}
                type="button"
                className={`deck__action peq__node-selector ${ensureWander(band).jitter > 0.001 ? "has-jitter" : ""} ${resolvedSelectedBandId === band.id ? "is-active" : ""}`.trim()}
                title={`Select node ${index + 1}`}
                aria-pressed={resolvedSelectedBandId === band.id}
                onClick={() => setSelectedBandId(band.id)}
              >
                {index + 1}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={`peq__inspector ${selectedBand ? "" : "peq__inspector--empty"}`.trim()}>
        <div className="peq__inspector-row">
          <label>
            Type
            <select
              disabled={!selectedBand}
              value={selectedBand?.type ?? "peaking"}
              onChange={(event) => {
                if (!selectedBand) return;
                updateBand(selectedBand.id, { type: event.target.value as ParametricEqBandType });
              }}
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
              disabled={!selectedBand}
              value={selectedBand?.q ?? 1.2}
              title="Q controls band width: higher Q is narrower/more surgical, lower Q is wider/more gentle."
              onDoubleClick={() => {
                if (!selectedBand) return;
                updateBand(selectedBand.id, { q: defaultQForType(selectedBand.type) });
              }}
              onChange={(event) => {
                if (!selectedBand) return;
                updateBand(selectedBand.id, { q: Number(event.target.value) });
              }}
            />
          </label>
        </div>
        <div>
          <div className="deck__fx-controls-grid deck__fx-controls-grid--cols-5">
            <Knob
              className="knob--compact"
              label="Jitter"
              min={0}
              max={1}
              step={0.01}
              disabled={!selectedBand}
              value={
                selectedBand
                  ? jitterDraft !== null && jitterDraft.bandId === selectedBand.id
                    ? jitterDraft.value
                    : ensureWander(selectedBand).jitter
                  : 0
              }
              defaultValue={0}
              labelTitle="How erratic and lively this node moves while playing."
              onChange={(next) => {
                if (!selectedBand) return;
                if (!playbackActive) {
                  setJitterDraft(null);
                  applyWanderPatch(selectedBand.id, { jitter: next });
                  return;
                }
                setJitterDraft({ bandId: selectedBand.id, value: next });
                pendingJitterRef.current = { bandId: selectedBand.id, value: next };
                if (jitterDebounceTimeoutRef.current !== null) {
                  window.clearTimeout(jitterDebounceTimeoutRef.current);
                }
                jitterDebounceTimeoutRef.current = window.setTimeout(() => {
                  jitterDebounceTimeoutRef.current = null;
                  const pending = pendingJitterRef.current;
                  pendingJitterRef.current = null;
                  if (!pending) return;
                  applyWanderPatch(pending.bandId, { jitter: pending.value });
                  setJitterDraft(null);
                }, JITTER_DEBOUNCE_MS);
              }}
              formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
            />
            <Knob
              className="knob--compact"
              label="Spread"
              min={0}
              max={1}
              step={0.01}
              disabled={!selectedBand}
              value={
                selectedBand
                  ? spreadDraft !== null && spreadDraft.bandId === selectedBand.id
                    ? spreadDraft.value
                    : ensureWander(selectedBand).spread
                  : 0
              }
              defaultValue={0}
              labelTitle="How far this node wanders from its base frequency and gain."
              onChange={(next) => {
                if (!selectedBand) return;
                if (!playbackActive) {
                  setSpreadDraft(null);
                  applyWanderPatch(selectedBand.id, { spread: next });
                  return;
                }
                setSpreadDraft({ bandId: selectedBand.id, value: next });
                pendingSpreadRef.current = { bandId: selectedBand.id, value: next };
                if (spreadDebounceTimeoutRef.current !== null) {
                  window.clearTimeout(spreadDebounceTimeoutRef.current);
                }
                spreadDebounceTimeoutRef.current = window.setTimeout(() => {
                  spreadDebounceTimeoutRef.current = null;
                  const pending = pendingSpreadRef.current;
                  pendingSpreadRef.current = null;
                  if (!pending) return;
                  applyWanderPatch(pending.bandId, { spread: pending.value });
                  setSpreadDraft(null);
                }, SPREAD_DEBOUNCE_MS);
              }}
              formatValue={(value, fine) => `${(value * 100).toFixed(fine ? 2 : 1)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParametricEqEditor;
