import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "../utils/audio";
import { buildDerivedDeckName, sliceBufferSegment } from "../utils/appHelpers";
import type { ClipItem } from "../types/clip";
import type { DeckState } from "../types/deck";
import type { ClipSettings } from "../types/session";

type UseClipLibraryArgs = {
  decks: DeckState[];
  automationState: Map<
    number,
    Partial<
      Record<
        "gain" | "djFilter" | "resonance" | "eqLow" | "eqMid" | "eqHigh" | "balance" | "pitch",
        {
          samples: Float32Array;
          durationSec: number;
          active: boolean;
          currentValue: number;
        }
      >
    >
  >;
  addDeck: (options?: { afterId?: number }) => number;
  handleFileSelected: (
    deckId: number,
    file: File,
    options?: {
      gain?: number;
      balance?: number;
      pitchShift?: number;
      tempoOffset?: number;
      settings?: ClipSettings;
    }
  ) => Promise<void>;
  loadDeckBuffer: (
    deckId: number,
    buffer: AudioBuffer,
    options?: {
      name?: string;
      autoplay?: boolean;
      recordHistory?: boolean;
      preserveNodes?: boolean;
      preserveFxState?: boolean;
      offsetSeconds?: number;
      rearrangerRegions?: number[];
      rearrangerRegionIds?: number[];
    }
  ) => void;
  setActiveDeckId: React.Dispatch<React.SetStateAction<number | null>>;
  setScrollToDeckId: React.Dispatch<React.SetStateAction<number | null>>;
};

type UseClipLibraryResult = {
  clips: ClipItem[];
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: React.MutableRefObject<ClipItem[]>;
  clipIdRef: React.MutableRefObject<number>;
  clipNameRef: React.MutableRefObject<number>;
  addClip: (clip: Omit<ClipItem, "id" | "url" | "name"> & { name?: string }) => void;
  updateClip: (id: number, updates: Partial<ClipItem>) => void;
  removeClip: (id: number) => void;
  handleLoadClipToDeck: (deckId: number, clip: ClipItem) => Promise<void>;
  handleSaveLoopClip: (deckId: number, includeSettings: boolean) => Promise<void>;
  handleDuplicateLoop: (deckId: number, includeSettings: boolean) => Promise<void>;
  handleCropLoop: (deckId: number) => Promise<void>;
};

