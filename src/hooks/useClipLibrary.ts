import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "../utils/audio";
import { buildDerivedDeckName, sliceBufferSegment } from "../utils/appHelpers";
import type { ClipItem } from "../types/clip";
import type { DeckState } from "../types/deck";
import type { AutomationSnapshot, ClipSettings } from "../types/session";

type UseClipLibraryArgs = {
  decks: DeckState[];
  automationState: Map<
    number,
    Partial<
      Record<
        "gain" | "djFilter" | "resonance" | "balance" | "pitch",
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
  applyDeckFxPanelStatePatch: (patch: Record<number, Partial<DeckState["fxPanelOpen"]>>) => void;
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
  applyDeckFxPanelStatePatch,
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
    (deck: DeckState, loopStartSeconds: number, loopDuration: number): ClipSettings => {
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
      ): AutomationSnapshot => {
        const sourceSamples = Array.from(track?.samples ?? []);
        const sourceDuration = track?.durationSec ?? 0;
        const hasSource = sourceSamples.length > 0 && sourceDuration > 0;
        const sourceSampleRate = hasSource
          ? Math.max(1, sourceSamples.length / sourceDuration)
          : CLIP_AUTOMATION_SAMPLE_RATE;
        if (!hasSource) {
          return {
            samples: sourceSamples,
            sampleRate: sourceSampleRate,
            durationSec: sourceDuration,
            active: track?.active ?? false,
            currentValue: track?.currentValue ?? fallback,
          };
        }
        const offsetSeconds =
          ((loopStartSeconds % sourceDuration) + sourceDuration) % sourceDuration;
        const offsetIndex = Math.min(
          sourceSamples.length - 1,
          Math.max(0, Math.floor(offsetSeconds * sourceSampleRate))
        );
        const alignedSamples =
          offsetIndex === 0
            ? sourceSamples
            : [...sourceSamples.slice(offsetIndex), ...sourceSamples.slice(0, offsetIndex)];

        return {
          samples: alignedSamples,
          sampleRate: sourceSampleRate,
          durationSec: sourceDuration,
          active: track?.active ?? false,
          currentValue: alignedSamples[0] ?? fallback,
        };
      };

      return {
        gain: deck.gain,
        djFilter: deck.djFilter,
        filterResonance: deck.filterResonance,
        parametricEqBands: deck.parametricEqBands,
        simpleAutomation: deck.simpleAutomation,
        balance: deck.balance,
        pitchShift: deck.pitchShift,
        vocoderMix: deck.vocoderMix,
        vocoderCarrierDeckId: deck.vocoderCarrierDeckId,
        vocoderModulatorMonitor: deck.vocoderModulatorMonitor,
        vocoderModDrive: deck.vocoderModDrive,
        vocoderBandCount: deck.vocoderBandCount,
        vocoderBandSpread: deck.vocoderBandSpread,
        vocoderVocalCharacter: deck.vocoderVocalCharacter,
        vocoderFormantShift: deck.vocoderFormantShift,
        vocoderConsonantBoost: deck.vocoderConsonantBoost,
        vocoderPreEmphasis: deck.vocoderPreEmphasis,
        vocoderTightness: deck.vocoderTightness,
        vocoderAttackMs: deck.vocoderAttackMs,
        vocoderReleaseMs: deck.vocoderReleaseMs,
        vocoderNoiseMix: deck.vocoderNoiseMix,
        vocoderGateThreshold: deck.vocoderGateThreshold,
        vocoderPostDelay: deck.vocoderPostDelay,
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
        delayRhythmMorph: deck.delayRhythmMorph,
        delayRhythmRateHz: deck.delayRhythmRateHz,
        delayRhythmSwing: deck.delayRhythmSwing,
        delayDuckDepth: deck.delayDuckDepth,
        delayDuckThreshold: deck.delayDuckThreshold,
        delayDuckResponseMs: deck.delayDuckResponseMs,
        delaySpectralMix: deck.delaySpectralMix,
        delaySpectralSpread: deck.delaySpectralSpread,
        delaySpectralMotion: deck.delaySpectralMotion,
        spectralSpaceMix: deck.spectralSpaceMix,
        spectralSpaceSpread: deck.spectralSpaceSpread,
        spectralSpaceMotion: deck.spectralSpaceMotion,
        spectralSpaceTilt: deck.spectralSpaceTilt,
        spectralSpaceLowMono: deck.spectralSpaceLowMono,
        spectralSpaceTransientProtect: deck.spectralSpaceTransientProtect,
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
        loopDelaySec: deck.loopDelaySec,
        automation: {
          gain: toSnapshot(automation?.gain, deck.gain),
          djFilter: toSnapshot(automation?.djFilter, deck.djFilter),
          resonance: toSnapshot(automation?.resonance, deck.filterResonance),
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
      const settings = buildClipSettings(deck, loopStart, sliced.duration);
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
      const targetDeck = decks.find((item) => item.id === deckId);
      if (targetDeck?.buffer) {
        const existingName = targetDeck.fileName ? ` "${targetDeck.fileName}"` : "";
        const confirmed = window.confirm(
          `Replace deck${existingName} with "${clip.name}"?`
        );
        if (!confirmed) return;
      }
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
    [decks, handleFileSelected]
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
      if (deck) {
        applyDeckFxPanelStatePatch({
          [newDeckId]: { ...deck.fxPanelOpen },
        });
      }
    },
    [
      addDeck,
      applyDeckFxPanelStatePatch,
      decks,
      handleFileSelected,
      renderLoopClip,
      setActiveDeckId,
      setScrollToDeckId,
    ]
  );

  const handleCropLoop = useCallback(
    async (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck) return;
      const duration = deck.duration ?? deck.buffer?.duration ?? 0;
      if (duration > 0) {
        const epsilon = 0.001;
        const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
        const loopEnd =
          deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
            ? Math.min(deck.loopEndSeconds, duration)
            : duration;
        const hasFullLoop = loopStart <= epsilon && Math.abs(loopEnd - duration) <= epsilon;
        if (hasFullLoop) return;
      }
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
