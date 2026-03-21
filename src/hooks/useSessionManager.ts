import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipItem } from "../types/clip";
import type { DeckState } from "../types/deck";
import type {
  DeckSession,
  HydratedRearrangerSnapshotSession,
  SessionFileDeck,
  SessionFileState,
  SessionMeta,
  SessionState,
} from "../types/session";
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
import { serializeDeckSession } from "./deckSessionSerialization";
import {
  inferAudioExtension,
  inferAudioMimeTypeFromPath,
  isSessionBrandNew,
} from "../utils/appHelpers";
import type { SessionDeckUndoRedoHistory } from "../types/session";

export type UseSessionManagerArgs = {
  decks: DeckState[];
  clips: ClipItem[];
  clipsRef: React.MutableRefObject<ClipItem[]>;
  clipIdRef: React.MutableRefObject<number>;
  clipNameRef: React.MutableRefObject<number>;
  decodeFile: (file: File) => Promise<AudioBuffer>;
  getSessionDecks: () => DeckSession[];
  getDeckUndoRedoHistorySnapshots: () => { past: DeckState[][]; future: DeckState[][] };
  loadSessionDecks: (
    sessionDecks: DeckSession[],
    buffers: Map<number, AudioBuffer | null>,
    options?: {
      deckUndoRedoHistory?: SessionDeckUndoRedoHistory;
      historyBuffers?: Map<string, AudioBuffer | null>;
    }
  ) => void;
  resetDecks: () => void;
  masterGain: number;
  setMasterGainValue: (value: number) => void;
  applyDeckFxPanelStatePatch: (patch: Record<number, Record<string, boolean>>) => void;
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  getRearrangerSnapshotsForSessionRef: React.MutableRefObject<
    (() => Map<number, HydratedRearrangerSnapshotSession>) | null
  >;
  loadRearrangerSnapshotsFromSessionRef: React.MutableRefObject<
    ((snapshots: Map<number, HydratedRearrangerSnapshotSession>) => void) | null
  >;
};

