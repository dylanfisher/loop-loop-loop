import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "../utils/audio";
import { buildTimestampedAudioFilename } from "../utils/appHelpers";
import {
  appendRecordingDraftChunk,
  createRecordingDraft,
  deleteRecordingDraft,
  listRecordingDrafts,
  loadRecordingDraftChunks,
  type RecordingDraft,
} from "../utils/sessionStore";

type UseRecordingManagerArgs = {
  decodeFile: (file: File) => Promise<AudioBuffer>;
  getRecordStream: () => MediaStream | null;
  sessionName: string;
};

const RECORDING_MIME_PREFERENCES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
];
const RECORDING_TIMESLICE_MS = 2000;
const WAV_CONVERSION_MAX_DURATION_MS = 10 * 60 * 1000;

const getRecorderErrorMessage = (event: Event) => {
  const recorderError = (event as Event & { error?: DOMException }).error;
  if (!recorderError) return "Unknown MediaRecorder error.";
  return `${recorderError.name}: ${recorderError.message}`;
};

const createBestRecorder = (stream: MediaStream) => {
  const highQualityOptions: MediaRecorderOptions = {
    audioBitsPerSecond: 192000,
  };
  for (const mimeType of RECORDING_MIME_PREFERENCES) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { ...highQualityOptions, mimeType });
    } catch {
      continue;
    }
  }
  try {
    return new MediaRecorder(stream, highQualityOptions);
  } catch {
    return new MediaRecorder(stream);
  }
};

const getCompressedRecordingExtension = (mimeType: string) => {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("webm")) return "webm";
  return "webm";
};

