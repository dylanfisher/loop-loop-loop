import { describe, expect, it, vi } from "vitest";
import {
  applyParametricEqOffline,
  evaluateParametricEqResponseDb,
  fitParametricEqBandsToCurve,
} from "../parametricEq";
import type { ParametricEqBand } from "../../../types/deck";

type FakeAudioParam = {
  setValueAtTime: ReturnType<typeof vi.fn>;
  setValueCurveAtTime: ReturnType<typeof vi.fn>;
};

type FakeFilterNode = {
  type: BiquadFilterType;
  frequency: FakeAudioParam;
  gain: FakeAudioParam;
  Q: FakeAudioParam;
  connect: ReturnType<typeof vi.fn>;
};

type FakeGainNode = {
  gain: FakeAudioParam;
  connect: ReturnType<typeof vi.fn>;
};

const createFakeAudioParam = (): FakeAudioParam => ({
  setValueAtTime: vi.fn(),
  setValueCurveAtTime: vi.fn(),
});

const createFakeFilterNode = (): FakeFilterNode => ({
  type: "peaking",
  frequency: createFakeAudioParam(),
  gain: createFakeAudioParam(),
  Q: createFakeAudioParam(),
  connect: vi.fn(),
});

const createFakeGainNode = (): FakeGainNode => ({
  gain: createFakeAudioParam(),
  connect: vi.fn(),
});

const createFakeOfflineContext = () => {
  const nodes: FakeFilterNode[] = [];
  const gains: FakeGainNode[] = [];
  return {
    nodes,
    gains,
    context: {
      createBiquadFilter: vi.fn(() => {
        const node = createFakeFilterNode();
        nodes.push(node);
        return node;
      }),
      createGain: vi.fn(() => {
        const node = createFakeGainNode();
        gains.push(node);
        return node;
      }),
      sampleRate: 44100,
    } as unknown as OfflineAudioContext,
  };
};

const createBaseBand = (overrides: Partial<ParametricEqBand> = {}): ParametricEqBand => ({
  id: "peq-1",
  type: "peaking",
  frequency: 1200,
  gain: 6,
  q: 1.2,
  enabled: true,
  ...overrides,
});

describe("applyParametricEqOffline", () => {
  it("uses value curves for wander-enabled bands in offline render", () => {
    const { context, nodes, gains } = createFakeOfflineContext();
    const input = { connect: vi.fn() } as unknown as AudioNode;
    const renderDuration = 2;
    const band = createBaseBand({
      wander: {
        jitter: 0.7,
        spread: 0.8,
        seed: 1.23,
        baseFrequency: 1000,
        baseGain: 2,
      },
    });

    const output = applyParametricEqOffline(context, input, [band], renderDuration);
    const node = nodes[0];
    const outputGain = gains.at(-1);
    expect(output).toBe(outputGain);
    expect((input.connect as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(node);
    expect(node.connect).toHaveBeenCalledWith(outputGain);
    expect(outputGain.gain.setValueAtTime).toHaveBeenCalledTimes(1);

    expect(node.frequency.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    expect(node.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    const [freqCurve, freqStart, freqDuration] = node.frequency.setValueCurveAtTime.mock.calls[0];
    const [gainCurve, gainStart, gainDuration] = node.gain.setValueCurveAtTime.mock.calls[0];
    expect(freqCurve).toBeInstanceOf(Float32Array);
    expect(gainCurve).toBeInstanceOf(Float32Array);
    expect((freqCurve as Float32Array).length).toBe(Math.ceil(renderDuration * 30));
    expect((gainCurve as Float32Array).length).toBe(Math.ceil(renderDuration * 30));
    expect(freqStart).toBe(0);
    expect(gainStart).toBe(0);
    expect(freqDuration).toBe(renderDuration);
    expect(gainDuration).toBe(renderDuration);
  });

  it("keeps static automation path when wander is not active", () => {
    const { context, nodes, gains } = createFakeOfflineContext();
    const input = { connect: vi.fn() } as unknown as AudioNode;
    const renderDuration = 3;
    const band = createBaseBand({
      wander: {
        jitter: 0,
        spread: 0,
        seed: 0.5,
        baseFrequency: 1200,
        baseGain: 6,
      },
    });

    applyParametricEqOffline(context, input, [band], renderDuration);
    const node = nodes[0];
    const outputGain = gains.at(-1)!;

    expect(node.frequency.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(node.gain.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(node.frequency.setValueAtTime).toHaveBeenCalledWith(band.frequency, renderDuration);
    expect(node.gain.setValueAtTime).toHaveBeenCalledWith(expect.any(Number), renderDuration);
    expect(node.gain.setValueAtTime.mock.calls.some(([, atTime]) => atTime === 0)).toBe(true);
    expect(outputGain.gain.setValueAtTime).toHaveBeenCalledTimes(1);
  });

  it("applies band automation even when static gain is neutral", () => {
    const { context, nodes } = createFakeOfflineContext();
    const input = { connect: vi.fn() } as unknown as AudioNode;
    const renderDuration = 2;
    const band = createBaseBand({ gain: 0 });

    applyParametricEqOffline(context, input, [band], renderDuration, [
      {
        gain: {
          active: true,
          durationSec: 1,
          samples: new Float32Array([0, 6, 0, -3]),
        },
      },
    ]);
    const node = nodes[0];
    expect(node).toBeDefined();
    expect(node.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
  });

  it("fits overlapping bands toward drawn node targets", () => {
    const sampleRate = 44100;
    const bands: ParametricEqBand[] = [
      createBaseBand({ id: "a", frequency: 1000, gain: 6, q: 1.5 }),
      createBaseBand({ id: "b", frequency: 1100, gain: 1.5, q: 1.5 }),
      createBaseBand({ id: "c", frequency: 1200, gain: 0.5, q: 1.5 }),
    ];

    const naiveAtA = evaluateParametricEqResponseDb(bands, bands[0].frequency, sampleRate);
    const naiveAtB = evaluateParametricEqResponseDb(bands, bands[1].frequency, sampleRate);
    const fitted = fitParametricEqBandsToCurve(bands, sampleRate);
    const fittedAtA = evaluateParametricEqResponseDb(
      fitted,
      bands[0].frequency,
      sampleRate
    );
    const fittedAtB = evaluateParametricEqResponseDb(
      fitted,
      bands[1].frequency,
      sampleRate
    );

    expect(Math.abs(fittedAtA - bands[0].gain)).toBeLessThan(
      Math.abs(naiveAtA - bands[0].gain)
    );
    expect(Math.abs(fittedAtB - bands[1].gain)).toBeLessThan(
      Math.abs(naiveAtB - bands[1].gain)
    );
  });
});
