import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionId,
  listSessionMetas,
  loadSessionState,
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
    const request = new FakeIDBRequest(() => this.store.get(key));
    this.transaction.track(request);
    return request;
  }

  getAll() {
    const request = new FakeIDBRequest(() => Array.from(this.store.values()));
    this.transaction.track(request);
    return request;
  }

  put(value: unknown, key: IDBValidKey) {
    const request = new FakeIDBRequest(() => {
      this.store.set(key, value);
      return key;
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
}

class FakeDatabase {
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  constructor(private stores: StoreMap) {}

  createObjectStore(name: string) {
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
          delayMix: 0.25,
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
          wavBlobId: "clip-blob",
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
});
