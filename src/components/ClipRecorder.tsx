import { useEffect, useRef, useState } from "react";
import type { DeckState } from "../types/deck";
import type { ClipItem } from "../types/clip";
import useAudioEngine from "../hooks/useAudioEngine";

type ClipRecorderProps = {
  decks: DeckState[];
  onLoadClip: (deckId: number, clip: ClipItem) => void | Promise<void>;
  clips: ClipItem[];
  onAddClip: (
    clip: Omit<ClipItem, "id" | "url" | "name"> & { name?: string }
  ) => void;
  onUpdateClip: (id: number, updates: Partial<ClipItem>) => void;
  onRemoveClip: (id: number) => void;
};

const ClipRecorder = ({
  decks,
  onLoadClip,
  clips,
  onAddClip,
  onUpdateClip,
  onRemoveClip,
}: ClipRecorderProps) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { decodeFile, getMasterStream } = useAudioEngine();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement | null>>(new Map());
  const decodePendingRef = useRef<Set<number>>(new Set());
  const [themeToken, setThemeToken] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleThemeChange = () => setThemeToken((prev) => prev + 1);
    window.addEventListener("themechange", handleThemeChange);
    return () => window.removeEventListener("themechange", handleThemeChange);
  }, []);

  useEffect(() => {
    clips.forEach((clip) => {
      if (clip.buffer || decodePendingRef.current.has(clip.id)) return;
      decodePendingRef.current.add(clip.id);
      const file = new File([clip.blob], `${clip.name}.webm`, {
        type: clip.blob.type || "audio/webm",
      });
      decodeFile(file)
        .then((buffer) => {
          onUpdateClip(clip.id, { buffer });
        })
        .catch((err) => {
          console.error("Failed to decode clip preview", err);
        })
        .finally(() => {
          decodePendingRef.current.delete(clip.id);
        });
    });
  }, [clips, decodeFile, onUpdateClip]);

  const drawPreview = (canvas: HTMLCanvasElement, buffer: AudioBuffer) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.body);
    const canvasBg = styles.getPropertyValue("--canvas-bg").trim() || "#f6f9ff";
    const canvasInk = styles.getPropertyValue("--canvas-ink").trim() || "#111";
    context.fillStyle = canvasBg;
    context.fillRect(0, 0, width, height);

    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    const amp = height / 2;
    context.strokeStyle = canvasInk;
    context.lineWidth = 1;
    context.beginPath();
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
      context.moveTo(i, amp + min * amp);
      context.lineTo(i, amp + max * amp);
    }
    context.stroke();
  };

  useEffect(() => {
    clips.forEach((clip) => {
      if (!clip.buffer) return;
      const canvas = canvasRefs.current.get(clip.id);
      if (!canvas) return;
      drawPreview(canvas, clip.buffer);
    });
  }, [clips, themeToken]);

  const setCanvasRef = (id: number, node: HTMLCanvasElement | null) => {
    canvasRefs.current.set(id, node);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const startRecording = async () => {
    if (recording) return;
    setError(null);
    setElapsed(0);

    try {
      const stream = getMasterStream();
      if (!stream) {
        setError("Audio engine not ready.");
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startTimeRef.current = performance.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stopTimer();
        const durationSec = startTimeRef.current
          ? (performance.now() - startTimeRef.current) / 1000
          : elapsed;
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onAddClip({
          blob,
          durationSec,
          gain: 0.9,
          balance: 0,
          pitchShift: 0,
          tempoOffset: 0,
        });
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        setElapsed(0);
        startTimeRef.current = null;
      };

      recorder.start(250);
      setRecording(true);

      timerRef.current = window.setInterval(() => {
        if (!startTimeRef.current) return;
        const nextElapsed = (performance.now() - startTimeRef.current) / 1000;
        setElapsed(nextElapsed);
      }, 100);
    } catch (err) {
      console.error("Failed to start clip recording", err);
      setError("Failed to record app audio.");
      setRecording(false);
      setElapsed(0);
    }
  };

  return (
    <section className="panel clip-rack">
      <div className="panel__title">
        <div className="clip-rack__title">
          <span>Clip Recorder</span>
          <span className="clip-rack__meta">
            {recording ? `Recording ${elapsed.toFixed(1)}s` : "Idle"}
          </span>
        </div>
        <div className="panel__actions">
          {recording ? (
            <button type="button" onClick={stopRecording}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={startRecording}>
              Record
            </button>
          )}
        </div>
      </div>
      {error ? <div className="clip-rack__error">{error}</div> : null}
      <div className="clip-rack__list">
        {clips.length === 0 ? (
          <div className="clip-rack__empty">No clips yet.</div>
        ) : (
          clips.map((clip) => (
            <div key={clip.id} className="clip-rack__clip">
              <div className="clip-rack__clip-info">
                <span>{clip.name}</span>
                <div className="clip-rack__clip-meta">
                  {clip.settings ? (
                    <button
                      type="button"
                      className={`clip-rack__clip-badge ${clip.applyFxSettings ? "is-active" : ""}`.trim()}
                      title={
                        clip.applyFxSettings
                          ? "FX settings will be applied when loading this clip"
                          : "FX settings metadata is saved, but will not be applied on load"
                      }
                      onClick={() =>
                        onUpdateClip(clip.id, {
                          applyFxSettings: !clip.applyFxSettings,
                        })
                      }
                    >
                      FX
                    </button>
                  ) : null}
                  <span>{clip.durationSec.toFixed(1)}s</span>
                </div>
              </div>
              <div className="clip-rack__clip-waveform">
                <canvas ref={(node) => setCanvasRef(clip.id, node)} />
              </div>
              <div className="clip-rack__clip-actions">
                <div className="clip-rack__clip-loads">
                  {decks.map((deck, index) => (
                    <button
                      key={deck.id}
                      type="button"
                      onClick={() => void onLoadClip(deck.id, clip)}
                    >
                      Load Deck {index + 1}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => onRemoveClip(clip.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default ClipRecorder;