type SessionManagerResult = {
  sessionBusy: boolean;
  sessionStatus: string | null;
  setSessionStatus: React.Dispatch<React.SetStateAction<string | null>>;
  sessionName: string;
  setSessionName: React.Dispatch<React.SetStateAction<string>>;
  lastSavedAt: number | null;
  welcomePanelDismissed: boolean;
  setWelcomePanelDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  sessions: SessionMeta[];
  selectedSessionId: string | null;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  importInputRef: React.MutableRefObject<HTMLInputElement | null>;
  zipDragOver: boolean;
  markSkipNextAutosave: () => void;
  triggerAutosaveNow: () => Promise<void>;
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
  getDeckUndoRedoHistorySnapshots,
  loadSessionDecks,
  resetDecks,
  masterGain,
  setMasterGainValue,
  applyDeckFxPanelStatePatch,
  setClips,
  getRearrangerSnapshotsForSessionRef,
  loadRearrangerSnapshotsFromSessionRef,
}: UseSessionManagerArgs): SessionManagerResult => {
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
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
  const saveAutoSessionNowRef = useRef<(() => Promise<void>) | null>(null);
  const wasAllLoadedDecksPausedRef = useRef(false);
  const deckBlobIdsRef = useRef(new WeakMap<AudioBuffer, string>());
  const deckWavCacheRef = useRef(new WeakMap<AudioBuffer, Blob>());
  const clipBlobIdsRef = useRef(new WeakMap<Blob, string>());
  const currentSessionIdRef = useRef<string | null>(null);
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
    const deckHistorySnapshots = getDeckUndoRedoHistorySnapshots();
    const rearrangerSnapshots = getRearrangerSnapshotsForSessionRef.current?.() ?? new Map();
    const blobs = new Map<string, Blob>();
    const deckBlobIds = deckBlobIdsRef.current;
    const deckWavCache = deckWavCacheRef.current;
    const currentDeckById = new Map(decks.map((deck) => [deck.id, deck]));

    const encodeDeckAudio = async (buffer: AudioBuffer) => {
      const existingBlobId = deckBlobIds.get(buffer);
      if (existingBlobId) {
        const cachedWav = deckWavCache.get(buffer);
        if (cachedWav) {
          blobs.set(existingBlobId, cachedWav);
          return existingBlobId;
        }
        const wav = await encodeWavOffThread(buffer);
        deckWavCache.set(buffer, wav);
        blobs.set(existingBlobId, wav);
        return existingBlobId;
      }
      const wav = await encodeWavOffThread(buffer);
      const blobId = createSessionBlobId("deck");
      blobs.set(blobId, wav);
      deckBlobIds.set(buffer, blobId);
      deckWavCache.set(buffer, wav);
      return blobId;
    };

    const encodeDeckSessionWithBuffer = async (
      deckSession: DeckSession,
      buffer: AudioBuffer | undefined
    ): Promise<DeckSession> => {
      if (!buffer) return deckSession;
      const wavBlobId = await encodeDeckAudio(buffer);
      return { ...deckSession, wavBlobId };
    };

    const decksWithBlobs = await Promise.all(
      sessionDecks.map(async (deckSession) => {
        const encodedDeck = await encodeDeckSessionWithBuffer(
          deckSession,
          currentDeckById.get(deckSession.id)?.buffer
        );
        const snapshot = rearrangerSnapshots.get(deckSession.id);
        if (!snapshot) return encodedDeck;
        const wavBlobId = await encodeDeckAudio(snapshot.buffer);
        return {
          ...encodedDeck,
          rearrangerSnapshot: {
            capturedAtMs: snapshot.capturedAtMs,
            fileName: snapshot.fileName,
            loopStartSeconds: snapshot.loopStartSeconds,
            loopEndSeconds: snapshot.loopEndSeconds,
            rearrangerSlices: snapshot.rearrangerSlices,
            rearrangerRegions: snapshot.rearrangerRegions,
            rearrangerRegionIds: snapshot.rearrangerRegionIds,
            rearrangerRegionsManual: snapshot.rearrangerRegionsManual,
            wavBlobId,
          },
        };
      })
    );

    const serializeHistorySnapshot = async (snapshot: DeckState[]) => {
      const serialized = snapshot.map((deck) => serializeDeckSession(deck, undefined));
      return Promise.all(
        serialized.map((deckSession, index) =>
          encodeDeckSessionWithBuffer(deckSession, snapshot[index]?.buffer)
        )
      );
    };

    const deckUndoRedoHistory =
      deckHistorySnapshots.past.length > 0 || deckHistorySnapshots.future.length > 0
        ? {
            past: await Promise.all(deckHistorySnapshots.past.map(serializeHistorySnapshot)),
            future: await Promise.all(deckHistorySnapshots.future.map(serializeHistorySnapshot)),
          }
        : undefined;

    return { decks: decksWithBlobs, deckUndoRedoHistory, blobs };
  }, [decks, getDeckUndoRedoHistorySnapshots, getRearrangerSnapshotsForSessionRef, getSessionDecks]);

  const encodeClipsForSession = useCallback(
    async (existingBlobs: Map<string, Blob>) => {
      const nextBlobs = new Map(existingBlobs);
      const clipSessions = [] as SessionState["clips"];
      const clipBlobIds = clipBlobIdsRef.current;

      for (const clip of clips) {
        const existingBlobId = clipBlobIds.get(clip.blob);
        const blobId = existingBlobId ?? createSessionBlobId("clip");
        if (!existingBlobId) {
          clipBlobIds.set(clip.blob, blobId);
        }
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
    const {
      decks: sessionDecks,
      deckUndoRedoHistory,
      blobs: deckBlobs,
    } = await encodeDecksForSession();
    const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
    const nextName = sessionName.trim() || `Session ${new Date().toLocaleString()}`;
    const toSessionFileDeck = (deck: DeckSession): SessionFileDeck => {
      const { wavBlobId: _wavBlobId, rearrangerSnapshot, ...rest } = deck;
      return {
        ...rest,
        wavFile: _wavBlobId ? `audio/deck-blob-${_wavBlobId}.wav` : undefined,
        rearrangerSnapshot: rearrangerSnapshot
          ? {
              ...rearrangerSnapshot,
              wavFile: rearrangerSnapshot.wavBlobId
                ? `audio/rearranger-snapshot-${rearrangerSnapshot.wavBlobId}.wav`
                : undefined,
            }
          : undefined,
      };
    };
    const sessionFile: SessionFileState = {
      version: 1,
      name: nextName,
      savedAt: Date.now(),
      masterGain,
      welcomePanelDismissed,
      decks: sessionDecks.map(toSessionFileDeck),
      deckUndoRedoHistory: deckUndoRedoHistory
        ? {
            past: deckUndoRedoHistory.past.map((snapshot) => snapshot.map(toSessionFileDeck)),
            future: deckUndoRedoHistory.future.map((snapshot) => snapshot.map(toSessionFileDeck)),
          }
        : undefined,
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
      const wavFile = `audio/deck-blob-${deck.wavBlobId}.wav`;
      const blob = blobs.get(deck.wavBlobId);
      if (!blob) continue;
      fileEntries.push({
        path: wavFile,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    for (const deck of sessionDecks) {
      const wavBlobId = deck.rearrangerSnapshot?.wavBlobId;
      if (!wavBlobId) continue;
      const wavFile = `audio/rearranger-snapshot-${wavBlobId}.wav`;
      if (fileEntries.some((entry) => entry.path === wavFile)) continue;
      const blob = blobs.get(wavBlobId);
      if (!blob) continue;
      fileEntries.push({
        path: wavFile,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    if (deckUndoRedoHistory) {
      const historyDecks = [...deckUndoRedoHistory.past.flat(), ...deckUndoRedoHistory.future.flat()];
      for (const deck of historyDecks) {
        if (!deck.wavBlobId) continue;
        const wavFile = `audio/deck-blob-${deck.wavBlobId}.wav`;
        if (fileEntries.some((entry) => entry.path === wavFile)) continue;
        const blob = blobs.get(deck.wavBlobId);
        if (!blob) continue;
        fileEntries.push({
          path: wavFile,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }
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
      const toNumericDeckId = (value: unknown, fallback: number) => {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
          return Math.round(numeric);
        }
        return fallback;
      };
      const normalizedZipEntries = Array.from(files.entries()).map(([key, data]) => ({
        key,
        normalizedKey: key.replace(/\\/g, "/").replace(/^\.?\//, ""),
        data,
      }));
      const findZipEntry = (path: string | undefined) => {
        if (!path) return undefined;
        const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "");
        const candidates = [path, normalized, decodeURIComponent(normalized)].map((value) =>
          value.replace(/\\/g, "/").replace(/^\.?\//, "")
        );
        for (const candidate of candidates) {
          if (!candidate) continue;
          const exact = files.get(candidate);
          if (exact) return exact;
          const normalizedExact = normalizedZipEntries.find(
            (entry) => entry.normalizedKey === candidate
          );
          if (normalizedExact) return normalizedExact.data;
          const suffix = normalizedZipEntries.find((entry) =>
            entry.normalizedKey.endsWith(`/${candidate}`)
          );
          if (suffix) return suffix.data;
          const basename = candidate.split("/").pop();
          if (basename) {
            const basenameMatch = normalizedZipEntries.find((entry) =>
              entry.normalizedKey.endsWith(`/${basename}`)
            );
            if (basenameMatch) return basenameMatch.data;
          }
        }
        return undefined;
      };
      const normalizeDeckFromFile = (deck: SessionFileDeck, index: number) => {
        const legacyDeck = deck as SessionFileDeck & { wavBlobId?: string };
        const id = toNumericDeckId((deck as { id?: unknown }).id, index + 1);
        const wavFile =
          deck.wavFile ??
          (legacyDeck.wavBlobId ? `audio/deck-blob-${legacyDeck.wavBlobId}.wav` : undefined);
        return {
          ...deck,
          id,
          wavFile,
        };
      };
      const normalizedDecks = sessionFile.decks.map(normalizeDeckFromFile);
      const deckAudioZipPaths = normalizedZipEntries
        .map((entry) => entry.normalizedKey)
        .filter((key) => /(?:^|\/)audio\/.*deck.*\.wav$/i.test(key))
        .sort((a, b) => a.localeCompare(b));
      let fallbackDeckAudioIndex = 0;
      const buffers = new Map<number, AudioBuffer | null>();
      let resolvedDeckAudioCount = 0;
      const toArrayBuffer = (data: Uint8Array) => data.slice().buffer as ArrayBuffer;
      for (const deck of normalizedDecks) {
        const mappedFallbackPath = deckAudioZipPaths[fallbackDeckAudioIndex];
        const requestedPath = deck.wavFile ?? mappedFallbackPath;
        if (!requestedPath) {
          buffers.set(deck.id, null);
          continue;
        }
        const data = findZipEntry(requestedPath);
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
        resolvedDeckAudioCount += 1;
        if (!deck.wavFile && mappedFallbackPath) {
          fallbackDeckAudioIndex += 1;
        }
      }
      if (normalizedDecks.length > 0 && resolvedDeckAudioCount === 0) {
        console.warn("Session import found no deck audio entries", {
          requestedDeckFiles: normalizedDecks.map((deck) => deck.wavFile).filter(Boolean),
          availableZipEntries: normalizedZipEntries.map((entry) => entry.key),
        });
      }

      const sessionDecks: DeckSession[] = normalizedDecks.map((deck) => ({
        ...deck,
        wavBlobId: undefined,
        rearrangerSnapshot: deck.rearrangerSnapshot
          ? {
              ...deck.rearrangerSnapshot,
              wavBlobId: deck.rearrangerSnapshot.wavFile,
            }
          : undefined,
      }));
      const sessionDeckHistory: SessionDeckUndoRedoHistory | undefined = sessionFile.deckUndoRedoHistory
        ? {
            past: sessionFile.deckUndoRedoHistory.past.map((snapshot) =>
              snapshot.map((deck) => ({
                ...deck,
                wavBlobId: deck.wavFile,
              }))
            ),
            future: sessionFile.deckUndoRedoHistory.future.map((snapshot) =>
              snapshot.map((deck) => ({
                ...deck,
                wavBlobId: deck.wavFile,
              }))
            ),
          }
        : undefined;
      const historyBuffers = new Map<string, AudioBuffer | null>();
      if (sessionFile.deckUndoRedoHistory) {
        const historyDecks = [
          ...sessionFile.deckUndoRedoHistory.past.flat(),
          ...sessionFile.deckUndoRedoHistory.future.flat(),
        ];
        for (const historyDeck of historyDecks) {
          const deck = normalizeDeckFromFile(historyDeck, 0);
          if (!deck.wavFile || historyBuffers.has(deck.wavFile)) continue;
          const data = findZipEntry(deck.wavFile);
          if (!data) {
            historyBuffers.set(deck.wavFile, null);
            continue;
          }
          const blob = new Blob([toArrayBuffer(data)], { type: "audio/wav" });
          const wavFile = new File([blob], deck.fileName ?? `Deck ${deck.id}.wav`, {
            type: "audio/wav",
          });
          const audioBuffer = await decodeFile(wavFile);
          historyBuffers.set(deck.wavFile, audioBuffer);
        }
      }

      const rearrangerSnapshots = new Map<number, HydratedRearrangerSnapshotSession>();
      for (const deck of normalizedDecks) {
        const snapshot = deck.rearrangerSnapshot;
        if (!snapshot?.wavFile) continue;
        const data = findZipEntry(snapshot.wavFile);
        if (!data) continue;
        const blob = new Blob([toArrayBuffer(data)], { type: "audio/wav" });
        const wavFile = new File(
          [blob],
          snapshot.fileName ?? deck.fileName ?? `Deck ${deck.id} Snapshot.wav`,
          { type: "audio/wav" }
        );
        const audioBuffer = await decodeFile(wavFile);
        rearrangerSnapshots.set(deck.id, {
          buffer: audioBuffer,
          capturedAtMs: snapshot.capturedAtMs,
          fileName: snapshot.fileName,
          loopStartSeconds: snapshot.loopStartSeconds,
          loopEndSeconds: snapshot.loopEndSeconds,
          rearrangerSlices: snapshot.rearrangerSlices,
          rearrangerRegions: snapshot.rearrangerRegions,
          rearrangerRegionIds: snapshot.rearrangerRegionIds,
          rearrangerRegionsManual: snapshot.rearrangerRegionsManual,
        });
      }

      loadSessionDecks(sessionDecks, buffers, {
        deckUndoRedoHistory: sessionDeckHistory,
        historyBuffers,
      });
      loadRearrangerSnapshotsFromSessionRef.current?.(rearrangerSnapshots);

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
      const nextClips: ClipItem[] = [];
      let maxClipId = 0;
      for (const clip of sessionFile.clips) {
        const audioPath = clip.audioFile ?? clip.wavFile;
        if (!audioPath) continue;
        const data = findZipEntry(audioPath);
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
      setLastSavedAt(sessionFile.savedAt ?? null);
      currentSessionIdRef.current = null;
      setSelectedSessionId(null);
      setWelcomePanelDismissed(
        sessionFile.welcomePanelDismissed ?? !isSessionBrandNew({
          decks: sessionDecks,
          clips: sessionFile.clips,
        })
      );
      setSessionStatus(
        `Imported "${sessionFile.name}" (${resolvedDeckAudioCount}/${normalizedDecks.length} deck audio).`
      );
    },
    [
      decodeFile,
      loadRearrangerSnapshotsFromSessionRef,
      loadSessionDecks,
      clipsRef,
      setClips,
      clipIdRef,
      clipNameRef,
      setMasterGainValue,
    ]
  );

  const handleSaveSession = useCallback(async () => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setSessionStatus(null);
    try {
      const {
        decks: sessionDecks,
        deckUndoRedoHistory,
        blobs: deckBlobs,
      } = await encodeDecksForSession();
      const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
      const nextName = sessionName.trim() || `Session ${new Date().toLocaleString()}`;
      const id = currentSessionIdRef.current ?? createSessionId();
      const session: SessionState = {
        version: 1,
        id,
        name: nextName,
        savedAt: Date.now(),
        masterGain,
        welcomePanelDismissed,
        decks: sessionDecks,
        deckUndoRedoHistory,
        clips: clipSessions,
      };
      await saveSessionState(session, blobs);
      await saveSessionState(
        {
          ...session,
          id: AUTO_SESSION_ID,
          sourceSessionId: id,
        },
        blobs
      );
      currentSessionIdRef.current = id;
      setLastSavedAt(session.savedAt);
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

  const saveAutoSessionNow = useCallback(async () => {
    const {
      decks: sessionDecks,
      deckUndoRedoHistory,
      blobs: deckBlobs,
    } = await encodeDecksForSession();
    const { clipSessions, blobs } = await encodeClipsForSession(deckBlobs);
    const savedAt = Date.now();
    const nextName = sessionName.trim() || "Untitled";
    const activeSessionId = currentSessionIdRef.current;
    const session: SessionState = {
      version: 1,
      id: AUTO_SESSION_ID,
      sourceSessionId: activeSessionId ?? undefined,
      name: nextName,
      savedAt,
      masterGain,
      welcomePanelDismissed,
      decks: sessionDecks,
      deckUndoRedoHistory,
      clips: clipSessions,
    };
    await saveSessionState(session, blobs);
    if (activeSessionId) {
      await saveSessionState(
        {
          ...session,
          id: activeSessionId,
        },
        blobs
      );
      await refreshSessions();
    }
    setLastSavedAt(savedAt);
  }, [
    encodeClipsForSession,
    encodeDecksForSession,
    refreshSessions,
    masterGain,
    sessionName,
    welcomePanelDismissed,
  ]);
  saveAutoSessionNowRef.current = saveAutoSessionNow;

  const allLoadedDecksPaused =
    decks.some((deck) => deck.buffer) &&
    decks.filter((deck) => deck.buffer).every((deck) => deck.status === "paused");

  useEffect(() => {
    if (!autosaveReady) return;
    if (!allLoadedDecksPaused) return;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }
    if (skipNextAutosaveRef.current > 0) {
      skipNextAutosaveRef.current -= 1;
      return;
    }
    autosaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await saveAutoSessionNow();
      } catch (error) {
        console.error("Autosave failed", error);
      }
    }, 1000);
    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [
    autosaveReady,
    allLoadedDecksPaused,
    clips,
    decks,
    saveAutoSessionNow,
  ]);

  useEffect(() => {
    if (!autosaveReady) return;
    const wasPaused = wasAllLoadedDecksPausedRef.current;
    wasAllLoadedDecksPausedRef.current = allLoadedDecksPaused;
    if (!allLoadedDecksPaused || wasPaused) return;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    void saveAutoSessionNow().catch((error) => {
      console.error("Autosave on pause failed", error);
    });
  }, [allLoadedDecksPaused, autosaveReady, saveAutoSessionNow]);

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
        deckBlobIdsRef.current.set(buffer, deck.wavBlobId);
        buffers.set(deck.id, buffer);
      }
      return buffers;
    },
    [decodeFile]
  );

  const decodeSessionDeckHistoryBuffers = useCallback(
    async (
      deckUndoRedoHistory: SessionDeckUndoRedoHistory | undefined,
      blobs: Map<string, Blob>
    ) => {
      const historyBuffers = new Map<string, AudioBuffer | null>();
      if (!deckUndoRedoHistory) return historyBuffers;
      const historyDecks = [...deckUndoRedoHistory.past.flat(), ...deckUndoRedoHistory.future.flat()];
      for (const deck of historyDecks) {
        if (!deck.wavBlobId || historyBuffers.has(deck.wavBlobId)) continue;
        const blob = blobs.get(deck.wavBlobId);
        if (!blob) {
          historyBuffers.set(deck.wavBlobId, null);
          continue;
        }
        const file = new File([blob], deck.fileName ?? `Deck ${deck.id}.wav`, {
          type: blob.type || "audio/wav",
        });
        const buffer = await decodeFile(file);
        deckBlobIdsRef.current.set(buffer, deck.wavBlobId);
        historyBuffers.set(deck.wavBlobId, buffer);
      }
      return historyBuffers;
    },
    [decodeFile]
  );

  const decodeRearrangerSnapshots = useCallback(
    async (sessionDecks: DeckSession[], blobs: Map<string, Blob>) => {
      const snapshots = new Map<number, HydratedRearrangerSnapshotSession>();
      for (const deck of sessionDecks) {
        const snapshot = deck.rearrangerSnapshot;
        if (!snapshot?.wavBlobId) continue;
        const blob = blobs.get(snapshot.wavBlobId);
        if (!blob) continue;
        const file = new File(
          [blob],
          snapshot.fileName ?? deck.fileName ?? `Deck ${deck.id} Snapshot.wav`,
          { type: blob.type || "audio/wav" }
        );
        const buffer = await decodeFile(file);
        deckBlobIdsRef.current.set(buffer, snapshot.wavBlobId);
        snapshots.set(deck.id, {
          buffer,
          capturedAtMs: snapshot.capturedAtMs,
          fileName: snapshot.fileName,
          loopStartSeconds: snapshot.loopStartSeconds,
          loopEndSeconds: snapshot.loopEndSeconds,
          rearrangerSlices: snapshot.rearrangerSlices,
          rearrangerRegions: snapshot.rearrangerRegions,
          rearrangerRegionIds: snapshot.rearrangerRegionIds,
          rearrangerRegionsManual: snapshot.rearrangerRegionsManual,
        });
      }
      return snapshots;
    },
    [decodeFile]
  );

  const applySessionData = useCallback(
    async (session: SessionState, blobs: Map<string, Blob>) => {
      const buffers = await decodeSessionDecks(session.decks, blobs);
      const historyBuffers = await decodeSessionDeckHistoryBuffers(
        session.deckUndoRedoHistory,
        blobs
      );
      const rearrangerSnapshots = await decodeRearrangerSnapshots(session.decks, blobs);
      loadSessionDecks(session.decks, buffers, {
        deckUndoRedoHistory: session.deckUndoRedoHistory,
        historyBuffers,
      });
      loadRearrangerSnapshotsFromSessionRef.current?.(rearrangerSnapshots);

      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
      const nextClips: ClipItem[] = [];
      let maxClipId = 0;
      for (const clip of session.clips) {
        const blobId = clip.audioBlobId ?? clip.wavBlobId;
        if (!blobId) continue;
        const blob = blobs.get(blobId);
        if (!blob) continue;
        clipBlobIdsRef.current.set(blob, blobId);
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
    [
      decodeSessionDeckHistoryBuffers,
      decodeSessionDecks,
      decodeRearrangerSnapshots,
      loadRearrangerSnapshotsFromSessionRef,
      loadSessionDecks,
      clipsRef,
      setClips,
      clipIdRef,
      clipNameRef,
      setMasterGainValue,
    ]
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
        setLastSavedAt(null);
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
      setLastSavedAt(loaded.session.savedAt);
      if (loaded.session.sourceSessionId) {
        currentSessionIdRef.current = loaded.session.sourceSessionId;
        setSelectedSessionId(loaded.session.sourceSessionId);
      } else {
        currentSessionIdRef.current = null;
      }
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
      currentSessionIdRef.current = session.id;
      setSelectedSessionId(session.id);
      setLastSavedAt(session.savedAt);
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
    setLastSavedAt(null);
    loadRearrangerSnapshotsFromSessionRef.current?.(new Map());
    currentSessionIdRef.current = null;
    setSelectedSessionId(null);
    setSessionStatus(null);
  }, [
    resetDecks,
    clipsRef,
    setClips,
    clipIdRef,
    clipNameRef,
    loadRearrangerSnapshotsFromSessionRef,
    setMasterGainValue,
  ]);

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

  const triggerAutosaveNow = useCallback(async () => {
    if (!autosaveReadyRef.current) return;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 0);
    });
    await saveAutoSessionNowRef.current?.();
  }, []);

  return {
    sessionBusy,
    sessionStatus,
    setSessionStatus,
    sessionName,
    setSessionName,
    lastSavedAt,
    welcomePanelDismissed,
    setWelcomePanelDismissed,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    importInputRef,
    zipDragOver,
    markSkipNextAutosave,
    triggerAutosaveNow,
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
