type ImportTranscodeTarget = "mp3" | "wav";
import ffmpegCoreJsUrl from "@ffmpeg/core?url";
import ffmpegCoreWasmUrl from "@ffmpeg/core/wasm?url";

let ffmpegLoadPromise: Promise<void> | null = null;
let ffmpegInstancePromise: Promise<{
  ffmpeg: {
    load: (config?: {
      coreURL?: string;
      wasmURL?: string;
      workerURL?: string;
    }) => Promise<boolean>;
    writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
    exec: (args: string[]) => Promise<number>;
    readFile: (path: string) => Promise<Uint8Array | string>;
    deleteFile: (path: string) => Promise<boolean>;
  };
  fetchFile: (file: File | Blob | string) => Promise<Uint8Array>;
}> | null = null;

const getBaseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || "audio";

const loadFfmpeg = async () => {
  if (ffmpegInstancePromise) return ffmpegInstancePromise;
  ffmpegInstancePromise = (async () => {
    const [{ FFmpeg }, { fetchFile }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);
    const ffmpeg = new FFmpeg();

    ffmpegLoadPromise ??= (async () => {
      await ffmpeg.load({
        coreURL: ffmpegCoreJsUrl,
        wasmURL: ffmpegCoreWasmUrl,
      });
    })();

    await ffmpegLoadPromise;
    return { ffmpeg, fetchFile };
  })();
  return ffmpegInstancePromise;
};

const safeDelete = async (
  ffmpeg: {
    deleteFile: (path: string) => Promise<boolean>;
  },
  path: string
) => {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Ignore cleanup failures; they should not mask decode/import success.
  }
};

const buildOutputMeta = (fileName: string, target: ImportTranscodeTarget) => {
  if (target === "mp3") {
    return {
      name: `${getBaseName(fileName)}.mp3`,
      mimeType: "audio/mpeg",
      ffmpegArgs: ["-vn", "-codec:a", "libmp3lame", "-b:a", "192k"] as string[],
    };
  }
  return {
    name: `${getBaseName(fileName)}.wav`,
    mimeType: "audio/wav",
    ffmpegArgs: ["-vn", "-c:a", "pcm_s16le"] as string[],
  };
};

export const transcodeImportedAudioFile = async (
  file: File,
  target: ImportTranscodeTarget
): Promise<File> => {
  if (typeof window === "undefined") {
    throw new Error("ffmpeg import transcoding is only available in the browser");
  }
  const { ffmpeg, fetchFile } = await loadFfmpeg();
  const inputName = `input-${Date.now()}-${Math.random().toString(36).slice(2)}.${(
    /\.([^.]+)$/.exec(file.name)?.[1] ?? "bin"
  ).toLowerCase()}`;
  const outputMeta = buildOutputMeta(file.name, target);
  const outputName = `output-${Date.now()}-${Math.random().toString(36).slice(2)}.${target}`;
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  try {
    const exitCode = await ffmpeg.exec(["-i", inputName, ...outputMeta.ffmpegArgs, outputName]);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }
    const data = await ffmpeg.readFile(outputName);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const blobBytes = new Uint8Array(bytes);
    return new File([blobBytes], outputMeta.name, {
      type: outputMeta.mimeType,
      lastModified: file.lastModified,
    });
  } finally {
    await Promise.all([safeDelete(ffmpeg, inputName), safeDelete(ffmpeg, outputName)]);
  }
};
