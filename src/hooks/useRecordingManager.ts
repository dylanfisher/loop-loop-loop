import { useCallback, useRef, useState } from "react";
import { encodeWav } from "../utils/audio";
import { buildTimestampedAudioFilename } from "../utils/appHelpers";

type UseRecordingManagerArgs = {
  decodeFile: (file: File) => Promise<AudioBuffer>;
  getMasterStream: () => MediaStream | null;
  sessionName: string;
};

const useRecordingManager = ({
  decodeFile,
  getMasterStream,
  sessionName,
}: UseRecordingManagerArgs) => {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  const handleRecordToggle = useCallback(() => {
    if (recording) {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      return;
    }
    const stream = getMasterStream();
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recordChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
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
          setRecording(false);
        });
    };
    recorder.start(250);
    setRecording(true);
  }, [decodeFile, getMasterStream, recording, sessionName]);

  return {
    recording,
    handleRecordToggle,
  };
};

export default useRecordingManager;
