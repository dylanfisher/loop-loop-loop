import { useEffect, useState } from "react";
import { getPerfSnapshot } from "../utils/perf";

const PerfOverlay = () => {
  const [snapshot, setSnapshot] = useState(getPerfSnapshot());
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    let frames = 0;

    const tick = (now: number) => {
      frames += 1;
      const delta = now - last;
      if (delta >= 500) {
        setFps(Math.round((frames * 1000) / delta));
        frames = 0;
        last = now;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot(getPerfSnapshot());
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const buildPeaksMs = snapshot.timings.buildPeaksMs ?? 0;
  const buildBandPeaksMs = snapshot.timings.buildBandPeaksMs ?? 0;
  const renderOverlayMs = snapshot.timings.renderOverlayMs ?? 0;
  const waveformRenders = snapshot.counters.waveformRenders ?? 0;
  const deckCardRenders = snapshot.counters.deckCardRenders ?? 0;

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        top: 12,
        zIndex: 9999,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(10, 10, 10, 0.85)",
        color: "#f8fafc",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        fontSize: 12,
        lineHeight: 1.4,
        minWidth: 200,
        pointerEvents: "none",
      }}
    >
      <div>FPS: {fps}</div>
      <div>buildPeaks: {buildPeaksMs.toFixed(2)} ms</div>
      <div>buildBandPeaks: {buildBandPeaksMs.toFixed(2)} ms</div>
      <div>renderOverlay: {renderOverlayMs.toFixed(2)} ms</div>
      <div>Waveform renders: {waveformRenders}</div>
      <div>DeckCard renders: {deckCardRenders}</div>
    </div>
  );
};

export default PerfOverlay;
