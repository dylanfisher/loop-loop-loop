type MidiParametricBandSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type MidiParametricBandActionId =
  | `deck.parametricBand${MidiParametricBandSlot}.frequency`
  | `deck.parametricBand${MidiParametricBandSlot}.gain`
  | `deck.parametricBand${MidiParametricBandSlot}.jitter`
  | `deck.parametricBand${MidiParametricBandSlot}.spread`;

export type MidiActionId =
  | "twister.slot1"
  | "twister.slot2"
  | "twister.slot3"
  | "twister.slot4"
  | "twister.slot5"
  | "twister.slot6"
  | "twister.slot7"
  | "twister.slot8"
  | "twister.slot9"
  | "twister.slot10"
  | "twister.slot11"
  | "twister.slot12"
  | "twister.slot13"
  | "twister.slot14"
  | "twister.slot15"
  | "twister.moduleSelect"
  | "twister.deckSelect"
  | "twister.deckPrev"
  | "twister.deckNext"
  | "twister.playPause"
  | "deck.loopDelay"
  | "deck.gain"
  | "deck.filter"
  | "deck.resonance"
  | "deck.balance"
  | "deck.pitch"
  | "deck.vocoderMix"
  | "deck.vocoderMonitor"
  | "deck.vocoderModDrive"
  | "deck.vocoderBands"
  | "deck.vocoderVocalCharacter"
  | "deck.vocoderFormantShift"
  | "deck.vocoderPreEmphasis"
  | "deck.vocoderTightness"
  | "deck.vocoderAttack"
  | "deck.vocoderRelease"
  | "deck.vocoderPhaseRotate"
  | "deck.vocoderGate"
  | "deck.delayMix"
  | "deck.delayTime"
  | "deck.delayFeedback"
  | "deck.delayTone"
  | "deck.delayDriveFb"
  | "deck.delayDamping"
  | "deck.delaySafety"
  | "deck.delayPitchMix"
  | "deck.delayPitchStep"
  | "deck.delaySpectralMix"
  | "deck.delaySpectralSpread"
  | "deck.delaySpectralMotion"
  | "deck.spectralSpaceMix"
  | "deck.spectralSpaceSpread"
  | "deck.spectralSpaceMotion"
  | "deck.spectralSpaceTilt"
  | "deck.spectralSpaceLowMono"
  | "deck.spectralSpaceTransientProtect"
  | "deck.rearrangerSlices"
  | "deck.rearrangerSwaps"
  | "deck.rearrangerChaos"
  | "deck.rearrangerReverse"
  | "deck.rearrangerSensitivity"
  | "deck.rearrangerQuietThreshold"
  | "deck.rearrangerSliceFade"
  | "deck.rearrangerSliceDelay"
  | "deck.rearrangerPingPong"
  | "deck.stretchAmount"
  | "deck.stretchPhase"
  | "deck.stretchWidth"
  | "deck.stretchTilt"
  | "deck.stretchScatter"
  | "deck.stretchWindow"
  | "deck.parametricScale"
  | MidiParametricBandActionId
  | "master.gain";

export type MidiActionDefinition = {
  id: MidiActionId;
  label: string;
  min: number;
  max: number;
  relativeStep: number;
};

const PARAMETRIC_BAND_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const PARAMETRIC_BAND_ACTIONS: MidiActionDefinition[] = PARAMETRIC_BAND_SLOTS.flatMap((slot) => [
  {
    id: `deck.parametricBand${slot}.frequency` as MidiActionId,
    label: `PEQ Band ${slot} Freq`,
    min: 0,
    max: 1,
    relativeStep: 0.02,
  },
  {
    id: `deck.parametricBand${slot}.gain` as MidiActionId,
    label: `PEQ Band ${slot} Gain`,
    min: -18,
    max: 18,
    relativeStep: 0.3,
  },
  {
    id: `deck.parametricBand${slot}.jitter` as MidiActionId,
    label: `PEQ Band ${slot} Jitter`,
    min: 0,
    max: 1,
    relativeStep: 0.02,
  },
  {
    id: `deck.parametricBand${slot}.spread` as MidiActionId,
    label: `PEQ Band ${slot} Spread`,
    min: 0,
    max: 1,
    relativeStep: 0.02,
  },
]);

