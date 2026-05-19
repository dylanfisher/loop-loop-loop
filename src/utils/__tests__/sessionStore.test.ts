import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRecordingDraftChunk,
  createRecordingDraft,
  createSessionId,
  deleteRecordingDraft,
  loadRecordingDraftChunk,
  listSessionMetas,
  listRecordingDrafts,
  loadSessionState,
  loadRecordingDraftChunks,
  saveSessionState,
} from "../sessionStore";
import type { SessionState } from "../../types/session";

type StoreMap = Map<string, Map<IDBValidKey, unknown>>;

class FakeIDBRequest<T> {
  onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
  result!: T;
  error: DOMException | null = null;

  constructor(public resolveWith: () => T) {}

  runSuccess() {
    try {
      this.result = this.resolveWith();
      this.onsuccess?.(new Event("success"));
    } catch (error) {
      this.error = error as DOMException;
      this.onerror?.(new Event("error"));
    }
  }
}

class FakeTransaction {
  oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  private pending = 0;

  constructor(private stores: StoreMap) {}

  objectStore(name: string) {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`Missing store ${name}`);
    }
    return new FakeObjectStore(store, this);
  }

  track<T>(request: FakeIDBRequest<T>) {
    this.pending += 1;
    setTimeout(() => {
      request.runSuccess();
      this.pending -= 1;
      if (this.pending === 0) {
        this.oncomplete?.(new Event("complete"));
      }
    }, 0);
  }
}

class FakeObjectStore {
  constructor(
    private store: Map<IDBValidKey, unknown>,
    private transaction: FakeTransaction
  ) {}

  get(key: IDBValidKey) {
    const request = new FakeIDBRequest(() => {
      if (Array.isArray(key)) {
        return Array.from(this.store.entries()).find(([candidate]) => {
          return (
            Array.isArray(candidate) &&
            candidate.length === key.length &&
            candidate.every((part, index) => part === key[index])
          );
        })?.[1];
      }
      return this.store.get(key);
    });
    this.transaction.track(request);
    return request;
  }

  getAll() {
    const request = new FakeIDBRequest(() => Array.from(this.store.values()));
    this.transaction.track(request);
    return request;
  }

  put(value: unknown, key?: IDBValidKey) {
    const request = new FakeIDBRequest(() => {
      const resolvedKey =
        key ??
        (value &&
        typeof value === "object" &&
        "draftId" in value &&
        "index" in value
          ? [value.draftId, value.index]
          : undefined);
      if (resolvedKey === undefined) {
        throw new Error("Missing fake IndexedDB key");
      }
      this.store.set(resolvedKey as IDBValidKey, value);
      return resolvedKey as IDBValidKey;
    });
    this.transaction.track(request);
    return request;
  }

  clear() {
    const request = new FakeIDBRequest(() => {
      this.store.clear();
      return undefined;
    });
    this.transaction.track(request);
    return request;
  }

  getAllKeys() {
    const request = new FakeIDBRequest(() => Array.from(this.store.keys()));
    this.transaction.track(request);
    return request;
  }

  delete(key: IDBValidKey) {
    const request = new FakeIDBRequest(() => {
      this.store.delete(key);
      return undefined;
    });
    this.transaction.track(request);
    return request;
  }

  index(name: string) {
    if (name !== "draftId") {
      throw new Error(`Unsupported index ${name}`);
    }
    return {
      getAll: (draftId: IDBValidKey) => {
        const request = new FakeIDBRequest(() =>
          Array.from(this.store.values()).filter(
            (value) =>
              value &&
              typeof value === "object" &&
              "draftId" in value &&
              value.draftId === draftId
          )
        );
        this.transaction.track(request);
        return request;
      },
      getAllKeys: (draftId: IDBValidKey) => {
        const request = new FakeIDBRequest(() =>
          Array.from(this.store.entries())
            .filter(([, value]) => {
              return (
                value &&
                typeof value === "object" &&
                "draftId" in value &&
                value.draftId === draftId
              );
            })
            .map(([key]) => key)
        );
        this.transaction.track(request);
        return request;
      },
    };
  }

