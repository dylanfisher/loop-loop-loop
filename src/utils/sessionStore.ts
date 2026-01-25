import type { SessionState } from "../types/session";

const DB_NAME = "loop-loop-loop";
const DB_VERSION = 1;
const SESSION_STORE = "session";
const BLOB_STORE = "blobs";
const SESSION_KEY_PREFIX = "session:";

const openSessionDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE);
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
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

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createSessionBlobId = (prefix: string) => `${prefix}-${randomId()}`;
export const createSessionId = () => `session-${randomId()}`;

export const saveSessionState = async (
  session: SessionState,
  blobs: Map<string, Blob>
) => {
  const db = await openSessionDb();
  const tx = db.transaction([SESSION_STORE, BLOB_STORE], "readwrite");
  const sessionStore = tx.objectStore(SESSION_STORE);
  const blobStore = tx.objectStore(BLOB_STORE);

  blobs.forEach((blob, id) => {
    blobStore.put(blob, id);
  });
  sessionStore.put(session, `${SESSION_KEY_PREFIX}${session.id}`);

  await transactionDone(tx);
  db.close();
};

export const loadSessionState = async (id: string) => {
  const db = await openSessionDb();
  const sessionStore = db
    .transaction(SESSION_STORE, "readonly")
    .objectStore(SESSION_STORE);
  const session = (await requestToPromise(
    sessionStore.get(`${SESSION_KEY_PREFIX}${id}`)
  )) as SessionState | undefined;

  if (!session) {
    db.close();
    return null;
  }

  const blobIds = new Set<string>();
  session.decks.forEach((deck) => {
    if (deck.wavBlobId) blobIds.add(deck.wavBlobId);
  });
  session.clips.forEach((clip) => {
    if (clip.wavBlobId) blobIds.add(clip.wavBlobId);
  });

  const blobStore = db.transaction(BLOB_STORE, "readonly").objectStore(BLOB_STORE);
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
    .transaction(SESSION_STORE, "readonly")
    .objectStore(SESSION_STORE);
  const allSessions = (await requestToPromise(
    sessionStore.getAll()
  )) as SessionState[];
  db.close();

  return allSessions
    .filter((session) => Boolean(session?.id))
    .map((session) => ({
      id: session.id,
      name: session.name,
      savedAt: session.savedAt,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
};
