import { useCallback, useEffect, useRef, useState } from "react";
import DeckStack from "./components/DeckStack";
import ClipRecorder from "./components/ClipRecorder";
import TransportBar from "./components/TransportBar";
import useDecks from "./hooks/useDecks";
import type { ClipItem } from "./types/clip";
import { encodeWav } from "./utils/audio";

const App = () => {
  console.info("App: render");
  const [clips, setClips] = useState<ClipItem[]>([]);
  const clipIdRef = useRef(1);
  const clipNameRef = useRef(1);
  const clipsRef = useRef<ClipItem[]>([]);
  const {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    setFileInputRef,
    setDeckGain,
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    seekDeck,
    setDeckZoom,
    setDeckLoop,
    setDeckLoopBounds,
    setDeckBpmOverride,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
    getDeckPosition,
    getDeckPlaybackSnapshot,
  } = useDecks();

  const getFilterTargets = useCallback((djFilter: number) => {
    const min = 60;
    const max = 20000;
    const highpassMax = 12000;
    const normalized = Math.min(Math.max(djFilter, -1), 1);
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const logHighMax = Math.log10(highpassMax);
    if (normalized < 0) {
      const t = 1 + normalized;
      const lowpass = Math.pow(10, logMin + t * (logMax - logMin));
      return { lowpass, highpass: min };
    }
    if (normalized > 0) {
      const t = normalized;
      const highpass = Math.pow(10, logMin + t * (logHighMax - logMin));
      return { lowpass: max, highpass };
    }
    return { lowpass: max, highpass: min };
  }, []);

  const scheduleLoopedSamples = (
    samples: Float32Array,
    durationSec: number,
    renderDuration: number,
    onValue: (value: number, time: number) => void
  ) => {
    if (!durationSec || samples.length === 0 || renderDuration <= 0) return;
    const sampleRate = samples.length / durationSec;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    const totalSteps = Math.max(1, Math.ceil(renderDuration * sampleRate));
    for (let i = 0; i < totalSteps; i += 1) {
      const time = i / sampleRate;
      const value = samples[i % samples.length] ?? 0;
      onValue(value, time);
    }
  };

  useEffect(() => {
    clipsRef.current = clips;
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
      const name = clip.name ?? `Clip ${clipNameRef.current}`;
      clipNameRef.current += 1;
      const url = URL.createObjectURL(clip.blob);
      setClips((prev) => [
        {
          id,
          name,
          blob: clip.blob,
          url,
          durationSec: clip.durationSec,
          buffer: clip.buffer,
          bpm: clip.bpm,
        },
        ...prev,
      ]);
    },
    []
  );

  const updateClip = useCallback((id: number, updates: Partial<ClipItem>) => {
    setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...updates } : clip)));
  }, []);

  const handleSaveLoopClip = useCallback(
    (deckId: number) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.buffer) return;
      const duration = deck.duration ?? deck.buffer.duration;
      const loopStart = Math.max(0, deck.loopStartSeconds ?? 0);
      const loopEnd =
        deck.loopEndSeconds && deck.loopEndSeconds > loopStart + 0.01
          ? Math.min(deck.loopEndSeconds, duration)
          : duration;
      if (loopEnd <= loopStart + 0.01) return;
      const baseBpm = deck.bpmOverride ?? deck.bpm ?? null;
      const tempoRatio =
        deck.bpm && deck.bpmOverride ? deck.bpmOverride / deck.bpm : 1;
      const sliceDuration = Math.max(0.01, loopEnd - loopStart);
      const renderDuration = sliceDuration / Math.max(0.01, tempoRatio);
      const sampleRate = deck.buffer.sampleRate;
      const length = Math.max(1, Math.ceil(renderDuration * sampleRate));
      const offline = new OfflineAudioContext(
        deck.buffer.numberOfChannels,
        length,
        sampleRate
      );
      const source = offline.createBufferSource();
      source.buffer = deck.buffer;
      source.playbackRate.value = tempoRatio;
      const highpass = offline.createBiquadFilter();
      highpass.type = "highpass";
      const lowpass = offline.createBiquadFilter();
      lowpass.type = "lowpass";
      const eqLow = offline.createBiquadFilter();
      eqLow.type = "lowshelf";
      eqLow.frequency.value = 120;
      const eqMid = offline.createBiquadFilter();
      eqMid.type = "peaking";
      eqMid.frequency.value = 1000;
      const eqHigh = offline.createBiquadFilter();
      eqHigh.type = "highshelf";
      eqHigh.frequency.value = 8000;
      const gainNode = offline.createGain();

      const automation = automationState.get(deckId);
      const djFilterTrack = automation?.djFilter;
      const resonanceTrack = automation?.resonance;
      const eqLowTrack = automation?.eqLow;
      const eqMidTrack = automation?.eqMid;
      const eqHighTrack = automation?.eqHigh;

      const djFilterValue = djFilterTrack?.active ? djFilterTrack.currentValue : deck.djFilter;
      const resonanceValue = resonanceTrack?.active
        ? resonanceTrack.currentValue
        : deck.filterResonance;
      const eqLowValue = eqLowTrack?.active ? eqLowTrack.currentValue : deck.eqLowGain;
      const eqMidValue = eqMidTrack?.active ? eqMidTrack.currentValue : deck.eqMidGain;
      const eqHighValue = eqHighTrack?.active ? eqHighTrack.currentValue : deck.eqHighGain;

      const targets = getFilterTargets(djFilterValue);
      highpass.frequency.value = targets.highpass;
      lowpass.frequency.value = targets.lowpass;
      highpass.Q.value = resonanceValue;
      lowpass.Q.value = resonanceValue;
      eqLow.gain.value = eqLowValue;
      eqMid.gain.value = eqMidValue;
      eqHigh.gain.value = eqHighValue;
      gainNode.gain.value = deck.gain;

      if (djFilterTrack?.active && djFilterTrack.durationSec > 0) {
        scheduleLoopedSamples(
          djFilterTrack.samples,
          djFilterTrack.durationSec,
          renderDuration,
          (value, time) => {
            const nextTargets = getFilterTargets(value);
            lowpass.frequency.setValueAtTime(nextTargets.lowpass, time);
            highpass.frequency.setValueAtTime(nextTargets.highpass, time);
          }
        );
      }
      if (resonanceTrack?.active && resonanceTrack.durationSec > 0) {
        scheduleLoopedSamples(
          resonanceTrack.samples,
          resonanceTrack.durationSec,
          renderDuration,
          (value, time) => {
            lowpass.Q.setValueAtTime(value, time);
            highpass.Q.setValueAtTime(value, time);
          }
        );
      }
      if (eqLowTrack?.active && eqLowTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqLowTrack.samples,
          eqLowTrack.durationSec,
          renderDuration,
          (value, time) => {
            eqLow.gain.setValueAtTime(value, time);
          }
        );
      }
      if (eqMidTrack?.active && eqMidTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqMidTrack.samples,
          eqMidTrack.durationSec,
          renderDuration,
          (value, time) => {
            eqMid.gain.setValueAtTime(value, time);
          }
        );
      }
      if (eqHighTrack?.active && eqHighTrack.durationSec > 0) {
        scheduleLoopedSamples(
          eqHighTrack.samples,
          eqHighTrack.durationSec,
          renderDuration,
          (value, time) => {
            eqHigh.gain.setValueAtTime(value, time);
          }
        );
      }

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(gainNode);
      gainNode.connect(offline.destination);
      source.start(0, loopStart, renderDuration);
      void offline.startRendering().then((rendered) => {
        const blob = encodeWav(rendered);
        addClip({
          blob,
          durationSec: rendered.duration,
          buffer: rendered,
          bpm: baseBpm,
          name: `${deck.fileName ? `${deck.fileName} ` : ""}Loop`,
        });
      });
    },
    [addClip, automationState, decks, getFilterTargets]
  );

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">Loop Loop Loop</div>
        <div className="app__status">Audio engine: idle</div>
      </header>

      <main className="app__main">
        <ClipRecorder
          decks={decks}
          clips={clips}
          onLoadClip={handleFileSelected}
          onAddClip={addClip}
          onUpdateClip={updateClip}
        />
        <DeckStack
          decks={decks}
          onAddDeck={addDeck}
          onRemoveDeck={removeDeck}
          onLoadClick={handleLoadClick}
          onFileSelected={handleFileSelected}
          onPlay={playDeck}
          onPause={pauseDeck}
          onGainChange={setDeckGain}
          onFilterChange={setDeckFilter}
          onResonanceChange={setDeckResonance}
          onEqLowChange={setDeckEqLow}
          onEqMidChange={setDeckEqMid}
          onEqHighChange={setDeckEqHigh}
          onSeek={seekDeck}
          onZoomChange={setDeckZoom}
          onLoopChange={setDeckLoop}
          onLoopBoundsChange={setDeckLoopBounds}
          onBpmOverrideChange={setDeckBpmOverride}
          automationState={automationState}
          onAutomationStart={startAutomationRecording}
          onAutomationStop={stopAutomationRecording}
          onAutomationValueChange={updateAutomationValue}
          getAutomationPlayhead={getAutomationPlayhead}
          onAutomationToggle={toggleAutomationActive}
          onAutomationReset={resetAutomationTrack}
          getDeckPosition={getDeckPosition}
          getDeckPlaybackSnapshot={getDeckPlaybackSnapshot}
          setFileInputRef={setFileInputRef}
          onSaveLoopClip={handleSaveLoopClip}
        />
      </main>

      <TransportBar />
    </div>
  );
};

export default App;
