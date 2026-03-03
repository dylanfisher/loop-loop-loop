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
      })
    );

    await waitFor(() => expect(hoisted.loadSessionState).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleSaveSession();
      await result.current.handleSaveSession();
    });

    expect(hoisted.createSessionId).toHaveBeenCalledTimes(1);
    expect(hoisted.saveSessionState).toHaveBeenCalledTimes(2);
    const firstSession = hoisted.saveSessionState.mock.calls[0][0] as SessionState;
    const secondSession = hoisted.saveSessionState.mock.calls[1][0] as SessionState;
    expect(firstSession.id).toBe("session-fixed");
    expect(secondSession.id).toBe("session-fixed");
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
});
