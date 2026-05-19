import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "../utils/audio";
import { buildTimestampedAudioFilename } from "../utils/appHelpers";
import { encodePcm16WavHeader, PcmWavRecorder } from "../utils/pcmWavRecorder";
import {
  appendRecordingDraftChunk,
  createRecordingDraft,
  deleteRecordingDraft,
  listRecordingDrafts,
  loadRecordingDraftChunk,
  loadRecordingDraftChunks,
  type RecordingDraft,
} from "../utils/sessionStore";

type UseRecordingManagerArgs = {
  decodeFile: (file: File) => Promise<AudioBuffer>;
  getRecordStream: () => MediaStream | null;
  sessionName: string;
};

const WAV_CONVERSION_MAX_DURATION_MS = 10 * 60 * 1000;
const STREAM_SAVE_MIN_BYTES = 100 * 1024 * 1024;

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob | BufferSource | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

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
  link.download = getRecordingFilename(filenameSessionName, extension);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const getRecordingFilename = (
  filenameSessionName: string,
  extension: "wav" | "webm" | "ogg" | "m4a"
) => buildTimestampedAudioFilename("loop-loop-loop-recording", filenameSessionName, extension);

const getSaveFilePicker = () => {
  const picker = (globalThis as typeof globalThis & {
    showSaveFilePicker?: SaveFilePicker;
  }).showSaveFilePicker;
  return typeof picker === "function" ? picker.bind(globalThis) : null;
};

const useRecordingManager = ({
  decodeFile,
  getRecordStream,
  sessionName,
}: UseRecordingManagerArgs) => {
  const [recording, setRecording] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const [recordingDrafts, setRecordingDrafts] = useState<RecordingDraft[]>([]);
  const recorderRef = useRef<PcmWavRecorder | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const chunkWriteRef = useRef<Promise<void>>(Promise.resolve());

  const refreshRecordingDrafts = useCallback(() => {
    void listRecordingDrafts("global")
      .then(setRecordingDrafts)
      .catch((error) => {
        console.error("Failed to list recording drafts", error);
      });
  }, []);

  const downloadPcmWavDraft = useCallback(
    async (draft: RecordingDraft, filenameSessionName = sessionName) => {
      if (!draft.sampleRate || !draft.channelCount) {
        throw new Error("PCM recording draft is missing WAV metadata.");
      }
      const header = encodePcm16WavHeader(draft.totalBytes, draft.sampleRate, draft.channelCount);
      const saveFilePicker = getSaveFilePicker();
      if (saveFilePicker && draft.totalBytes >= STREAM_SAVE_MIN_BYTES) {
        const writable = await saveFilePicker({
          suggestedName: getRecordingFilename(filenameSessionName, "wav"),
          types: [
            {
              description: "WAV audio",
              accept: { "audio/wav": [".wav"] },
            },
          ],
        }).then((handle) => handle.createWritable());
        try {
          await writable.write(header);
          for (let index = 0; index < draft.chunkCount; index += 1) {
            const chunk = await loadRecordingDraftChunk(draft.id, index);
            if (chunk) {
              await writable.write(chunk);
            }
          }
        } finally {
          await writable.close();
        }
        return;
      }

      const chunks = await loadRecordingDraftChunks(draft.id);
      downloadBlob(
        new Blob([header, ...chunks], { type: "audio/wav" }),
        filenameSessionName,
        "wav"
      );
    },
    [sessionName]
  );

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
        if (draft.mimeType.includes("wav")) {
          await downloadPcmWavDraft(draft, draft.sessionName ?? sessionName);
          await deleteRecordingDraft(draft.id);
          refreshRecordingDrafts();
          return;
        }
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
    [downloadPcmWavDraft, downloadRecordingBlob, refreshRecordingDrafts, sessionName]
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
      if (!recorder) return;
      setSavingRecording(true);
      recorder.stop();
      setRecording(false);
      recorderRef.current = null;
      void chunkWriteRef.current
        .then(async () => {
          const draftId = draftIdRef.current;
          if (!draftId) return;
          const drafts = await listRecordingDrafts("global");
          const draft = drafts.find((candidate) => candidate.id === draftId);
          if (!draft) return;
          await downloadPcmWavDraft(draft, sessionName);
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
      return;
    }
    const stream = getRecordStream();
    if (!stream) return;
    setSavingRecording(true);
    const recorder = new PcmWavRecorder();
    draftIdRef.current = null;
    recordingStartedAtRef.current = null;
    chunkWriteRef.current = Promise.resolve();
    let resolveDraftReady: () => void;
    const draftReady = new Promise<void>((resolve) => {
      resolveDraftReady = resolve;
    });
    void recorder
      .start(stream, ({ blob, index }) => {
        chunkWriteRef.current = chunkWriteRef.current
          .then(() => draftReady)
          .then(() => {
            const draftId = draftIdRef.current;
            if (!draftId) return;
            return appendRecordingDraftChunk(draftId, index, blob);
          })
          .catch((error) => {
            console.error("Failed to persist recording chunk", error);
          });
      })
      .then(async () => {
        const metadata = recorder.metadata;
        if (!metadata) throw new Error("PCM recorder did not report WAV metadata.");
        const draft = await createRecordingDraft({
          kind: "global",
          mimeType: "audio/wav",
          sampleRate: metadata.sampleRate,
          channelCount: metadata.channelCount,
          sessionName,
        });
        draftIdRef.current = draft.id;
        recordingStartedAtRef.current = draft.startedAt;
        recorderRef.current = recorder;
        console.log("[recording] PCM WAV recorder config", metadata);
        resolveDraftReady();
        refreshRecordingDrafts();
        setSavingRecording(false);
        setRecording(true);
      })
      .catch((error) => {
        console.error("[recording] Failed to start PCM WAV recorder", error);
        resolveDraftReady();
        recorder.stop();
        setSavingRecording(false);
        setRecording(false);
      });
  }, [
    downloadPcmWavDraft,
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
