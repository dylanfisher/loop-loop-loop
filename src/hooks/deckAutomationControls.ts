import type { MutableRefObject } from "react";
import type { DeckState } from "../types/deck";
import type { AutomationParam } from "../types/session";
import { MIN_AUTOMATION_DURATION, type AutomationDeck } from "./useDecksShared";

type Args = {
  decks: DeckState[];
  automationRef: MutableRefObject<Map<number, AutomationDeck>>;
  automationPlayheadRef: MutableRefObject<Map<number, Record<AutomationParam, number>>>;
  ensureAutomationDeck: (deckId: number, deck: DeckState) => AutomationDeck;
  updateAutomationView: (deckId: number) => void;
  updateAutomationTickEnabled: () => void;
  setDeckGainValue: (id: number, value: number) => void;
  setDeckFilterValue: (id: number, value: number) => void;
  setDeckResonanceValue: (id: number, value: number) => void;
  setDeckEqLowValue: (id: number, value: number) => void;
  setDeckEqMidValue: (id: number, value: number) => void;
  setDeckEqHighValue: (id: number, value: number) => void;
  setDeckBalanceValue: (id: number, value: number) => void;
  setDeckPitchShiftValue: (id: number, value: number) => void;
};

const getDeckParamValue = (deck: DeckState, param: AutomationParam) => {
  if (param === "gain") return deck.gain;
  if (param === "djFilter") return deck.djFilter;
  if (param === "resonance") return deck.filterResonance;
  if (param === "eqLow") return deck.eqLowGain;
  if (param === "eqMid") return deck.eqMidGain;
  if (param === "eqHigh") return deck.eqHighGain;
  if (param === "balance") return deck.balance;
  return deck.pitchShift;
};

export const createDeckAutomationControls = ({
  decks,
  automationRef,
  automationPlayheadRef,
  ensureAutomationDeck,
  updateAutomationView,
  updateAutomationTickEnabled,
  setDeckGainValue,
  setDeckFilterValue,
  setDeckResonanceValue,
  setDeckEqLowValue,
  setDeckEqMidValue,
  setDeckEqHighValue,
  setDeckBalanceValue,
  setDeckPitchShiftValue,
}: Args) => {
  const startAutomationRecording = (id: number, param: AutomationParam) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck) return;
    if (param === "pitch" && deck.tempoPitchSync) return;
    const automation = ensureAutomationDeck(id, deck);
    const track = automation[param];
    track.recording = true;
    track.active = true;
    track.paused = false;
    track.pausedPositionSec = 0;
    track.amplitudeScale = 1;
    track.recordBuffer = [];
    track.samples = new Float32Array(0);
    track.durationSec = 0;
    track.recordStartMs = performance.now();
    track.lastSampleMs = track.recordStartMs;
    track.lastPreviewLength = 0;
    track.currentValue = getDeckParamValue(deck, param);
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const stopAutomationRecording = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    if (!track.recording) return;
    track.recording = false;
    const duration = track.recordBuffer.length / track.sampleRate;
    if (duration >= MIN_AUTOMATION_DURATION) {
      track.samples = new Float32Array(track.recordBuffer);
      track.durationSec = duration;
      track.playbackStartMs = performance.now();
    } else {
      track.samples = new Float32Array(0);
      track.durationSec = 0;
    }
    track.amplitudeScale = 1;
    track.recordBuffer = [];
    track.lastPreviewLength = 0;
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const updateAutomationValue = (id: number, param: AutomationParam, value: number) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const deck = decks.find((item) => item.id === id);
    if (param === "pitch" && deck?.tempoPitchSync) return;
    const track = automation[param];
    track.currentValue = value;
    if (param === "gain") {
      setDeckGainValue(id, value);
    } else if (param === "djFilter") {
      setDeckFilterValue(id, value);
    } else if (param === "resonance") {
      setDeckResonanceValue(id, value);
    } else if (param === "eqLow") {
      setDeckEqLowValue(id, value);
    } else if (param === "eqMid") {
      setDeckEqMidValue(id, value);
    } else if (param === "eqHigh") {
      setDeckEqHighValue(id, value);
    } else if (param === "balance") {
      setDeckBalanceValue(id, value);
    } else {
      setDeckPitchShiftValue(id, value);
    }
    if (track.active) {
      updateAutomationView(id);
    }
  };

  const getAutomationPlayhead = (id: number, param: AutomationParam) => {
    const playheads = automationPlayheadRef.current.get(id);
    return playheads ? playheads[param] : 0;
  };

  const toggleAutomationActive = (id: number, param: AutomationParam, next: boolean) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const deck = decks.find((item) => item.id === id);
    if (param === "pitch" && deck?.tempoPitchSync) return;
    const track = automation[param];
    track.active = next;
    if (next) {
      track.playbackStartMs = performance.now();
    }
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  const resetAutomationTrack = (id: number, param: AutomationParam) => {
    const automation = automationRef.current.get(id);
    if (!automation) return;
    const track = automation[param];
    track.samples = new Float32Array(0);
    track.recordBuffer = [];
    track.durationSec = 0;
    track.recording = false;
    track.active = false;
    track.paused = false;
    track.pausedPositionSec = 0;
    track.amplitudeScale = 1;
    track.playbackStartMs = 0;
    track.lastPreviewLength = 0;
    updateAutomationView(id);
    updateAutomationTickEnabled();
  };

  return {
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
  };
};

