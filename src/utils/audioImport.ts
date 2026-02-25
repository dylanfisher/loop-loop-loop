import { encodeWav } from "./audio";
import { transcodeImportedAudioFile } from "./audioImportTranscode";

type DecodeFile = (file: File) => Promise<AudioBuffer>;

const PORTABLE_AUDIO_EXTENSIONS = new Set(["wav", "mp3", "ogg", "webm"]);
const PORTABLE_AUDIO_MIME_PREFIXES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/webm",
];

const getFileExtension = (fileName: string) => {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match?.[1] ?? "";
};

export const shouldNormalizeImportedAudioFile = (file: File) => {
  const extension = getFileExtension(file.name);
  if (extension && PORTABLE_AUDIO_EXTENSIONS.has(extension)) {
    return false;
  }
  const mime = (file.type || "").toLowerCase();
  if (mime && PORTABLE_AUDIO_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return false;
  }
  return true;
};

const toWavFileName = (fileName: string) => {
  const nextBase = fileName.replace(/\.[^.]+$/, "");
  return `${nextBase || "audio"}.wav`;
};

const tryTranscodeToPortableFile = async (file: File) => {
  try {
    return await transcodeImportedAudioFile(file, "mp3");
  } catch (mp3Error) {
    console.warn("[audio-import] MP3 transcode failed, retrying WAV", {
      fileName: file.name,
      error: mp3Error,
    });
    try {
      return await transcodeImportedAudioFile(file, "wav");
    } catch (wavError) {
      console.warn("[audio-import] WAV transcode fallback failed", {
        fileName: file.name,
        error: wavError,
      });
      return null;
    }
  }
};

export const decodeAndNormalizeImportedAudio = async (
  file: File,
  decodeFile: DecodeFile
) => {
  const shouldNormalize = shouldNormalizeImportedAudioFile(file);
  let decodedBuffer: AudioBuffer | null = null;
  let decodeError: unknown = null;
  try {
    decodedBuffer = await decodeFile(file);
  } catch (error) {
    decodeError = error;
  }

  if (decodedBuffer && !shouldNormalize) {
    return {
      file,
      buffer: decodedBuffer,
      converted: false,
    };
  }

  if (decodedBuffer && shouldNormalize) {
    const transcoded = await tryTranscodeToPortableFile(file);
    if (transcoded) {
      try {
        const transcodedBuffer = await decodeFile(transcoded);
        return {
          file: transcoded,
          buffer: transcodedBuffer,
          converted: true,
        };
      } catch (transcodedDecodeError) {
        console.warn("[audio-import] Failed to decode transcoded file, falling back to WAV encode", {
          fileName: file.name,
          error: transcodedDecodeError,
        });
      }
    }
    const wavBlob = encodeWav(decodedBuffer);
    const normalizedFile = new File([wavBlob], toWavFileName(file.name), {
      type: "audio/wav",
      lastModified: file.lastModified,
    });
    return {
      file: normalizedFile,
      buffer: decodedBuffer,
      converted: true,
    };
  }

  const transcodedFromDecodeFailure = await tryTranscodeToPortableFile(file);
  if (transcodedFromDecodeFailure) {
    const transcodedBuffer = await decodeFile(transcodedFromDecodeFailure);
    return {
      file: transcodedFromDecodeFailure,
      buffer: transcodedBuffer,
      converted: true,
    };
  }

  throw decodeError ?? new Error(`Failed to decode audio import: ${file.name}`);
};
