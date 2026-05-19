import type { SessionState } from "../types/session";

export const SESSION_DB_NAME = "loop-loop-loop";
export const SESSION_DB_VERSION = 2;
export const SESSION_STORE_NAME = "session";
export const BLOB_STORE_NAME = "blobs";
export const RECORDING_DRAFT_STORE_NAME = "recordingDrafts";
export const RECORDING_DRAFT_CHUNK_STORE_NAME = "recordingDraftChunks";
const SESSION_KEY_PREFIX = "session:";
export const AUTO_SESSION_ID = "autosave-current";

export type RecordingDraftKind = "global" | "clip";
export type RecordingDraftSource = "master" | "input";
export type RecordingDraft = {
  id: string;
  kind: RecordingDraftKind;
  source?: RecordingDraftSource;
  mimeType: string;
  sampleRate?: number;
  channelCount?: number;
  startedAt: number;
  updatedAt: number;
  sessionName?: string;
  chunkCount: number;
  totalBytes: number;
};

type RecordingDraftChunk = {
  draftId: string;
  index: number;
  blob: Blob;
  size: number;
  createdAt: number;
};

const openSessionDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        db.createObjectStore(SESSION_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        db.createObjectStore(BLOB_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(RECORDING_DRAFT_STORE_NAME)) {
        db.createObjectStore(RECORDING_DRAFT_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(RECORDING_DRAFT_CHUNK_STORE_NAME)) {
        const chunkStore = db.createObjectStore(RECORDING_DRAFT_CHUNK_STORE_NAME, {
          keyPath: ["draftId", "index"],
        });
        chunkStore.createIndex("draftId", "draftId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const collectSessionBlobIds = (session: SessionState, blobIds: Set<string>) => {
  session.decks.forEach((deck) => {
    if (deck.wavBlobId) blobIds.add(deck.wavBlobId);
    if (deck.rearrangerSnapshot?.wavBlobId) blobIds.add(deck.rearrangerSnapshot.wavBlobId);
  });
  session.deckUndoRedoHistory?.past.forEach((snapshot) => {
    snapshot.forEach((deck) => {
      if (deck.wavBlobId) blobIds.add(deck.wavBlobId);
    });
  });
  session.deckUndoRedoHistory?.future.forEach((snapshot) => {
    snapshot.forEach((deck) => {
      if (deck.wavBlobId) blobIds.add(deck.wavBlobId);
    });
  });
  session.clips.forEach((clip) => {
    if (clip.audioBlobId) blobIds.add(clip.audioBlobId);
    if (clip.wavBlobId) blobIds.add(clip.wavBlobId);
  });
};

const garbageCollectUnreferencedBlobs = async (db: IDBDatabase) => {
  const sessionStore = db
    .transaction(SESSION_STORE_NAME, "readonly")
    .objectStore(SESSION_STORE_NAME);
  const sessions = (await requestToPromise(sessionStore.getAll())) as SessionState[];
  const referencedBlobIds = new Set<string>();
  sessions.forEach((session) => collectSessionBlobIds(session, referencedBlobIds));

  const tx = db.transaction(BLOB_STORE_NAME, "readwrite");
  const done = transactionDone(tx);
  const blobStore = tx.objectStore(BLOB_STORE_NAME);
  const blobKeys = (await requestToPromise(
    blobStore.getAllKeys()
  )) as Array<IDBValidKey>;
  blobKeys.forEach((key) => {
    if (referencedBlobIds.has(String(key))) return;
    blobStore.delete(key);
  });
  await done;
};

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createSessionBlobId = (prefix: string) => `${prefix}-${randomId()}`;
export const createSessionId = () => `session-${randomId()}`;
export const createRecordingDraftId = () => `recording-draft-${randomId()}`;

export const createRecordingDraft = async (
  draft: Omit<RecordingDraft, "id" | "startedAt" | "updatedAt" | "chunkCount" | "totalBytes">
) => {
  const now = Date.now();
  const nextDraft: RecordingDraft = {
    ...draft,
    id: createRecordingDraftId(),
    startedAt: now,
    updatedAt: now,
    chunkCount: 0,
    totalBytes: 0,
  };
  const db = await openSessionDb();
  const tx = db.transaction(RECORDING_DRAFT_STORE_NAME, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(RECORDING_DRAFT_STORE_NAME).put(nextDraft, nextDraft.id);
  await done;
  db.close();
  return nextDraft;
};

export const appendRecordingDraftChunk = async (
  draftId: string,
  index: number,
  blob: Blob
) => {
  const db = await openSessionDb();
  const draft = (await requestToPromise(
    db
      .transaction(RECORDING_DRAFT_STORE_NAME, "readonly")
      .objectStore(RECORDING_DRAFT_STORE_NAME)
      .get(draftId)
  )) as RecordingDraft | undefined;
  if (!draft) {
    db.close();
    throw new Error(`Recording draft not found: ${draftId}`);
  }
  const tx = db.transaction(
    [RECORDING_DRAFT_STORE_NAME, RECORDING_DRAFT_CHUNK_STORE_NAME],
    "readwrite"
  );
  const done = transactionDone(tx);
  const draftStore = tx.objectStore(RECORDING_DRAFT_STORE_NAME);
  const chunkStore = tx.objectStore(RECORDING_DRAFT_CHUNK_STORE_NAME);
  const chunk: RecordingDraftChunk = {
    draftId,
    index,
    blob,
    size: blob.size,
    createdAt: Date.now(),
  };
  chunkStore.put(chunk);
  draftStore.put(
    {
      ...draft,
      updatedAt: Date.now(),
      chunkCount: Math.max(draft.chunkCount, index + 1),
      totalBytes: draft.totalBytes + blob.size,
    },
    draftId
  );
  await done;
  db.close();
};

export const listRecordingDrafts = async (kind?: RecordingDraftKind) => {
  const db = await openSessionDb();
  const draftStore = db
    .transaction(RECORDING_DRAFT_STORE_NAME, "readonly")
    .objectStore(RECORDING_DRAFT_STORE_NAME);
  const drafts = (await requestToPromise(draftStore.getAll())) as RecordingDraft[];
  db.close();
  return drafts
    .filter((draft) => !kind || draft.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const loadRecordingDraftChunks = async (draftId: string) => {
  const db = await openSessionDb();
  const tx = db.transaction(RECORDING_DRAFT_CHUNK_STORE_NAME, "readonly");
  const chunkStore = tx.objectStore(RECORDING_DRAFT_CHUNK_STORE_NAME);
  const index = chunkStore.index("draftId");
  const chunks = (await requestToPromise(index.getAll(draftId))) as RecordingDraftChunk[];
  db.close();
  return chunks.sort((a, b) => a.index - b.index).map((chunk) => chunk.blob);
};

export const loadRecordingDraftChunk = async (draftId: string, index: number) => {
  const db = await openSessionDb();
  const chunk = (await requestToPromise(
    db
      .transaction(RECORDING_DRAFT_CHUNK_STORE_NAME, "readonly")
      .objectStore(RECORDING_DRAFT_CHUNK_STORE_NAME)
      .get([draftId, index])
  )) as RecordingDraftChunk | undefined;
  db.close();
  return chunk?.blob ?? null;
};

export const deleteRecordingDraft = async (draftId: string) => {
  const db = await openSessionDb();
  const chunkIndex = db
    .transaction(RECORDING_DRAFT_CHUNK_STORE_NAME, "readonly")
    .objectStore(RECORDING_DRAFT_CHUNK_STORE_NAME)
    .index("draftId");
  const chunkKeys = (await requestToPromise(chunkIndex.getAllKeys(draftId))) as IDBValidKey[];
  const tx = db.transaction(
    [RECORDING_DRAFT_STORE_NAME, RECORDING_DRAFT_CHUNK_STORE_NAME],
    "readwrite"
  );
  const done = transactionDone(tx);
  tx.objectStore(RECORDING_DRAFT_STORE_NAME).delete(draftId);
  const chunkStore = tx.objectStore(RECORDING_DRAFT_CHUNK_STORE_NAME);
  chunkKeys.forEach((key) => chunkStore.delete(key));
  await done;
  db.close();
};

export const saveSessionState = async (
  session: SessionState,
  blobs: Map<string, Blob>
) => {
  const db = await openSessionDb();
  const tx = db.transaction([SESSION_STORE_NAME, BLOB_STORE_NAME], "readwrite");
  const done = transactionDone(tx);
  const sessionStore = tx.objectStore(SESSION_STORE_NAME);
  const blobStore = tx.objectStore(BLOB_STORE_NAME);

  blobs.forEach((blob, id) => {
    blobStore.put(blob, id);
  });
  sessionStore.put(session, `${SESSION_KEY_PREFIX}${session.id}`);

  await done;
  await garbageCollectUnreferencedBlobs(db);
  db.close();
};

export const loadSessionState = async (id: string) => {
  const db = await openSessionDb();
  const sessionStore = db
    .transaction(SESSION_STORE_NAME, "readonly")
    .objectStore(SESSION_STORE_NAME);
  const session = (await requestToPromise(
    sessionStore.get(`${SESSION_KEY_PREFIX}${id}`)
  )) as SessionState | undefined;

  if (!session) {
    db.close();
    return null;
  }

  const blobIds = new Set<string>();
  collectSessionBlobIds(session, blobIds);

  const blobStore = db
    .transaction(BLOB_STORE_NAME, "readonly")
    .objectStore(BLOB_STORE_NAME);
  const blobs = new Map<string, Blob>();
  for (const id of blobIds) {
    const blob = await requestToPromise(blobStore.get(id));
    if (blob) {
      blobs.set(id, blob);
    }
  }

  db.close();
  return { session, blobs };
};

export const listSessionMetas = async () => {
  const db = await openSessionDb();
  const sessionStore = db
    .transaction(SESSION_STORE_NAME, "readonly")
    .objectStore(SESSION_STORE_NAME);
  const allSessions = (await requestToPromise(
    sessionStore.getAll()
  )) as SessionState[];
  db.close();

  return allSessions
    .filter((session) => Boolean(session?.id))
    .filter((session) => session.id !== AUTO_SESSION_ID)
    .map((session) => ({
      id: session.id,
      name: session.name,
      savedAt: session.savedAt,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
};

export const clearSessionStorage = async () => {
  const db = await openSessionDb();
  const tx = db.transaction(
    [
      SESSION_STORE_NAME,
      BLOB_STORE_NAME,
      RECORDING_DRAFT_STORE_NAME,
      RECORDING_DRAFT_CHUNK_STORE_NAME,
    ],
    "readwrite"
  );
  const done = transactionDone(tx);
  tx.objectStore(SESSION_STORE_NAME).clear();
  tx.objectStore(BLOB_STORE_NAME).clear();
  tx.objectStore(RECORDING_DRAFT_STORE_NAME).clear();
  tx.objectStore(RECORDING_DRAFT_CHUNK_STORE_NAME).clear();
  await done;
  db.close();
};
