import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useSessionManager from "../useSessionManager";
import type { ClipItem } from "../../types/clip";
import type { DeckSession, SessionState } from "../../types/session";

const hoisted = vi.hoisted(() => {
  const state = { blobIdCounter: 0 };
  return {
    state,
    createSessionBlobId: vi.fn((prefix: string) => `${prefix}-blob-${++state.blobIdCounter}`),
    createSessionId: vi.fn(() => "session-fixed"),
    listSessionMetas: vi.fn(async () => []),
    loadSessionState: vi.fn(async () => null),
    saveSessionState: vi.fn(async () => {}),
    encodeWavOffThread: vi.fn(async () => new Blob(["wav"], { type: "audio/wav" })),
    readZip: vi.fn(() => new Map<string, Uint8Array>()),
  };
});

vi.mock("../../utils/sessionStore", () => ({
  AUTO_SESSION_ID: "autosave-current",
  createSessionBlobId: hoisted.createSessionBlobId,
  createSessionId: hoisted.createSessionId,
  listSessionMetas: hoisted.listSessionMetas,
  loadSessionState: hoisted.loadSessionState,
  saveSessionState: hoisted.saveSessionState,
}));

vi.mock("../../utils/fxPanelState", () => ({
  buildFxPanelPatch: vi.fn(() => ({})),
  loadFxPanelPatch: vi.fn(() => ({})),
  saveFxPanelPatch: vi.fn(),
}));

vi.mock("../../utils/wavWorkerClient", () => ({
  encodeWavOffThread: hoisted.encodeWavOffThread,
}));

vi.mock("../../utils/zip", () => ({
  createZip: vi.fn(() => new Blob([], { type: "application/zip" })),
  readZip: hoisted.readZip,
}));

vi.mock("../deckSessionSerialization", () => ({
  serializeDeckSession: vi.fn((deck: unknown) => deck),
}));

