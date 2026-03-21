import type { DeckFxPanel } from "../types/deck";

export type AutomationTrackView = {
  samples: Float32Array;
  previewSamples: Float32Array;
  durationSec: number;
  recording: boolean;
  active: boolean;
  currentValue: number;
  amplitudeScale: number;
};

export const FX_PANEL_KEYS: DeckFxPanel[] = [
  "gain",
  "djFilter",
  "resonance",
  "parametricEq",
  "balance",
  "pitch",
  "vocoder",
  "delay",
  "spectralSpace",
  "rearranger",
  "stretch",
];

export const TEMPO_SEMITONE_RATIO = Math.pow(2, 1 / 12);

export const createAutomationFallback = (currentValue: number): AutomationTrackView => ({
  samples: new Float32Array(0),
  previewSamples: new Float32Array(0),
  durationSec: 0,
  recording: false,
  active: false,
  currentValue,
  amplitudeScale: 1,
});

export const hasAutomationData = (track: {
  samples: Float32Array;
  previewSamples: Float32Array;
  recording: boolean;
}) => track.samples.length > 0 || track.previewSamples.length > 0 || track.recording;

export const isDifferent = (value: number, target: number, epsilon = 1e-3) =>
  Math.abs(value - target) > epsilon;

export const formatTempo = (value: number) => {
  if (Math.abs(value) < 0.005) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

export const formatDjFilter = (value: number, fine = false) => {
  const precision = fine ? 3 : 1;
  if (value > 0.05) return `HP ${value.toFixed(precision)}`;
  if (value < -0.05) return `LP ${Math.abs(value).toFixed(precision)}`;
  return "Flat";
};

export const formatEq = (value: number, fine = false) => {
  if (value === 0) return "0.0 dB";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fine ? 2 : 1)} dB`;
};

type QuietDeletePreviewArgs = {
  buffer: AudioBuffer | undefined;
  duration: number | undefined;
  loopEnabled: boolean;
  loopStartSeconds: number;
  loopEndSeconds: number;
  rearrangerQuietThreshold: number;
  showQuietDeletePreview: boolean;
};

export const buildQuietDeletePreviewRanges = ({
  buffer,
  duration,
  loopEnabled,
  loopStartSeconds,
  loopEndSeconds,
  rearrangerQuietThreshold,
  showQuietDeletePreview,
}: QuietDeletePreviewArgs): Array<{ start: number; end: number }> => {
  if (!showQuietDeletePreview || !buffer || !loopEnabled) return [];
  const effectiveDuration = duration ?? buffer.duration;
  const loopStart = Math.max(0, loopStartSeconds ?? 0);
  const loopEnd =
    loopEndSeconds && loopEndSeconds > loopStart + 0.01
      ? Math.min(loopEndSeconds, effectiveDuration)
      : effectiveDuration;
  const loopDuration = loopEnd - loopStart;
  if (loopDuration <= 0.01) return [];
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.min(buffer.length - 1, Math.round(loopStart * sampleRate)));
  const endSample = Math.max(startSample + 1, Math.min(buffer.length, Math.round(loopEnd * sampleRate)));
  const segmentLength = endSample - startSample;
  if (segmentLength < 128) return [];
  const frameSize = Math.max(32, Math.round(sampleRate * 0.012));
  const hopSize = Math.max(16, Math.floor(frameSize / 2));
  if (segmentLength <= frameSize + hopSize) return [];
  const frameCount = Math.floor((segmentLength - frameSize) / hopSize) + 1;
  const envelope = new Array<number>(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = startSample + frameIndex * hopSize;
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let offset = 0; offset < frameSize; offset += 1) {
        const sample = data[frameStart + offset] ?? 0;
        sum += sample * sample;
      }
    }
    const count = frameSize * buffer.numberOfChannels;
    envelope[frameIndex] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  const sorted = [...envelope].sort((a, b) => a - b);
  const p20 = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
  const p80 = sorted[Math.floor((sorted.length - 1) * 0.8)] ?? 0;
  const dynamic = Math.max(0, p80 - p20);
  const quietFactor = 0.03 + rearrangerQuietThreshold * 0.17;
  const quietThreshold = p20 + dynamic * quietFactor;
  const minQuietSamples = Math.max(1, Math.round(sampleRate * 0.09));
  const keepGuardSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const ranges: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const isQuiet = envelope[frameIndex] <= quietThreshold;
    if (isQuiet) {
      if (runStart < 0) runStart = frameIndex;
      continue;
    }
    if (runStart >= 0) {
      const absStart = startSample + runStart * hopSize + keepGuardSamples;
      const absEnd = startSample + frameIndex * hopSize + frameSize - keepGuardSamples;
      if (absEnd - absStart >= minQuietSamples) {
        ranges.push({
          start: Math.max(0, Math.min(1, (absStart - startSample) / segmentLength)),
          end: Math.max(0, Math.min(1, (absEnd - startSample) / segmentLength)),
        });
      }
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    const absStart = startSample + runStart * hopSize + keepGuardSamples;
    const absEnd = endSample - keepGuardSamples;
    if (absEnd - absStart >= minQuietSamples) {
      ranges.push({
        start: Math.max(0, Math.min(1, (absStart - startSample) / segmentLength)),
        end: Math.max(0, Math.min(1, (absEnd - startSample) / segmentLength)),
      });
    }
  }
  return ranges.filter((range) => range.end > range.start);
};

export const FX_HINTS: Record<DeckFxPanel, string> = {
  gain: "Gain: controls deck output level before the FX chain.",
  djFilter: "DJ Filter: sweeps between low-pass and high-pass for transitions and tone shaping.",
  resonance: "Resonance: boosts filter edge intensity for sharper sweeps.",
  parametricEq: "EQ: shape the spectrum with draggable parametric bands, Q, and per-band automation.",
  balance: "Balance: pan the deck left/right in stereo.",
  pitch: "Pitch: semitone shift for key matching or creative detune.",
  vocoder: "Vocoder: this deck is the carrier; select another deck as the modulator envelope source.",
  delay: "Delay: time, feedback, tone, saturation, damping, safety, mix, and ping-pong echo.",
  loopDelay: "Loop Delay: waits after a loop ends before restarting playback from the loop start.",
  spectralSpace:
    "Spectral Space: post-delay stereo width/tone sculpting with spread, motion, tilt, low-mono, and transient protection.",
  rearranger:
    "Rearranger: Auto Slice detects transient boundaries. Delete Quiet removes low-energy spans in the loop. You can also click waveform between boundaries to add slices; hold Shift and click a slice to destructively remove that slice audio.",
  stretch: "Stretch: offline Paulstretch render with phase/width/tilt/scatter controls.",
};
