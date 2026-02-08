import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipItem } from "../types/clip";
import type { DeckState } from "../types/deck";
import type { DeckSession, SessionFileState, SessionMeta, SessionState } from "../types/session";
import {
  AUTO_SESSION_ID,
  createSessionBlobId,
  createSessionId,
  listSessionMetas,
  loadSessionState,
  saveSessionState,
} from "../utils/sessionStore";
import { buildFxPanelPatch, loadFxPanelPatch, saveFxPanelPatch } from "../utils/fxPanelState";
import { createZip, readZip } from "../utils/zip";
import { encodeWavOffThread } from "../utils/wavWorkerClient";
import {
  inferAudioExtension,
  inferAudioMimeTypeFromPath,
  isSessionBrandNew,
} from "../utils/appHelpers";

export type UseSessionManagerArgs = {
  decks: DeckState[];
  clips: ClipItem[];
  clipsRef: React.MutableRefObject<ClipItem[]>;
  clipIdRef: React.MutableRefObject<number>;
  clipNameRef: React.MutableRefObject<number>;
  decodeFile: (file: File) => Promise<AudioBuffer>;
  getSessionDecks: () => DeckSession[];
  loadSessionDecks: (sessionDecks: DeckSession[], buffers: Map<number, AudioBuffer | null>) => void;
  resetDecks: () => void;
  masterGain: number;
  setMasterGainValue: (value: number) => void;
  applyDeckFxPanelStatePatch: (patch: Record<number, Record<string, boolean>>) => void;
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
};

type SessionManagerResult = {
  sessionBusy: boolean;
  sessionStatus: string | null;
  setSessionStatus: React.Dispatch<React.SetStateAction<string | null>>;
  sessionName: string;
  setSessionName: React.Dispatch<React.SetStateAction<string>>;
  welcomePanelDismissed: boolean;
  setWelcomePanelDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  sessions: SessionMeta[];
  selectedSessionId: string | null;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  importInputRef: React.MutableRefObject<HTMLInputElement | null>;
  zipDragOver: boolean;
  markSkipNextAutosave: () => void;
  handleExportSession: () => Promise<void>;
  handleSaveSession: () => Promise<void>;
  handleLoadSession: () => Promise<void>;
  handleNewSession: () => void;
  handleImportClick: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleOpenDemoLoop: () => Promise<void>;
  handleAppDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  handleAppDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  handleAppDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  handleAppDrop: (event: React.DragEvent<HTMLDivElement>) => Promise<void>;
};

