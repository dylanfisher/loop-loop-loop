import { useCallback, useRef, useState } from "react";
import { encodeWav } from "../utils/audio";
import { buildTimestampedAudioFilename } from "../utils/appHelpers";

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

const useRecordingManager = ({
  decodeFile,
  getRecordStream,
  sessionName,
}: UseRecordingManagerArgs) => {
  const [recording, setRecording] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

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
    recordChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      setRecording(false);
      const blob = new Blob(recordChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      const file = new File([blob], "loop-loop-loop-recording.webm", {
        type: blob.type || "audio/webm",
      });
      recordChunksRef.current = [];
      recorderRef.current = null;
      void decodeFile(file)
        .then((buffer) => {
          const wavBlob = encodeWav(buffer);
          const url = URL.createObjectURL(wavBlob);
          const link = document.createElement("a");
          link.href = url;
          link.download = buildTimestampedAudioFilename(
            "loop-loop-loop-recording",
            sessionName,
            "wav"
          );
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        })
        .catch((error) => {
          console.error("Failed to convert recording to wav", error);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = buildTimestampedAudioFilename(
            "loop-loop-loop-recording",
            sessionName,
            "webm"
          );
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        })
        .finally(() => {
          setSavingRecording(false);
        });
    };
    recorder.start(250);
    setSavingRecording(false);
    setRecording(true);
  }, [decodeFile, getRecordStream, recording, savingRecording, sessionName]);

  return {
    recording,
    savingRecording,
    handleRecordToggle,
  };
};

export default useRecordingManager;
