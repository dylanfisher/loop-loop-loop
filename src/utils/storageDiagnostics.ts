import {
  BLOB_STORE_NAME,
  SESSION_DB_NAME,
  SESSION_STORE_NAME,
} from "./sessionStore";

export type StorageDiagnosticsSummary = {
  capturedAt: number;
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
  localStorage: {
    totalBytes: number;
    keyCount: number;
    items: Array<{ key: string; bytes: number }>;
  };
  indexedDb: {
    sessionCount: number;
    sessionBytesApprox: number;
    blobCount: number;
    blobBytes: number;
    largestBlobs: Array<{ id: string; bytes: number; mimeType: string }>;
    sessions: Array<{
      id: string;
      name: string;
      savedAt: number | null;
      decks: number;
      clips: number;
      bytesApprox: number;
    }>;
  };
  notes: string[];
};

const stringBytes = (value: string) => value.length * 2;

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const safeApproxJsonBytes = (value: unknown) => {
  try {
    return stringBytes(JSON.stringify(value));
  } catch {
    return 0;
  }
};

const compareByBytesDesc = <T extends { bytes: number }>(a: T, b: T) => b.bytes - a.bytes;

const collectLocalStorageSummary = () => {
  if (typeof window === "undefined") {
    return {
      totalBytes: 0,
      keyCount: 0,
      items: [] as Array<{ key: string; bytes: number }>,
    };
  }
  const items: Array<{ key: string; bytes: number }> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const value = window.localStorage.getItem(key) ?? "";
      const bytes = stringBytes(key) + stringBytes(value);
      items.push({ key, bytes });
    }
  } catch {
    return { totalBytes: 0, keyCount: 0, items };
  }
  items.sort(compareByBytesDesc);
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  return { totalBytes, keyCount: items.length, items };
};

export const formatStorageBytes = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

export const collectStorageDiagnostics = async (): Promise<StorageDiagnosticsSummary> => {
  const notes: string[] = [];
  let browserUsageBytes: number | null = null;
  let browserQuotaBytes: number | null = null;

  try {
    const estimateStorage = navigator.storage?.estimate?.bind(navigator.storage);
    if (!estimateStorage) {
      notes.push("Browser storage estimate API is unavailable.");
    } else {
      const { usage, quota } = await estimateStorage();
      browserUsageBytes = typeof usage === "number" ? usage : null;
      browserQuotaBytes = typeof quota === "number" ? quota : null;
    }
  } catch {
    notes.push("Failed to read browser storage estimate.");
  }

  const localStorage = collectLocalStorageSummary();

  let indexedDb: StorageDiagnosticsSummary["indexedDb"] = {
    sessionCount: 0,
    sessionBytesApprox: 0,
    blobCount: 0,
    blobBytes: 0,
    largestBlobs: [],
    sessions: [],
  };

  try {
    const db = await openDb();
    const tx = db.transaction([SESSION_STORE_NAME, BLOB_STORE_NAME], "readonly");
    const sessionStore = tx.objectStore(SESSION_STORE_NAME);
    const blobStore = tx.objectStore(BLOB_STORE_NAME);

    const sessionsRaw = (await requestToPromise(sessionStore.getAll())) as Array<
      Record<string, unknown>
    >;
    const sessions = sessionsRaw
      .map((session) => {
        const id = typeof session.id === "string" ? session.id : "unknown";
        const name = typeof session.name === "string" ? session.name : "(unnamed)";
        const savedAt = typeof session.savedAt === "number" ? session.savedAt : null;
        const decks = Array.isArray(session.decks) ? session.decks.length : 0;
        const clips = Array.isArray(session.clips) ? session.clips.length : 0;
        const bytesApprox = safeApproxJsonBytes(session);
        return { id, name, savedAt, decks, clips, bytesApprox };
      })
      .sort((a, b) => b.bytesApprox - a.bytesApprox);
    const sessionBytesApprox = sessions.reduce((sum, session) => sum + session.bytesApprox, 0);

    const largestBlobs: Array<{ id: string; bytes: number; mimeType: string }> = [];
    let blobCount = 0;
    let blobBytes = 0;
    await new Promise<void>((resolve, reject) => {
      const request = blobStore.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        blobCount += 1;
        const key = String(cursor.key);
        const value = cursor.value;
        let bytes = 0;
        let mimeType = "unknown";
        if (value instanceof Blob) {
          bytes = value.size;
          mimeType = value.type || "application/octet-stream";
        } else {
          bytes = safeApproxJsonBytes(value);
          mimeType = typeof value;
        }
        blobBytes += bytes;
        largestBlobs.push({ id: key, bytes, mimeType });
        largestBlobs.sort(compareByBytesDesc);
        if (largestBlobs.length > 12) {
          largestBlobs.length = 12;
        }
        cursor.continue();
      };
    });
    db.close();

    indexedDb = {
      sessionCount: sessions.length,
      sessionBytesApprox,
      blobCount,
      blobBytes,
      largestBlobs,
      sessions: sessions.slice(0, 20),
    };
  } catch (error) {
    if (error instanceof Error && error.message) {
      notes.push(`Failed to inspect IndexedDB: ${error.message}`);
    } else {
      notes.push("Failed to inspect IndexedDB.");
    }
  }

  return {
    capturedAt: Date.now(),
    browserUsageBytes,
    browserQuotaBytes,
    localStorage,
    indexedDb,
    notes,
  };
};