const useSessionManager = ({
  decks,
  clips,
  clipsRef,
  clipIdRef,
  clipNameRef,
  decodeFile,
  getSessionDecks,
  loadSessionDecks,
  resetDecks,
  masterGain,
  setMasterGainValue,
  applyDeckFxPanelStatePatch,
  setClips,
}: UseSessionManagerArgs): SessionManagerResult => {
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [welcomePanelDismissed, setWelcomePanelDismissed] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [zipDragOver, setZipDragOver] = useState(false);
  const [autosaveReady, setAutosaveReady] = useState(false);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const skipInitialAutosaveHydrationRef = useRef(false);
  const zipDragDepthRef = useRef(0);
  const skipNextAutosaveRef = useRef(0);
  const autosaveReadyRef = useRef(false);
  const applySessionDataRef = useRef<
    ((session: SessionState, blobs: Map<string, Blob>) => Promise<void>) | null
  >(null);

  const refreshSessions = useCallback(async () => {
    const list = await listSessionMetas();
    setSessions(list);
    if (!selectedSessionId && list.length > 0) {
      setSelectedSessionId(list[0].id);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const encodeDecksForSession = useCallback(async () => {
    const sessionDecks = getSessionDecks();
    const blobs = new Map<string, Blob>();
    const decksWithBlobs = await Promise.all(
      sessionDecks.map(async (deckSession) => {
        const deck = decks.find((item) => item.id === deckSession.id);
        if (!deck?.buffer) {
          return deckSession;
        }
        const wav = await encodeWavOffThread(deck.buffer);
        const blobId = createSessionBlobId("deck");
        blobs.set(blobId, wav);
        return { ...deckSession, wavBlobId: blobId };
      })
    );

    return { decks: decksWithBlobs, blobs };
  }, [decks, getSessionDecks]);

  const encodeClipsForSession = useCallback(
    async (existingBlobs: Map<string, Blob>) => {
      const nextBlobs = new Map(existingBlobs);
      const clipSessions = [] as SessionState["clips"];

      for (const clip of clips) {
        const blobId = createSessionBlobId("clip");
        nextBlobs.set(blobId, clip.blob);
        const mimeType = clip.blob.type || "audio/wav";
        const ext = inferAudioExtension(mimeType, "wav");
        clipSessions.push({
          id: clip.id,
          name: clip.name,
          durationSec: clip.durationSec,
          gain: clip.gain,
          balance: clip.balance,
          pitchShift: clip.pitchShift,
          tempoOffset: clip.tempoOffset ?? 0,
          audioBlobId: blobId,
          audioMimeType: mimeType,
          audioFileName: `${clip.name}.${ext}`,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? false,
        });
      }

      return { clipSessions, blobs: nextBlobs };
    },
    [clips]
  );

  const encodeForExport = useCallback(async () => {
    const { decks: sessionDecks, blobs: deckBlobs } = await encodeDecksForSession();
    const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
    const nextName = sessionName.trim() || `Session ${new Date().toLocaleString()}`;
    const sessionFile: SessionFileState = {
      version: 1,
      name: nextName,
      savedAt: Date.now(),
      masterGain,
      welcomePanelDismissed,
      decks: sessionDecks.map((deck) => {
        const { wavBlobId: _wavBlobId, ...rest } = deck;
        return {
          ...rest,
          wavFile: _wavBlobId ? `audio/deck-${deck.id}.wav` : undefined,
        };
      }),
      clips: clipSessions.map((clip) => {
        const { audioBlobId: _audioBlobId, wavBlobId: _wavBlobId, ...rest } = clip;
        const ext = inferAudioExtension(clip.audioMimeType, "wav");
        return {
          ...rest,
          audioFile: `audio/clip-${clip.id}.${ext}`,
        };
      }),
    };

    const fileEntries: Array<{ path: string; data: Uint8Array }> = [];
    fileEntries.push({
      path: "session.json",
      data: new TextEncoder().encode(JSON.stringify(sessionFile)),
    });

    for (const deck of sessionDecks) {
      if (!deck.wavBlobId) continue;
      const wavFile = `audio/deck-${deck.id}.wav`;
      const blob = blobs.get(deck.wavBlobId);
      if (!blob) continue;
      fileEntries.push({
        path: wavFile,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    for (const clip of clipSessions) {
      const blobId = clip.audioBlobId ?? clip.wavBlobId;
      if (!blobId) continue;
      const ext = inferAudioExtension(clip.audioMimeType, "wav");
      const audioFile = `audio/clip-${clip.id}.${ext}`;
      const blob = blobs.get(blobId);
      if (!blob) continue;
      fileEntries.push({
        path: audioFile,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    return { sessionFile, entries: fileEntries };
  }, [encodeClipsForSession, encodeDecksForSession, masterGain, sessionName, welcomePanelDismissed]);

  const handleExportSession = useCallback(async () => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const { sessionFile, entries } = await encodeForExport();
      const zip = createZip(entries);
      const url = URL.createObjectURL(zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sessionFile.name.replace(/[^\w-]+/g, "-") || "session"}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSessionStatus(`Exported "${sessionFile.name}".`);
    } catch (error) {
      console.error("Failed to export session", error);
      setSessionStatus("Session export failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [encodeForExport, sessionBusy]);

  const importSessionFiles = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const files = readZip(buffer);
      const sessionEntry = files.get("session.json");
      if (!sessionEntry) {
        throw new Error("Missing session.json");
      }
      const sessionFile = JSON.parse(new TextDecoder().decode(sessionEntry)) as SessionFileState;
      if (sessionFile.version !== 1) {
        throw new Error("Unsupported session version");
      }
      const buffers = new Map<number, AudioBuffer | null>();
      const toArrayBuffer = (data: Uint8Array) => data.slice().buffer as ArrayBuffer;
      for (const deck of sessionFile.decks) {
        if (!deck.wavFile) {
          buffers.set(deck.id, null);
          continue;
        }
        const data = files.get(deck.wavFile);
        if (!data) {
          buffers.set(deck.id, null);
          continue;
        }
        const blob = new Blob([toArrayBuffer(data)], { type: "audio/wav" });
        const wavFile = new File([blob], deck.fileName ?? `Deck ${deck.id}.wav`, {
          type: "audio/wav",
        });
        const audioBuffer = await decodeFile(wavFile);
        buffers.set(deck.id, audioBuffer);
      }

      const sessionDecks: DeckSession[] = sessionFile.decks.map((deck) => ({
        ...deck,
        wavBlobId: undefined,
      }));

      loadSessionDecks(sessionDecks, buffers);

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
      const nextClips: ClipItem[] = [];
      let maxClipId = 0;
      for (const clip of sessionFile.clips) {
        const audioPath = clip.audioFile ?? clip.wavFile;
        if (!audioPath) continue;
        const data = files.get(audioPath);
        if (!data) continue;
        const mimeType = clip.audioMimeType ?? inferAudioMimeTypeFromPath(audioPath, "audio/wav");
        const blob = new Blob([toArrayBuffer(data)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        nextClips.push({
          id: clip.id,
          name: clip.name,
          blob,
          url,
          durationSec: clip.durationSec,
          gain: clip.gain,
          balance: clip.balance ?? 0,
          pitchShift: clip.pitchShift ?? 0,
          tempoOffset: clip.tempoOffset ?? 0,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? Boolean(clip.settings),
        });
        maxClipId = Math.max(maxClipId, clip.id);
      }
      setClips(nextClips);
      clipIdRef.current = Math.max(1, maxClipId + 1);
      clipNameRef.current = Math.max(1, maxClipId + 1);
      setMasterGainValue(sessionFile.masterGain ?? 0.9);
      setSessionName(sessionFile.name);
      setWelcomePanelDismissed(
        sessionFile.welcomePanelDismissed ?? !isSessionBrandNew({
          decks: sessionDecks,
          clips: sessionFile.clips,
        })
      );
      setSessionStatus(`Imported "${sessionFile.name}".`);
    },
    [decodeFile, loadSessionDecks, clipsRef, setClips, clipIdRef, clipNameRef, setMasterGainValue]
  );

  const handleSaveSession = useCallback(async () => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const { decks: sessionDecks, blobs: deckBlobs } = await encodeDecksForSession();
      const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
      const nextName = sessionName.trim() || `Session ${new Date().toLocaleString()}`;
      const id = createSessionId();
      const session: SessionState = {
        version: 1,
        id,
        name: nextName,
        savedAt: Date.now(),
        masterGain,
        welcomePanelDismissed,
        decks: sessionDecks,
        clips: clipSessions,
      };
      await saveSessionState(session, blobs);
      await refreshSessions();
      setSelectedSessionId(id);
      setSessionName(nextName);
      setSessionStatus(`Saved "${nextName}".`);
    } catch (error) {
      console.error("Failed to save session", error);
      setSessionStatus("Session save failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [
    encodeClipsForSession,
    encodeDecksForSession,
    refreshSessions,
    masterGain,
    sessionBusy,
    sessionName,
    welcomePanelDismissed,
  ]);

  useEffect(() => {
    if (!autosaveReady) return;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }
    if (skipNextAutosaveRef.current > 0) {
      skipNextAutosaveRef.current -= 1;
      return;
    }
    autosaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const { decks: sessionDecks, blobs: deckBlobs } = await encodeDecksForSession();
        const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
        const session: SessionState = {
          version: 1,
          id: AUTO_SESSION_ID,
          name: sessionName.trim() || "Untitled",
          savedAt: Date.now(),
          masterGain,
          welcomePanelDismissed,
          decks: sessionDecks,
          clips: clipSessions,
        };
        await saveSessionState(session, blobs);
      } catch (error) {
        console.error("Autosave failed", error);
      }
    }, 1200);
    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [
    autosaveReady,
    clips,
    decks,
    encodeClipsForSession,
    encodeDecksForSession,
    masterGain,
    sessionName,
    welcomePanelDismissed,
  ]);

  const decodeSessionDecks = useCallback(
    async (sessionDecks: DeckSession[], blobs: Map<string, Blob>) => {
      const buffers = new Map<number, AudioBuffer | null>();
      for (const deck of sessionDecks) {
        if (!deck.wavBlobId) {
          buffers.set(deck.id, null);
          continue;
        }
        const blob = blobs.get(deck.wavBlobId);
        if (!blob) {
          buffers.set(deck.id, null);
          continue;
        }
        const file = new File([blob], deck.fileName ?? `Deck ${deck.id}.wav`, {
          type: blob.type || "audio/wav",
        });
        const buffer = await decodeFile(file);
        buffers.set(deck.id, buffer);
      }
      return buffers;
    },
    [decodeFile]
  );

  const applySessionData = useCallback(
    async (session: SessionState, blobs: Map<string, Blob>) => {
      const buffers = await decodeSessionDecks(session.decks, blobs);
      loadSessionDecks(session.decks, buffers);

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
      const nextClips: ClipItem[] = [];
      let maxClipId = 0;
      for (const clip of session.clips) {
        const blobId = clip.audioBlobId ?? clip.wavBlobId;
        if (!blobId) continue;
        const blob = blobs.get(blobId);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        nextClips.push({
          id: clip.id,
          name: clip.name,
          blob,
          url,
          durationSec: clip.durationSec,
          gain: clip.gain,
          balance: clip.balance ?? 0,
          pitchShift: clip.pitchShift ?? 0,
          tempoOffset: clip.tempoOffset ?? 0,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? Boolean(clip.settings),
        });
        maxClipId = Math.max(maxClipId, clip.id);
      }
      setClips(nextClips);
      clipIdRef.current = Math.max(1, maxClipId + 1);
      clipNameRef.current = Math.max(1, maxClipId + 1);
      setMasterGainValue(session.masterGain ?? 0.9);
      setSessionName(session.name);
      setWelcomePanelDismissed(session.welcomePanelDismissed ?? !isSessionBrandNew(session));
    },
    [decodeSessionDecks, loadSessionDecks, clipsRef, setClips, clipIdRef, clipNameRef, setMasterGainValue]
  );

  applySessionDataRef.current = applySessionData;

  useEffect(() => {
    const loadAutosave = async () => {
      const fxPanelPatch = loadFxPanelPatch();
      const loaded = await loadSessionState(AUTO_SESSION_ID);
      if (skipInitialAutosaveHydrationRef.current) {
        applyDeckFxPanelStatePatch(fxPanelPatch);
        autosaveReadyRef.current = true;
        setAutosaveReady(true);
        return;
      }
      if (!loaded) {
        applyDeckFxPanelStatePatch(fxPanelPatch);
        autosaveReadyRef.current = true;
        setAutosaveReady(true);
        return;
      }
      if (skipInitialAutosaveHydrationRef.current) {
        applyDeckFxPanelStatePatch(fxPanelPatch);
        autosaveReadyRef.current = true;
        setAutosaveReady(true);
        return;
      }
      await applySessionDataRef.current?.(loaded.session, loaded.blobs);
      applyDeckFxPanelStatePatch(fxPanelPatch);
      autosaveReadyRef.current = true;
      setAutosaveReady(true);
    };
    void loadAutosave();
  }, [applyDeckFxPanelStatePatch]);

  useEffect(() => {
    if (!autosaveReady) return;
    saveFxPanelPatch(buildFxPanelPatch(decks));
  }, [autosaveReady, decks]);

  const handleLoadSession = useCallback(async () => {
    if (sessionBusy) return;
    if (!selectedSessionId) {
      setSessionStatus("Select a session to load.");
      return;
    }
    skipInitialAutosaveHydrationRef.current = true;
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const loaded = await loadSessionState(selectedSessionId);
      if (!loaded) {
        setSessionStatus("Session not found.");
        return;
      }

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));

      const { session, blobs } = loaded;
      await applySessionData(session, blobs);
      setSessionStatus(`Loaded "${session.name}".`);
    } catch (error) {
      console.error("Failed to load session", error);
      setSessionStatus("Session load failed.");
    } finally {
      setSessionBusy(false);
    }
  }, [applySessionData, selectedSessionId, sessionBusy, clipsRef]);

  const handleNewSession = useCallback(() => {
    if (!window.confirm("Start a new session? This will clear the current session.")) {
      return;
    }
    skipInitialAutosaveHydrationRef.current = true;
    resetDecks();
    clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
    setClips([]);
    clipIdRef.current = 1;
    clipNameRef.current = 1;
    setMasterGainValue(0.9);
    setSessionName("");
    setSelectedSessionId(null);
    setSessionStatus(null);
  }, [resetDecks, clipsRef, setClips, clipIdRef, clipNameRef, setMasterGainValue]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const importSessionFromFile = useCallback(
    async (file: File) => {
      if (sessionBusy) return;
      skipInitialAutosaveHydrationRef.current = true;
      setSessionBusy(true);
      setSessionStatus(null);
      try {
        await importSessionFiles(file);
      } catch (error) {
        console.error("Failed to import session", error);
        setSessionStatus("Session import failed.");
      } finally {
        setSessionBusy(false);
      }
    },
    [importSessionFiles, sessionBusy]
  );

  const handleImportChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      await importSessionFromFile(file);
    },
    [importSessionFromFile]
  );

  const handleOpenDemoLoop = useCallback(async () => {
    try {
      const response = await fetch("/example.zip");
      if (!response.ok) {
        throw new Error(`Failed to fetch demo zip: ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], "example.zip", {
        type: blob.type || "application/zip",
      });
      await importSessionFromFile(file);
    } catch (error) {
      console.error("Failed to open demo loop", error);
      setSessionStatus("Failed to open demo loop.");
    }
  }, [importSessionFromFile]);

  const hasFileDrag = useCallback(
    (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes("Files"),
    []
  );

  const findZipFile = useCallback((files: File[] | FileList | null | undefined) => {
    if (!files) return null;
    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".zip") || file.type === "application/zip") {
        return file;
      }
    }
    return null;
  }, []);

  const hasLikelyZipDrag = useCallback((dataTransfer: DataTransfer) => {
    if (!hasFileDrag(dataTransfer)) return false;
    if (findZipFile(dataTransfer.files)) return true;
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") continue;
      if (item.type === "application/zip" || item.type === "application/x-zip-compressed") {
        return true;
      }
    }
    return false;
  }, [findZipFile, hasFileDrag]);

  const handleAppDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    zipDragDepthRef.current += 1;
    if (hasLikelyZipDrag(event.dataTransfer)) {
      setZipDragOver(true);
    }
  }, [hasFileDrag, hasLikelyZipDrag]);

  const handleAppDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!zipDragOver && hasLikelyZipDrag(event.dataTransfer)) {
      setZipDragOver(true);
    }
  }, [hasFileDrag, hasLikelyZipDrag, zipDragOver]);

  const handleAppDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    zipDragDepthRef.current = Math.max(0, zipDragDepthRef.current - 1);
    if (zipDragDepthRef.current === 0) {
      setZipDragOver(false);
    }
  }, [hasFileDrag]);

  const handleAppDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      zipDragDepthRef.current = 0;
      setZipDragOver(false);
      const file = findZipFile(event.dataTransfer.files);
      if (!file) return;
      await importSessionFromFile(file);
    },
    [findZipFile, hasFileDrag, importSessionFromFile]
  );

  const markSkipNextAutosave = useCallback(() => {
    skipNextAutosaveRef.current += 1;
  }, []);

  return {
    sessionBusy,
    sessionStatus,
    setSessionStatus,
    sessionName,
    setSessionName,
    welcomePanelDismissed,
    setWelcomePanelDismissed,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    importInputRef,
    zipDragOver,
    markSkipNextAutosave,
    handleExportSession,
    handleSaveSession,
    handleLoadSession,
    handleNewSession,
    handleImportClick,
    handleImportChange,
    handleOpenDemoLoop,
    handleAppDragEnter,
    handleAppDragOver,
    handleAppDragLeave,
    handleAppDrop,
  };
};

export default useSessionManager;