const downloadBlob = (
  blob: Blob,
  filenameSessionName: string,
  extension: "wav" | "webm" | "ogg" | "m4a"
) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildTimestampedAudioFilename(
    "loop-loop-loop-recording",
    filenameSessionName,
    extension
  );
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const useRecordingManager = ({
  decodeFile,
  getRecordStream,
  sessionName,
}: UseRecordingManagerArgs) => {
  const [recording, setRecording] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const [recordingDrafts, setRecordingDrafts] = useState<RecordingDraft[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const chunkIndexRef = useRef(0);
  const chunkWriteRef = useRef<Promise<void>>(Promise.resolve());

  const refreshRecordingDrafts = useCallback(() => {
    void listRecordingDrafts("global")
      .then(setRecordingDrafts)
      .catch((error) => {
        console.error("Failed to list recording drafts", error);
      });
  }, []);

  const downloadRecordingBlob = useCallback(
    (blob: Blob, filenameSessionName = sessionName, durationMs?: number) => {
      const shouldSkipWavConversion =
        typeof durationMs === "number" && durationMs > WAV_CONVERSION_MAX_DURATION_MS;
      if (shouldSkipWavConversion) {
        console.info("[recording] Skipping WAV conversion for long recording", {
          durationMs,
          maxDurationMs: WAV_CONVERSION_MAX_DURATION_MS,
        });
        downloadBlob(
          blob,
          filenameSessionName,
          getCompressedRecordingExtension(blob.type || "audio/webm")
        );
        return Promise.resolve();
      }

      const file = new File([blob], "loop-loop-loop-recording.webm", {
        type: blob.type || "audio/webm",
      });
      return decodeFile(file)
        .then((buffer) => {
          const wavBlob = encodeWav(buffer);
          downloadBlob(wavBlob, filenameSessionName, "wav");
        })
        .catch((error) => {
          console.error("Failed to convert recording to wav", error);
          downloadBlob(
            blob,
            filenameSessionName,
            getCompressedRecordingExtension(blob.type || "audio/webm")
          );
        });
    },
    [decodeFile, sessionName]
  );

  const recoverRecordingDraft = useCallback(
    async (draft: RecordingDraft) => {
      setSavingRecording(true);
      try {
        const chunks = await loadRecordingDraftChunks(draft.id);
        const blob = new Blob(chunks, { type: draft.mimeType || "audio/webm" });
        await downloadRecordingBlob(
          blob,
          draft.sessionName ?? sessionName,
          draft.updatedAt - draft.startedAt
        );
        await deleteRecordingDraft(draft.id);
        refreshRecordingDrafts();
      } finally {
        setSavingRecording(false);
      }
    },
    [downloadRecordingBlob, refreshRecordingDrafts, sessionName]
  );

  const discardRecordingDraft = useCallback(
    async (draftId: string) => {
      await deleteRecordingDraft(draftId);
      refreshRecordingDrafts();
    },
    [refreshRecordingDrafts]
  );

  useEffect(() => {
    refreshRecordingDrafts();
  }, [refreshRecordingDrafts]);

  const handleRecordToggle = useCallback(() => {
    if (savingRecording) return;
    if (recording) {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        setSavingRecording(true);
        recorder.stop();
      }
      return;
    }
    const stream = getRecordStream();
    if (!stream) return;
    const recorder = createBestRecorder(stream);
    console.log("[recording] MediaRecorder config", {
      mimeType: recorder.mimeType || "default",
      audioBitsPerSecond:
        Number.isFinite(recorder.audioBitsPerSecond) && recorder.audioBitsPerSecond > 0
          ? recorder.audioBitsPerSecond
          : "default",
    });
    recorderRef.current = recorder;
    draftIdRef.current = null;
    recordingStartedAtRef.current = null;
    chunkIndexRef.current = 0;
    chunkWriteRef.current = createRecordingDraft({
      kind: "global",
      mimeType: recorder.mimeType || "audio/webm",
      sessionName,
    }).then((draft) => {
      draftIdRef.current = draft.id;
      recordingStartedAtRef.current = draft.startedAt;
      refreshRecordingDrafts();
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const blob = event.data;
        const index = chunkIndexRef.current;
        chunkIndexRef.current += 1;
        chunkWriteRef.current = chunkWriteRef.current
          .then(() => {
            const draftId = draftIdRef.current;
            if (!draftId) return;
            return appendRecordingDraftChunk(draftId, index, blob);
          })
          .catch((error) => {
            console.error("Failed to persist recording chunk", error);
          });
      }
    };
    recorder.onerror = (event) => {
      console.error("[recording] MediaRecorder error", getRecorderErrorMessage(event), event);
      setRecording(false);
      if (recorder.state !== "inactive") {
        setSavingRecording(true);
        recorder.stop();
      }
    };
    recorder.onstop = () => {
      setRecording(false);
      recorderRef.current = null;
      void chunkWriteRef.current
        .then(async () => {
          const draftId = draftIdRef.current;
          if (!draftId) return;
          const chunks = await loadRecordingDraftChunks(draftId);
          const blob = new Blob(chunks, {
            type: recorder.mimeType || "audio/webm",
          });
          const durationMs =
            recordingStartedAtRef.current === null
              ? undefined
              : Date.now() - recordingStartedAtRef.current;
          await downloadRecordingBlob(blob, sessionName, durationMs);
          await deleteRecordingDraft(draftId);
        })
        .catch((error) => {
          console.error("Failed to save recording", error);
        })
        .finally(() => {
          draftIdRef.current = null;
          recordingStartedAtRef.current = null;
          refreshRecordingDrafts();
          setSavingRecording(false);
        });
    };
    recorder.start(RECORDING_TIMESLICE_MS);
    setSavingRecording(false);
    setRecording(true);
  }, [
    downloadRecordingBlob,
    getRecordStream,
    recording,
    refreshRecordingDrafts,
    savingRecording,
    sessionName,
  ]);

  return {
    recording,
    savingRecording,
    recordingDrafts,
    handleRecordToggle,
    recoverRecordingDraft,
    discardRecordingDraft,
  };
};

export default useRecordingManager;
