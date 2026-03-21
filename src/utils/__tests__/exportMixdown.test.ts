import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckState } from "../../types/deck";

const applyGainOffline = vi.fn((context, input) => input);
const applyBalanceOffline = vi.fn((context, input) => input);
const applyPitchShiftOffline = vi.fn((context, input) => input);
const applyDjFilterOffline = vi.fn((context, input) => input);
const applyParametricEqOffline = vi.fn((context, input) => input);
const applyPostEqEffectsOffline = vi.fn((context, input) => input);
const applyMasterProtectOffline = vi.fn((context, input) => input);
const encodeWavOffThread = vi.fn(async () => new Blob(["wav"]));
const warmupWavWorker = vi.fn(() => true);
const getLastWavEncodeStats = vi.fn(() => ({
  usedWorker: true,
  usedFallback: false,
}));

vi.mock("../wavWorkerClient", () => ({
  encodeWavOffThread,
  warmupWavWorker,
  getLastWavEncodeStats,
}));

vi.mock("../../audio/pitchShift", () => ({
  ensurePitchShiftWorklet: vi.fn(async () => {}),
}));

vi.mock("../../audio/effects/postEqPipeline", () => ({
  applyPostEqEffectsOffline,
}));

vi.mock("../../audio/effects/pitchShift", () => ({
  applyPitchShiftOffline,
}));

vi.mock("../../audio/effects/djFilter", () => ({
  applyDjFilterOffline,
}));

vi.mock("../../audio/effects/parametricEq", () => ({
  applyParametricEqOffline,
}));

vi.mock("../../audio/effects/balance", () => ({
  applyBalanceOffline,
}));

vi.mock("../../audio/effects/gain", () => ({
  applyGainOffline,
}));

vi.mock("../../audio/effects/masterProtect", () => ({
  applyMasterProtectOffline,
}));

vi.mock("../../audio/effects/vocoder", () => ({
  createChannelVocoder: vi.fn(() => ({
    input: { connect: vi.fn() },
    carrierInput: { connect: vi.fn() },
    output: { connect: vi.fn() },
  })),
  setChannelVocoderCarrierActive: vi.fn(),
}));

vi.mock("../rearranger", () => ({
  deriveRearrangedRegionIds: vi.fn(() => []),
  deriveRearrangedRegions: vi.fn(() => [0, 1]),
  normalizeRearrangerRegionIds: vi.fn(() => []),
  normalizeRearrangerRegions: vi.fn(() => [0, 1]),
  rearrangeBufferSegment: vi.fn((buffer) => buffer),
}));

vi.mock("../appHelpers", () => ({
  hashStringToUint32: vi.fn(() => 1),
  seededUnitFloat: vi.fn(() => 0.5),
  trimBufferLeadingSamples: vi.fn((context, buffer) => buffer),
}));

vi.mock("../perf", () => ({
  setPerfCounter: vi.fn(),
  setPerfTiming: vi.fn(),
}));

class FakeAudioParam {
  value = 0;

  setValueAtTime = vi.fn();
}

class FakeAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 1 };
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  start = vi.fn();
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeStereoPannerNode extends FakeAudioNode {
  pan = new FakeAudioParam();
}

class FakeOfflineAudioContext {
  destination = new FakeAudioNode();
  sampleRate: number;

  constructor(
    public numberOfChannels: number,
    public length: number,
    sampleRate: number
  ) {
    this.sampleRate = sampleRate;
  }

  createGain() {
    return new FakeGainNode();
  }

  createStereoPanner() {
    return new FakeStereoPannerNode();
  }

  createBufferSource() {
    return new FakeBufferSourceNode();
  }

  async startRendering() {
    return { sampleRate: this.sampleRate } as AudioBuffer;
  }
}

const createDeck = (): DeckState =>
  ({
    id: 1,
    status: "ready",
    gain: 0.9,
    djFilter: 0,
    filterResonance: 0,
    balance: 0,
    pitchShift: 0,
    tempoOffset: 0,
    offsetSeconds: 0,
    zoom: 1,
    loopEnabled: false,
    loopStartSeconds: 0,
    loopEndSeconds: 1,
    parametricEqBands: [],
    simpleAutomation: {},
    delayTime: 0.35,
    delayFeedback: 0.35,
    delayMix: 0,
    delayTone: 6000,
    delayPingPong: false,
    includeInRecordExport: true,
    buffer: {
      sampleRate: 44100,
      duration: 1,
      length: 44100,
      numberOfChannels: 2,
    } as AudioBuffer,
  }) as DeckState;

describe("renderMixdownBlob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
  });

  it("passes deck gain automation into the export gain stage", async () => {
    const { renderMixdownBlob } = await import("../exportMixdown");
    const deck = createDeck();
    const gainTrack = {
      active: true,
      currentValue: 0.4,
      durationSec: 1,
      samples: new Float32Array([0.2, 0.4, 0.8]),
    };

    await renderMixdownBlob({
      decks: [deck],
      automationState: new Map([[deck.id, { gain: gainTrack }]]),
      durationSec: 1,
      sessionName: "test",
      masterGain: 1,
    });

    expect(applyGainOffline).toHaveBeenCalledTimes(1);
    expect(applyGainOffline.mock.calls[0]?.[2]).toMatchObject({
      gain: 0.4,
      renderDuration: 1,
      automation: {
        active: true,
        durationSec: 1,
        samples: gainTrack.samples,
      },
      bypassAt: 0.9,
    });
    expect(encodeWavOffThread).toHaveBeenCalledTimes(1);
  });
});