const useClipLibrary = ({
  decks,
  automationState,
  addDeck,
  handleFileSelected,
  loadDeckBuffer,
  setActiveDeckId,
  setScrollToDeckId,
}: UseClipLibraryArgs): UseClipLibraryResult => {
  const CLIP_AUTOMATION_SAMPLE_RATE = 30;
  const [clips, setClips] = useState<ClipItem[]>([]);
  const clipsRef = useRef<ClipItem[]>([]);
  const clipIdRef = useRef(1);
  const clipNameRef = useRef(1);
  const clipBufferCacheRef = useRef<Map<number, { blob: Blob; buffer: AudioBuffer }>>(new Map());

  useEffect(() => {
    clipsRef.current = clips;
    const nextIds = new Set<number>();
    clips.forEach((clip) => {
      nextIds.add(clip.id);
      const cached = clipBufferCacheRef.current.get(clip.id);
      if (clip.buffer) {
        clipBufferCacheRef.current.set(clip.id, { blob: clip.blob, buffer: clip.buffer });
        return;
      }
      if (cached && cached.blob !== clip.blob) {
        clipBufferCacheRef.current.delete(clip.id);
      }
    });
    clipBufferCacheRef.current.forEach((_, id) => {
      if (!nextIds.has(id)) {
        clipBufferCacheRef.current.delete(id);
      }
    });
  }, [clips]);

  useEffect(() => {
    return () => {
      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url));
    };
  }, []);

  const addClip = useCallback(
    (clip: Omit<ClipItem, "id" | "url" | "name"> & { name?: string }) => {
      const id = clipIdRef.current;
      clipIdRef.current += 1;
      const generatedName = `Clip ${clipNameRef.current}`;
      const name =
        clip.name === "(input)"
          ? `${generatedName} (input)`
          : clip.name ?? generatedName;
      clipNameRef.current += 1;
      const url = URL.createObjectURL(clip.blob);
      if (clip.buffer) {
        clipBufferCacheRef.current.set(id, { blob: clip.blob, buffer: clip.buffer });
      }
      setClips((prev) => [
        {
          id,
          name,
          blob: clip.blob,
          url,
          durationSec: clip.durationSec,
          buffer: clip.buffer,
          gain: clip.gain,
          balance: clip.balance,
          pitchShift: clip.pitchShift,
          tempoOffset: clip.tempoOffset ?? 0,
          settings: clip.settings,
          applyFxSettings: clip.applyFxSettings ?? false,
        },
        ...prev,
      ]);
    },
    []
  );

  const updateClip = useCallback((id: number, updates: Partial<ClipItem>) => {
    if (updates.buffer && updates.blob) {
      clipBufferCacheRef.current.set(id, { blob: updates.blob, buffer: updates.buffer });
    } else if (updates.buffer) {
      const existing = clipsRef.current.find((clip) => clip.id === id);
      if (existing) {
        clipBufferCacheRef.current.set(id, { blob: existing.blob, buffer: updates.buffer });
      }
    } else if (updates.blob) {
      const cached = clipBufferCacheRef.current.get(id);
      if (cached && cached.blob !== updates.blob) {
        clipBufferCacheRef.current.delete(id);
      }
    }
    setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...updates } : clip)));
  }, []);

  const removeClip = useCallback((id: number) => {
    setClips((prev) => {
      const clip = prev.find((item) => item.id === id);
      if (clip) {
        URL.revokeObjectURL(clip.url);
      }
      clipBufferCacheRef.current.delete(id);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const buildClipSettings = useCallback(
    (deck: DeckState, loopDuration: number): ClipSettings => {
      const automation = automationState.get(deck.id);
      const toSnapshot = (
        track:
          | {
              samples: Float32Array;
              durationSec: number;
              active: boolean;
              currentValue: number;
            }
          | undefined,
        fallback: number
      ) => ({
        samples: Array.from(track?.samples ?? []),
        sampleRate: CLIP_AUTOMATION_SAMPLE_RATE,
        durationSec: track?.durationSec ?? 0,
        active: track?.active ?? false,
        currentValue: track?.currentValue ?? fallback,
      });

      return {
        gain: deck.gain,
        djFilter: deck.djFilter,
        filterResonance: deck.filterResonance,
        eqLowGain: deck.eqLowGain,
        eqMidGain: deck.eqMidGain,
        eqHighGain: deck.eqHighGain,
        eqMode: deck.eqMode,
        parametricEqBands: deck.parametricEqBands,
        simpleAutomation: deck.simpleAutomation,
        balance: deck.balance,
        pitchShift: deck.pitchShift,
        vocoderMix: deck.vocoderMix,
        vocoderCarrierDeckId: deck.vocoderCarrierDeckId,
        vocoderModulatorMonitor: deck.vocoderModulatorMonitor,
        vocoderModDrive: deck.vocoderModDrive,
        tempoOffset: deck.tempoOffset,
        tempoPitchSync: deck.tempoPitchSync,
        stretchRatio: deck.stretchRatio,
        stretchWindowSize: deck.stretchWindowSize,
        stretchStereoWidth: deck.stretchStereoWidth,
        stretchPhaseRandomness: deck.stretchPhaseRandomness,
        stretchTiltDb: deck.stretchTiltDb,
        stretchScatter: deck.stretchScatter,
        delayTime: deck.delayTime,
        delayFeedback: deck.delayFeedback,
        delayMix: deck.delayMix,
        delayTone: deck.delayTone,
        delayPingPong: deck.delayPingPong,
        delaySliceSync: deck.delaySliceSync,
        delaySaturation: deck.delaySaturation,
        delayDamping: deck.delayDamping,
        delaySafety: deck.delaySafety,
        rearrangerSlices: deck.rearrangerSlices,
        rearrangerSwapCount: deck.rearrangerSwapCount,
        rearrangerChaos: deck.rearrangerChaos,
        rearrangerReverse: deck.rearrangerReverse,
        rearrangerSensitivity: deck.rearrangerSensitivity,
        rearrangerQuietThreshold: deck.rearrangerQuietThreshold,
        rearrangerSliceFadeMs: deck.rearrangerSliceFadeMs,
        rearrangerSliceDelaySec: deck.rearrangerSliceDelaySec,
        rearrangerPingPong: deck.rearrangerPingPong,
        rearrangerAuto: deck.rearrangerAuto,
        rearrangerRegions: deck.rearrangerRegions,
        rearrangerRegionIds: deck.rearrangerRegionIds,
        rearrangerRegionsManual: deck.rearrangerRegionsManual ?? false,
        loopEnabled: true,
        loopStartSeconds: 0,
        loopEndSeconds: loopDuration,
        automation: {
          gain: toSnapshot(automation?.gain, deck.gain),
          djFilter: toSnapshot(automation?.djFilter, deck.djFilter),
          resonance: toSnapshot(automation?.resonance, deck.filterResonance),
          eqLow: toSnapshot(automation?.eqLow, deck.eqLowGain),
          eqMid: toSnapshot(automation?.eqMid, deck.eqMidGain),
          eqHigh: toSnapshot(automation?.eqHigh, deck.eqHighGain),
          balance: toSnapshot(automation?.balance, deck.balance),
          pitch: toSnapshot(automation?.pitch, deck.pitchShift),
        },
      };
    },
    [automationState]
  );

  const renderLoopClip = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return null;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return null;
      const sliceDuration = Math.max(0.01, loopEnd - loopStart);
      const sliced = sliceBufferSegment(deck.buffer, loopStart, sliceDuration);
      const blob = encodeWav(sliced);
      const settings = buildClipSettings(deck, sliced.duration);
      return {
        blob,
        durationSec: sliced.duration,
        buffer: sliced,
        gain: 0.9,
        balance: 0,
        pitchShift: 0,
        tempoOffset: 0,
        settings,
        applyFxSettings: includeSettings,
        name: buildDerivedDeckName(deck.fileName, "Loop"),
      };
    },
    [buildClipSettings, decks]
  );

  const handleLoadClipToDeck = useCallback(
    async (deckId: number, clip: ClipItem) => {
      const applyFxSettings = Boolean(clip.settings && clip.applyFxSettings);
      const makeClipFile = (blob: Blob, ext: string, fallbackType: string) =>
        new File([blob], `${clip.name}.${ext}`, {
          type: blob.type || fallbackType,
        });
      await handleFileSelected(
        deckId,
        makeClipFile(clip.blob, "webm", "audio/webm"),
        {
          gain: applyFxSettings ? clip.settings?.gain : clip.gain,
          balance: applyFxSettings ? clip.settings?.balance : clip.balance,
          pitchShift: applyFxSettings ? clip.settings?.pitchShift : clip.pitchShift,
          tempoOffset: applyFxSettings
            ? clip.settings?.tempoOffset
            : clip.tempoOffset ?? 0,
          settings: applyFxSettings ? clip.settings : undefined,
        }
      );
    },
    [handleFileSelected]
  );

  const handleSaveLoopClip = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const clip = await renderLoopClip(deckId, includeSettings);
      if (!clip) return;
      addClip(clip);
    },
    [addClip, renderLoopClip]
  );

  const handleDuplicateLoop = useCallback(
    async (deckId: number, includeSettings: boolean) => {
      const deck = decks.find((item) => item.id === deckId);
      const clip = await renderLoopClip(deckId, includeSettings);
      if (!clip) return;
      const newDeckId = addDeck({ afterId: deckId });
      setActiveDeckId(newDeckId);
      setScrollToDeckId(newDeckId);
      const name = deck
        ? buildDerivedDeckName(deck.fileName, "Duplicate")
        : clip.name;
      const file = new File([clip.blob], `${name}.wav`, {
        type: clip.blob.type || "audio/wav",
      });
      await handleFileSelected(newDeckId, file, {
        settings: includeSettings ? clip.settings : undefined,
      });
    },
    [addDeck, decks, handleFileSelected, renderLoopClip, setActiveDeckId, setScrollToDeckId]
  );

  const handleCropLoop = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck) return;
      const clip = await renderLoopClip(deckId, true);
      if (!clip) return;
      const wasPlaying = deck.status === "playing";
      loadDeckBuffer(deckId, clip.buffer, {
        name: buildDerivedDeckName(deck.fileName, "Crop"),
        autoplay: wasPlaying,
        preserveFxState: true,
      });
    },
    [decks, loadDeckBuffer, renderLoopClip]
  );

  return {
    clips,
    setClips,
    clipsRef,
    clipIdRef,
    clipNameRef,
    addClip,
    updateClip,
    removeClip,
    handleLoadClipToDeck,
    handleSaveLoopClip,
    handleDuplicateLoop,
    handleCropLoop,
  };
};

export default useClipLibrary;