export const MIDI_ACTIONS: MidiActionDefinition[] = [
  { id: "twister.slot1", label: "Twister Slot 1", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot2", label: "Twister Slot 2", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot3", label: "Twister Slot 3", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot4", label: "Twister Slot 4", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot5", label: "Twister Slot 5", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot6", label: "Twister Slot 6", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot7", label: "Twister Slot 7", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot8", label: "Twister Slot 8", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot9", label: "Twister Slot 9", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot10", label: "Twister Slot 10", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot11", label: "Twister Slot 11", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot12", label: "Twister Slot 12", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot13", label: "Twister Slot 13", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot14", label: "Twister Slot 14", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.slot15", label: "Twister Slot 15", min: 0, max: 1, relativeStep: 0.02 },
  { id: "twister.moduleSelect", label: "Twister Module Select", min: 0, max: 1, relativeStep: 0.05 },
  { id: "twister.deckSelect", label: "Twister Deck Select", min: 0, max: 1, relativeStep: 0.05 },
  { id: "twister.deckPrev", label: "Twister Deck Previous", min: 0, max: 1, relativeStep: 1 },
  { id: "twister.deckNext", label: "Twister Deck Next", min: 0, max: 1, relativeStep: 1 },
  { id: "twister.playPause", label: "Twister Play/Pause", min: 0, max: 1, relativeStep: 1 },
  { id: "deck.loopDelay", label: "Loop Delay", min: 0, max: 60, relativeStep: 0.1 },
  { id: "deck.gain", label: "Deck Gain", min: 0, max: 1.5, relativeStep: 0.02 },
  { id: "deck.filter", label: "Deck Filter", min: -1, max: 1, relativeStep: 0.04 },
  { id: "deck.resonance", label: "Deck Resonance", min: 0, max: 24, relativeStep: 0.2 },
  { id: "deck.balance", label: "Deck Balance", min: -1, max: 1, relativeStep: 0.04 },
  { id: "deck.pitch", label: "Deck Pitch", min: -24, max: 24, relativeStep: 0.2 },
  { id: "deck.vocoderMix", label: "Vocoder Mix", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.vocoderMonitor", label: "Vocoder Monitor", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.vocoderModDrive", label: "Vocoder Mod Drive", min: 0.5, max: 10, relativeStep: 0.1 },
  { id: "deck.vocoderBands", label: "Vocoder Bands", min: 4, max: 24, relativeStep: 1 },
  {
    id: "deck.vocoderVocalCharacter",
    label: "Vocoder Vocal Character",
    min: 0,
    max: 3,
    relativeStep: 0.05,
  },
  {
    id: "deck.vocoderFormantShift",
    label: "Vocoder Formant Shift",
    min: -12,
    max: 12,
    relativeStep: 0.2,
  },
  { id: "deck.vocoderPreEmphasis", label: "Vocoder Pre-Emphasis", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.vocoderTightness", label: "Vocoder Tightness", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.vocoderAttack", label: "Vocoder Attack", min: 1, max: 160, relativeStep: 2 },
  { id: "deck.vocoderRelease", label: "Vocoder Release", min: 1, max: 1200, relativeStep: 10 },
  { id: "deck.vocoderPhaseRotate", label: "Vocoder Phase Rotate", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.vocoderGate", label: "Vocoder Gate", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delayMix", label: "Delay Mix", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delayTime", label: "Delay Time", min: 0.01, max: 1.5, relativeStep: 0.02 },
  { id: "deck.delayFeedback", label: "Delay Feedback", min: 0, max: 0.99, relativeStep: 0.015 },
  { id: "deck.delayTone", label: "Delay Tone", min: 400, max: 12000, relativeStep: 120 },
  { id: "deck.delayDriveFb", label: "Delay Drive FB", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delayDamping", label: "Delay Damping", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delaySafety", label: "Delay Safety", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delayPitchMix", label: "Delay Pitch Mix", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delayPitchStep", label: "Delay Pitch Step", min: -12, max: 12, relativeStep: 0.2 },
  { id: "deck.delaySpectralMix", label: "Delay Spectral Mix", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delaySpectralSpread", label: "Delay Spectral Spread", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.delaySpectralMotion", label: "Delay Spectral Motion", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.spectralSpaceMix", label: "Spectral Space Mix", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.spectralSpaceSpread", label: "Spectral Space Spread", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.spectralSpaceMotion", label: "Spectral Space Motion", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.spectralSpaceTilt", label: "Spectral Space Tilt", min: -1, max: 1, relativeStep: 0.04 },
  { id: "deck.spectralSpaceLowMono", label: "Spectral Space Low Mono", min: 0, max: 1, relativeStep: 0.02 },
  {
    id: "deck.spectralSpaceTransientProtect",
    label: "Spectral Space Transient",
    min: 0,
    max: 1,
    relativeStep: 0.02,
  },
  { id: "deck.rearrangerSlices", label: "Rearranger Slices", min: 1, max: 64, relativeStep: 1 },
  { id: "deck.rearrangerSwaps", label: "Rearranger Swaps", min: 0, max: 64, relativeStep: 1 },
  { id: "deck.rearrangerChaos", label: "Rearranger Chaos", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.rearrangerReverse", label: "Rearranger Reverse", min: 0, max: 1, relativeStep: 0.02 },
  {
    id: "deck.rearrangerSensitivity",
    label: "Rearranger Sensitivity",
    min: 0,
    max: 1,
    relativeStep: 0.02,
  },
  {
    id: "deck.rearrangerQuietThreshold",
    label: "Rearranger Quiet Threshold",
    min: 0,
    max: 1,
    relativeStep: 0.02,
  },
  { id: "deck.rearrangerSliceFade", label: "Rearranger Slice Fade", min: 0, max: 12, relativeStep: 1 },
  { id: "deck.rearrangerSliceDelay", label: "Rearranger Slice Delay", min: 0, max: 5, relativeStep: 0.05 },
  { id: "deck.rearrangerPingPong", label: "Rearranger Ping Pong", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.stretchAmount", label: "Stretch Amount", min: 1, max: 16, relativeStep: 0.1 },
  { id: "deck.stretchPhase", label: "Stretch Phase", min: 0, max: 1, relativeStep: 0.02 },
  { id: "deck.stretchWidth", label: "Stretch Width", min: 0, max: 2, relativeStep: 0.05 },
  { id: "deck.stretchTilt", label: "Stretch Tilt", min: -18, max: 18, relativeStep: 0.2 },
  { id: "deck.stretchScatter", label: "Stretch Scatter", min: 1, max: 16, relativeStep: 0.1 },
  { id: "deck.stretchWindow", label: "Stretch Window", min: 1, max: 4, relativeStep: 1 },
  { id: "deck.parametricScale", label: "PEQ Scale", min: 0, max: 200, relativeStep: 1 },
  ...PARAMETRIC_BAND_ACTIONS,
  { id: "master.gain", label: "Master Gain", min: 0, max: 1.5, relativeStep: 0.02 },
];

export const TWISTER_PROFILE_PAGES: Array<{ bank: 1 | 2 | 3 | 4; actions: MidiActionId[] }> = [
  {
    bank: 1,
    actions: [
      "deck.gain",
      "deck.filter",
      "deck.balance",
      "deck.pitch",
      "master.gain",
      "deck.delayMix",
      "deck.delayTime",
      "deck.delayFeedback",
      "deck.delayTone",
      "deck.delaySpectralMix",
      "deck.delaySpectralSpread",
      "deck.delaySpectralMotion",
      "deck.spectralSpaceMix",
    ],
  },
  {
    bank: 2,
    actions: [
      "deck.spectralSpaceMix",
      "deck.spectralSpaceSpread",
      "deck.spectralSpaceMotion",
      "deck.spectralSpaceTilt",
      "deck.spectralSpaceLowMono",
      "deck.spectralSpaceTransientProtect",
      "deck.delaySpectralMix",
      "deck.delaySpectralSpread",
      "deck.delaySpectralMotion",
      "deck.delayMix",
      "deck.delayTime",
      "deck.delayFeedback",
      "deck.delayTone",
      "deck.filter",
      "deck.balance",
      "master.gain",
    ],
  },
  {
    bank: 3,
    actions: [
      "deck.filter",
      "deck.gain",
      "deck.pitch",
      "deck.balance",
      "master.gain",
      "deck.delayMix",
      "deck.delayFeedback",
      "deck.delayTime",
      "deck.delayTone",
      "deck.spectralSpaceMix",
      "deck.spectralSpaceSpread",
      "deck.spectralSpaceMotion",
      "deck.spectralSpaceTilt",
    ],
  },
  {
    bank: 4,
    actions: [
      "deck.gain",
      "deck.delayMix",
      "deck.delayFeedback",
      "deck.delayTime",
      "deck.delayTone",
      "deck.delaySpectralMix",
      "deck.delaySpectralSpread",
      "deck.delaySpectralMotion",
      "deck.spectralSpaceMix",
      "deck.spectralSpaceSpread",
      "deck.spectralSpaceMotion",
      "deck.spectralSpaceTransientProtect",
      "master.gain",
    ],
  },
];

export type MidiLearnMode = "absolute" | "relative";

export type MidiBinding = {
  id: string;
  inputId: string;
  inputName: string;
  messageType: "cc" | "note";
  channel: number;
  number: number;
  actionId: MidiActionId;
  mode: MidiLearnMode;
};

export type MidiMappedValue = {
  binding: MidiBinding;
  absolute01: number | null;
  relativeDelta: number;
  rawValue: number;
};
