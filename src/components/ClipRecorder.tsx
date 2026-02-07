import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { DeckState } from "../types/deck";
import type { ClipItem } from "../types/clip";
import useAudioEngine from "../hooks/useAudioEngine";

type ClipRecorderProps = {
  decks: DeckState[];
  zipDragActive?: boolean;
  onLoadClip: (deckId: number, clip: ClipItem) => void | Promise<void>;
  clips: ClipItem[];
  onAddClip: (
    clip: Omit<ClipItem, "id" | "url" | "name"> & { name?: string }
  ) => void;
  onUpdateClip: (id: number, updates: Partial<ClipItem>) => void;
  onRemoveClip: (id: number) => void;
};

type RecordingSource = "master" | "input";

const ClipRecorder = ({
  decks,
  zipDragActive = false,
  onLoadClip,
  clips,
  onAddClip,
  onUpdateClip,
  onRemoveClip,
}: ClipRecorderProps) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [recordingSource, setRecordingSource] = useState<RecordingSource>("master");
  const { decodeFile, getMasterStream } = useAudioEngine();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputStreamActiveRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement | null>>(new Map());
  const previewAudioByClipRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const decodePendingRef = useRef<Set<number>>(new Set());
  const dragDepthRef = useRef(0);
  const [previewingClipId, setPreviewingClipId] = useState<number | null>(null);
  const [themeToken, setThemeToken] = useState(0);

  useEffect(() => {
    const previewAudios = previewAudioByClipRef.current;
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      previewAudios.forEach((audio) => audio.pause());
      previewAudios.clear();
      if (inputStreamActiveRef.current && streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
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
    const clipIds = new Set(clips.map((clip) => clip.id));
    previewAudioByClipRef.current.forEach((audio, id) => {
      if (!clipIds.has(id)) {
        audio.pause();
        previewAudioByClipRef.current.delete(id);
        if (previewingClipId === id) {
          setPreviewingClipId(null);
        }
      }
    });
  }, [clips, previewingClipId]);

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

  const stopPreview = () => {
    if (previewingClipId === null) return;
    const activeAudio = previewAudioByClipRef.current.get(previewingClipId);
    if (activeAudio) {
      activeAudio.pause();
    }
    setPreviewingClipId(null);
  };

  const toggleClipPreview = (clip: ClipItem) => {
    const activeId = previewingClipId;
    const existing = previewAudioByClipRef.current.get(clip.id);
    if (activeId === clip.id && existing && !existing.paused) {
      existing.pause();
      setPreviewingClipId(null);
      return;
    }
    if (activeId !== null) {
      const activeAudio = previewAudioByClipRef.current.get(activeId);
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
    }
    const audio = existing ?? new Audio(clip.url);
    if (!existing) {
      audio.preload = "metadata";
      audio.addEventListener("ended", () => {
        setPreviewingClipId((current) => (current === clip.id ? null : current));
      });
      previewAudioByClipRef.current.set(clip.id, audio);
    }
    if (activeId !== clip.id) {
      audio.currentTime = 0;
    }
    void audio
      .play()
      .then(() => setPreviewingClipId(clip.id))
      .catch((err) => {
        console.error("Failed to play clip preview", err);
        setError("Failed to play clip preview.");
        setPreviewingClipId(null);
      });
  };

  const startRecording = async () => {
    if (recording) return;
    setError(null);
    setElapsed(0);

    try {
      const stream =
        recordingSource === "input"
          ? await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
            })
          : getMasterStream();
      if (!stream) {
        setError("Audio engine not ready.");
        return;
      }
      streamRef.current = stream;
      inputStreamActiveRef.current = recordingSource === "input";
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
          name: recordingSource === "input" ? "(input)" : undefined,
          blob,
          durationSec,
          gain: 0.9,
          balance: 0,
          pitchShift: 0,
          tempoOffset: 0,
        });
        chunksRef.current = [];
        recorderRef.current = null;
        if (inputStreamActiveRef.current && streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        streamRef.current = null;
        inputStreamActiveRef.current = false;
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
      setError(
        recordingSource === "input"
          ? "Failed to record input device audio."
          : "Failed to record app audio."
      );
      if (inputStreamActiveRef.current && streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      inputStreamActiveRef.current = false;
      setRecording(false);
      setElapsed(0);
    }
  };

  const isAudioFile = (file: File) => {
    if (file.type.startsWith("audio/")) return true;
    return /\.(wav|mp3|flac|ogg|m4a|aac|aif|aiff|webm)$/i.test(file.name);
  };

  const onDropAudio = async (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    setError(null);
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    const hasZip = droppedFiles.some((file) => {
      const lower = file.name.toLowerCase();
      return lower.endsWith(".zip") || file.type === "application/zip";
    });
    if (hasZip) {
      // Let app-level zip import handle this drop target without surfacing audio-drop errors.
      return;
    }
    const files = droppedFiles.filter(isAudioFile);
    if (files.length === 0) {
      setError("Drop one or more audio files.");
      return;
    }
    const failed: string[] = [];
    for (const file of files) {
      try {
        const buffer = await decodeFile(file);
        onAddClip({
          name: file.name.replace(/\.[^.]+$/, ""),
          blob: file,
          buffer,
          durationSec: buffer.duration,
          gain: 0.9,
          balance: 0,
          pitchShift: 0,
          tempoOffset: 0,
        });
      } catch {
        failed.push(file.name);
      }
    }
    if (failed.length > 0) {
      setError(`Failed to import: ${failed.join(", ")}`);
    }
  };

  const onDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (zipDragActive) return;
    const hasFiles = event.dataTransfer.types.includes("Files");
    if (!hasFiles) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (zipDragActive) return;
    const hasFiles = event.dataTransfer.types.includes("Files");
    if (!hasFiles) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (zipDragActive) return;
    const hasFiles = event.dataTransfer.types.includes("Files");
    if (!hasFiles) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  return (
    <section
      className={`panel clip-rack ${isDragOver && !zipDragActive ? "clip-rack--drop-target" : ""}`.trim()}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDropAudio(event)}
    >
      <div className="panel__title">
        <div className="clip-rack__title">
          <span>Clip Recorder</span>
          <span className="clip-rack__meta">
            {recording ? `Recording ${elapsed.toFixed(1)}s` : "Idle"}
          </span>
        </div>
        <div className="panel__actions">
          <div className="clip-rack__record-source" role="group" aria-label="Recording source">
            <button
              type="button"
              className={recordingSource === "master" ? "is-active" : undefined}
              onClick={() => setRecordingSource("master")}
              disabled={recording}
              title="Record app output (master bus)"
            >
              App
            </button>
            <button
              type="button"
              className={recordingSource === "input" ? "is-active" : undefined}
              onClick={() => setRecordingSource("input")}
              disabled={recording}
              title="Record from input device (microphone/interface)"
            >
              Input
            </button>
          </div>
          {recording ? (
            <button type="button" onClick={stopRecording}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              title={
                recordingSource === "input"
                  ? "Start recording from input device"
                  : "Start recording app output"
              }
            >
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
            <div
              key={clip.id}
              className={`clip-rack__clip ${previewingClipId === clip.id ? "is-playing" : ""}`.trim()}
            >
              <div className="clip-rack__clip-info">
                <span className="clip-rack__clip-name">
                  <span
                    className={`clip-rack__clip-preview-label ${previewingClipId === clip.id ? "is-active" : ""}`}
                  >
                    Preview
                  </span>
                  <span
                    className={`clip-rack__clip-preview-icon ${previewingClipId === clip.id ? "is-active" : ""}`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  <span>{clip.name}</span>
                </span>
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
                <div
                  className={`clip-rack__clip-waveform-hit ${previewingClipId === clip.id ? "is-active" : ""}`}
                  role="button"
                  tabIndex={0}
                  title={
                    previewingClipId === clip.id
                      ? "Pause clip preview"
                      : "Play clip preview"
                  }
                  onClick={() => toggleClipPreview(clip)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleClipPreview(clip);
                    }
                  }}
                >
                  <canvas ref={(node) => setCanvasRef(clip.id, node)} />
                </div>
              </div>
              <div className="clip-rack__clip-actions">
                <div className="clip-rack__clip-loads">
                  <span className="clip-rack__clip-loads-title">Load Deck</span>
                  {decks.map((deck, index) => (
                    <button
                      key={deck.id}
                      type="button"
                      onClick={() => void onLoadClip(deck.id, clip)}
                      title={`Load clip into deck ${index + 1}`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (previewingClipId === clip.id) {
                      stopPreview();
                    }
                    onRemoveClip(clip.id);
                  }}
                >
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