  createIndex() {}
}

class FakeDatabase {
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  constructor(private stores: StoreMap) {}

  createObjectStore(name: string, _options?: IDBObjectStoreParameters) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return new FakeObjectStore(this.stores.get(name)!, new FakeTransaction(this.stores));
  }

  transaction(names: string | string[]) {
    const list = Array.isArray(names) ? names : [names];
    list.forEach((name) => {
      if (!this.stores.has(name)) {
        this.stores.set(name, new Map());
      }
    });
    return new FakeTransaction(this.stores);
  }

  close() {}
}

class FakeOpenRequest extends FakeIDBRequest<IDBDatabase> {
  onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown) | null = null;
}

const createFakeIndexedDB = () => {
  const stores: StoreMap = new Map();
  return {
    open: () => {
      const request = new FakeOpenRequest(() => new FakeDatabase(stores) as unknown as IDBDatabase);
      setTimeout(() => {
        const db = request.resolveWith();
        request.result = db;
        request.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent);
        request.onsuccess?.(new Event("success"));
      }, 0);
      return request as unknown as IDBOpenDBRequest;
    },
  } as IDBFactory;
};

describe("sessionStore", () => {
  const originalIndexedDb = globalThis.indexedDB;

  beforeEach(() => {
    globalThis.indexedDB = createFakeIndexedDB();
  });

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDb;
  });

  it("stores and lists multiple sessions", async () => {
    const sessionA: SessionState = {
      version: 1,
      id: createSessionId(),
      name: "First Session",
      savedAt: 10,
      decks: [],
      clips: [],
    };
    const sessionB: SessionState = {
      version: 1,
      id: createSessionId(),
      name: "Second Session",
      savedAt: 20,
      decks: [],
      clips: [],
    };

    await saveSessionState(sessionA, new Map());
    await saveSessionState(sessionB, new Map());

    const list = await listSessionMetas();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("Second Session");
    expect(list[1].name).toBe("First Session");
  });

  it("loads a session with its blobs", async () => {
    const session: SessionState = {
      version: 1,
      id: createSessionId(),
      name: "Session",
      savedAt: 1,
      decks: [
        {
          id: 1,
          gain: 1,
          djFilter: 0,
          filterResonance: 0,
          eqLowGain: 0,
          eqMidGain: 0,
          eqHighGain: 0,
          balance: 0,
          pitchShift: 0,
          offsetSeconds: 0,
          zoom: 1,
          loopEnabled: false,
          loopStartSeconds: 0,
          loopEndSeconds: 0,
          tempoOffset: 0,
          tempoPitchSync: false,
          stretchRatio: 2,
          stretchWindowSize: 16384,
          stretchStereoWidth: 1,
          stretchPhaseRandomness: 1,
          stretchTiltDb: 0,
          stretchScatter: 1,
          delayTime: 0.35,
          delayFeedback: 0.35,
          delayMix: 0,
          delayTone: 6000,
          delayPingPong: false,
          wavBlobId: "deck-blob",
          automation: {
            djFilter: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            resonance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            eqLow: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            eqMid: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            eqHigh: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            balance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            pitch: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
          },
        },
      ],
      clips: [
        {
          id: 1,
          name: "Clip",
          durationSec: 1,
          gain: 1,
          balance: 0,
          pitchShift: 0,
          audioBlobId: "clip-blob",
          audioMimeType: "audio/webm",
        },
      ],
    };

    const blobs = new Map<string, Blob>([
      ["deck-blob", new Blob(["deck"])],
      ["clip-blob", new Blob(["clip"])],
    ]);

    await saveSessionState(session, blobs);
    const loaded = await loadSessionState(session.id);

    expect(loaded?.session.name).toBe("Session");
    expect(loaded?.blobs.get("deck-blob")).toBeInstanceOf(Blob);
    expect(loaded?.blobs.get("clip-blob")).toBeInstanceOf(Blob);
  });

  it("garbage collects unreferenced blobs after save", async () => {
    const sessionId = createSessionId();
    const baseSession: Omit<SessionState, "id" | "name" | "savedAt" | "decks"> = {
      version: 1,
      clips: [],
    };

    await saveSessionState(
      {
        ...baseSession,
        id: sessionId,
        name: "First",
        savedAt: 1,
        decks: [
          {
            id: 1,
            gain: 1,
            djFilter: 0,
            filterResonance: 0,
            eqLowGain: 0,
            eqMidGain: 0,
            eqHighGain: 0,
            balance: 0,
            pitchShift: 0,
            offsetSeconds: 0,
            zoom: 1,
            loopEnabled: false,
            loopStartSeconds: 0,
            loopEndSeconds: 0,
            tempoOffset: 0,
            tempoPitchSync: false,
            stretchRatio: 2,
            stretchWindowSize: 16384,
            stretchStereoWidth: 1,
            stretchPhaseRandomness: 1,
            stretchTiltDb: 0,
            stretchScatter: 1,
            delayTime: 0.35,
            delayFeedback: 0.35,
            delayMix: 0,
            delayTone: 6000,
            delayPingPong: false,
            wavBlobId: "blob-first-only",
            automation: {
              djFilter: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              resonance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              eqLow: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              eqMid: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              eqHigh: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              balance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              pitch: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            },
          },
        ],
      },
      new Map([
        ["blob-first-only", new Blob(["first"])],
      ])
    );

    await saveSessionState(
      {
        ...baseSession,
        id: sessionId,
        name: "Second",
        savedAt: 2,
        decks: [
          {
            id: 1,
            gain: 1,
            djFilter: 0,
            filterResonance: 0,
            eqLowGain: 0,
            eqMidGain: 0,
            eqHighGain: 0,
            balance: 0,
            pitchShift: 0,
            offsetSeconds: 0,
            zoom: 1,
            loopEnabled: false,
            loopStartSeconds: 0,
            loopEndSeconds: 0,
            tempoOffset: 0,
            tempoPitchSync: false,
            stretchRatio: 2,
            stretchWindowSize: 16384,
            stretchStereoWidth: 1,
            stretchPhaseRandomness: 1,
            stretchTiltDb: 0,
            stretchScatter: 1,
            delayTime: 0.35,
            delayFeedback: 0.35,
            delayMix: 0,
            delayTone: 6000,
            delayPingPong: false,
            wavBlobId: "blob-second",
            automation: {
              djFilter: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              resonance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              eqLow: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              eqMid: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              eqHigh: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              balance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
              pitch: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
            },
          },
        ],
      },
      new Map([
        ["blob-second", new Blob(["second"])],
      ])
    );

    const loaded = await loadSessionState(sessionId);
    expect(loaded?.blobs.get("blob-first-only")).toBeUndefined();
    expect(loaded?.blobs.get("blob-second")).toBeInstanceOf(Blob);
  });

  it("stores, loads, and deletes recording draft chunks", async () => {
    const draft = await createRecordingDraft({
      kind: "global",
      mimeType: "audio/webm",
      sessionName: "Draft Test",
    });

    await appendRecordingDraftChunk(draft.id, 1, new Blob(["two"], { type: "audio/webm" }));
    await appendRecordingDraftChunk(draft.id, 0, new Blob(["one"], { type: "audio/webm" }));

    const drafts = await listRecordingDrafts("global");
    const chunks = await loadRecordingDraftChunks(draft.id);
    const secondChunk = await loadRecordingDraftChunk(draft.id, 1);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].chunkCount).toBe(2);
    expect(chunks.map((chunk) => chunk.size)).toEqual([3, 3]);
    expect(secondChunk?.size).toBe(3);

    await deleteRecordingDraft(draft.id);

    expect(await listRecordingDrafts("global")).toHaveLength(0);
    expect(await loadRecordingDraftChunks(draft.id)).toHaveLength(0);
    expect(await loadRecordingDraftChunk(draft.id, 0)).toBeNull();
  });
});