describe("useSessionManager blob reuse", () => {
  beforeEach(() => {
    hoisted.state.blobIdCounter = 0;
    hoisted.createSessionBlobId.mockClear();
    hoisted.createSessionId.mockClear();
    hoisted.listSessionMetas.mockClear();
    hoisted.loadSessionState.mockClear();
    hoisted.saveSessionState.mockClear();
    hoisted.encodeWavOffThread.mockClear();
    hoisted.readZip.mockReset();
    hoisted.readZip.mockImplementation(() => new Map<string, Uint8Array>());
  });

  it("reuses clip blob ids across repeated autosaves", async () => {
    const blob = new Blob(["clip"], { type: "audio/webm" });
    const clips: ClipItem[] = [
      {
        id: 1,
        name: "Clip 1",
        blob,
        url: "blob:clip-1",
        durationSec: 1,
        gain: 1,
        balance: 0,
        pitchShift: 0,
        tempoOffset: 0,
      },
    ];

    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips,
        clipsRef: { current: clips },
        clipIdRef: { current: 2 },
        clipNameRef: { current: 2 },
        decodeFile: vi.fn(async () => null as unknown as AudioBuffer),
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.triggerAutosaveNow();
      await result.current.triggerAutosaveNow();
    });

    expect(hoisted.saveSessionState).toHaveBeenCalledTimes(2);
    const firstSession = hoisted.saveSessionState.mock.calls[0][0];
    const secondSession = hoisted.saveSessionState.mock.calls[1][0];
    expect(firstSession.clips[0]?.audioBlobId).toBe(secondSession.clips[0]?.audioBlobId);
    expect(hoisted.createSessionBlobId).toHaveBeenCalledTimes(1);
  });

  it("reuses deck wav blob ids across repeated autosaves", async () => {
    const buffer = {
      duration: 1,
      sampleRate: 44100,
      length: 44100,
    } as AudioBuffer;
    const decks = [{ id: 1, buffer }] as unknown as Parameters<typeof useSessionManager>[0]["decks"];
    const sessionDeck = { id: 1 } as unknown as DeckSession;

    const { result } = renderHook(() =>
      useSessionManager({
        decks,
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile: vi.fn(async () => buffer),
        getSessionDecks: vi.fn(() => [sessionDeck]),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.triggerAutosaveNow();
      await result.current.triggerAutosaveNow();
    });

    expect(hoisted.saveSessionState).toHaveBeenCalledTimes(2);
    const firstSession = hoisted.saveSessionState.mock.calls[0][0];
    const secondSession = hoisted.saveSessionState.mock.calls[1][0];
    expect(firstSession.decks[0]?.wavBlobId).toBe(secondSession.decks[0]?.wavBlobId);
    expect(hoisted.encodeWavOffThread).toHaveBeenCalledTimes(1);
  });

  it("persists rearranger snapshots into saved sessions", async () => {
    const deckBuffer = {
      duration: 1,
      sampleRate: 44100,
      length: 44100,
    } as AudioBuffer;
    const snapshotBuffer = {
      duration: 1,
      sampleRate: 44100,
      length: 44100,
    } as AudioBuffer;
    const getRearrangerSnapshotsForSession = vi.fn(() =>
      new Map([
        [
          1,
          {
            buffer: snapshotBuffer,
            capturedAtMs: 1234,
            fileName: "Snapshot",
            loopStartSeconds: 0,
            loopEndSeconds: 1,
            rearrangerSlices: 4,
            rearrangerRegions: [0, 0.25, 0.5, 0.75, 1],
            rearrangerRegionIds: [0, 1, 2, 3],
            rearrangerRegionsManual: true,
          },
        ],
      ])
    );

    const { result } = renderHook(() =>
      useSessionManager({
        decks: [{ id: 1, buffer: deckBuffer }] as Parameters<typeof useSessionManager>[0]["decks"],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile: vi.fn(async () => deckBuffer),
        getSessionDecks: vi.fn(() => [{ id: 1 } as DeckSession]),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: getRearrangerSnapshotsForSession },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.triggerAutosaveNow();
    });

    const savedSession = hoisted.saveSessionState.mock.calls[0][0] as SessionState;
    const savedBlobs = hoisted.saveSessionState.mock.calls[0][1] as Map<string, Blob>;
    expect(savedSession.decks[0]?.rearrangerSnapshot).toMatchObject({
      capturedAtMs: 1234,
      fileName: "Snapshot",
      loopStartSeconds: 0,
      loopEndSeconds: 1,
      rearrangerSlices: 4,
      rearrangerRegions: [0, 0.25, 0.5, 0.75, 1],
      rearrangerRegionIds: [0, 1, 2, 3],
      rearrangerRegionsManual: true,
    });
    expect(savedSession.decks[0]?.rearrangerSnapshot?.wavBlobId).toBeTruthy();
    expect(savedBlobs.size).toBe(2);
  });

  it("reuses the current session id across repeated manual saves", async () => {
    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile: vi.fn(async () => null as unknown as AudioBuffer),
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleSaveSession();
      await result.current.handleSaveSession();
    });

    expect(hoisted.createSessionId).toHaveBeenCalledTimes(1);
    expect(hoisted.saveSessionState).toHaveBeenCalledTimes(4);
    const firstSession = hoisted.saveSessionState.mock.calls[0][0] as SessionState;
    const secondSession = hoisted.saveSessionState.mock.calls[2][0] as SessionState;
    expect(firstSession.id).toBe("session-fixed");
    expect(secondSession.id).toBe("session-fixed");
  });

  it("manual save also refreshes autosave snapshot for reload hydration", async () => {
    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile: vi.fn(async () => null as unknown as AudioBuffer),
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleSaveSession();
    });

    expect(hoisted.saveSessionState).toHaveBeenCalledTimes(2);
    const projectSession = hoisted.saveSessionState.mock.calls[0][0] as SessionState;
    const autosaveSession = hoisted.saveSessionState.mock.calls[1][0] as SessionState;
    expect(projectSession.id).toBe("session-fixed");
    expect(autosaveSession.id).toBe("autosave-current");
    expect(autosaveSession.sourceSessionId).toBe("session-fixed");
    expect(autosaveSession.decks).toEqual(projectSession.decks);
    expect(autosaveSession.clips).toEqual(projectSession.clips);
  });

  it("reuses autosave-linked project id after reload when manually saving", async () => {
    hoisted.loadSessionState.mockImplementation(async (id: string) => {
      if (id !== "autosave-current") return null;
      const session: SessionState = {
        version: 1,
        id: "autosave-current",
        sourceSessionId: "session-existing",
        name: "Recovered",
        savedAt: 1,
        masterGain: 0.9,
        welcomePanelDismissed: false,
        decks: [],
        clips: [],
      };
      return { session, blobs: new Map() };
    });

    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile: vi.fn(async () => null as unknown as AudioBuffer),
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleSaveSession();
      await result.current.handleSaveSession();
    });

    expect(hoisted.createSessionId).not.toHaveBeenCalled();
    const firstProjectSave = hoisted.saveSessionState.mock.calls[0][0] as SessionState;
    const secondProjectSave = hoisted.saveSessionState.mock.calls[2][0] as SessionState;
    expect(firstProjectSave.id).toBe("session-existing");
    expect(secondProjectSave.id).toBe("session-existing");
  });

  it("autosave mirrors updates into the currently loaded saved session", async () => {
    hoisted.listSessionMetas.mockResolvedValue([
      { id: "session-existing", name: "Existing", savedAt: 1 },
    ]);
    hoisted.loadSessionState.mockImplementation(async (id: string) => {
      if (id !== "session-existing") return null;
      const session: SessionState = {
        version: 1,
        id: "session-existing",
        name: "Existing",
        savedAt: 1,
        masterGain: 0.9,
        welcomePanelDismissed: false,
        decks: [],
        clips: [],
      };
      return { session, blobs: new Map() };
    });

    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile: vi.fn(async () => null as unknown as AudioBuffer),
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks: vi.fn(),
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(result.current.selectedSessionId).toBe("session-existing"));

    await act(async () => {
      await result.current.handleLoadSession();
    });

    hoisted.saveSessionState.mockClear();

    await act(async () => {
      await result.current.triggerAutosaveNow();
    });

    expect(hoisted.saveSessionState).toHaveBeenCalledTimes(2);
    const autosaveSession = hoisted.saveSessionState.mock.calls[0][0] as SessionState;
    const mirroredProjectSession = hoisted.saveSessionState.mock.calls[1][0] as SessionState;
    expect(autosaveSession.id).toBe("autosave-current");
    expect(mirroredProjectSession.id).toBe("session-existing");
  });

  it("imports deck audio from legacy wavBlobId session files", async () => {
    const importedBuffer = { duration: 1, sampleRate: 44100, length: 44100 } as AudioBuffer;
    const decodeFile = vi.fn(async () => importedBuffer);
    const loadSessionDecks = vi.fn();
    const deckTemplate = {
      id: 1,
      gain: 0.9,
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
      automation: {
        gain: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0.9 },
        djFilter: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        resonance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        eqLow: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        eqMid: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        eqHigh: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        balance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        pitch: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
      },
    };
    const sessionFile = {
      version: 1,
      name: "Imported Session",
      savedAt: Date.now(),
      decks: [
        {
          ...deckTemplate,
          wavBlobId: "legacy-blob-1",
        },
      ],
      clips: [],
    };
    hoisted.readZip.mockReturnValue(
      new Map<string, Uint8Array>([
        ["session.json", new TextEncoder().encode(JSON.stringify(sessionFile))],
        ["nested/audio/deck-blob-legacy-blob-1.wav", new Uint8Array([1, 2, 3])],
      ])
    );

    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile,
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks,
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    const zipFile = {
      name: "session.zip",
      type: "application/zip",
      arrayBuffer: async () => new ArrayBuffer(16),
    } as unknown as File;

    await act(async () => {
      await result.current.handleImportChange({
        target: {
          files: [zipFile],
          value: "session.zip",
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(loadSessionDecks).toHaveBeenCalledTimes(1);
    const [, importedBuffers] = loadSessionDecks.mock.calls[0] as [DeckSession[], Map<number, AudioBuffer | null>];
    expect(importedBuffers.get(1)).toBe(importedBuffer);
  });

  it("imports deck audio when wavFile uses windows separators", async () => {
    const importedBuffer = { duration: 1, sampleRate: 44100, length: 44100 } as AudioBuffer;
    const decodeFile = vi.fn(async () => importedBuffer);
    const loadSessionDecks = vi.fn();
    const deckTemplate = {
      id: 1,
      gain: 0.9,
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
      automation: {
        gain: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0.9 },
        djFilter: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        resonance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        eqLow: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        eqMid: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        eqHigh: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        balance: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
        pitch: { samples: [], sampleRate: 30, durationSec: 0, active: false, currentValue: 0 },
      },
    };
    const sessionFile = {
      version: 1,
      name: "Imported Session",
      savedAt: Date.now(),
      decks: [
        {
          ...deckTemplate,
          wavFile: "audio\\deck-blob-legacy-blob-2.wav",
        },
      ],
      clips: [],
    };
    hoisted.readZip.mockReturnValue(
      new Map<string, Uint8Array>([
        ["session.json", new TextEncoder().encode(JSON.stringify(sessionFile))],
        ["nested/audio/deck-blob-legacy-blob-2.wav", new Uint8Array([1, 2, 3])],
      ])
    );

    const { result } = renderHook(() =>
      useSessionManager({
        decks: [],
        clips: [],
        clipsRef: { current: [] },
        clipIdRef: { current: 1 },
        clipNameRef: { current: 1 },
        decodeFile,
        getSessionDecks: vi.fn(() => []),
        getDeckUndoRedoHistorySnapshots: vi.fn(() => ({ past: [], future: [] })),
        loadSessionDecks,
        resetDecks: vi.fn(),
        masterGain: 0.9,
        setMasterGainValue: vi.fn(),
        applyDeckFxPanelStatePatch: vi.fn(),
        setClips: vi.fn(),
        getRearrangerSnapshotsForSessionRef: { current: null },
        loadRearrangerSnapshotsFromSessionRef: { current: null },
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    const zipFile = {
      name: "session.zip",
      type: "application/zip",
      arrayBuffer: async () => new ArrayBuffer(16),
    } as unknown as File;

    await act(async () => {
      await result.current.handleImportChange({
        target: {
          files: [zipFile],
          value: "session.zip",
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(loadSessionDecks).toHaveBeenCalledTimes(1);
    const [, importedBuffers] = loadSessionDecks.mock.calls[0] as [DeckSession[], Map<number, AudioBuffer | null>];
    expect(importedBuffers.get(1)).toBe(importedBuffer);
  });
});
