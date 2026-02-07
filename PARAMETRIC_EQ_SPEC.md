# Parametric EQ Spec

## Decision Summary
- Keep both EQ systems:
  - `EQ3` remains for fast DJ-style broad tonal moves.
  - `Parametric EQ` is added for detailed sculpting.
- Do not run both simultaneously in the active deck EQ path by default.
  - Add an EQ mode selector per deck: `EQ3` or `Parametric`.
  - This avoids accidental stacked gain coloration and simplifies gain staging.

## UX Goals
- Let users sculpt tone visually and quickly.
- Support discoverable gestures with low friction:
  - Click graph to add a band.
  - Drag node horizontally for frequency.
  - Drag node vertically for gain.
  - Modifier gesture (Alt+drag vertical or mouse wheel over node) adjusts Q.
  - Double-click node removes band.
- Keep EQ3 available for performance muscle memory.

## Layout Requirements
- Add a new `Parametric EQ` FX unit that is **5 units wide** in the deck FX grid.
- The unit contains:
  - Frequency response graph with draggable nodes.
  - Mode selector (`EQ3` / `Parametric`).
  - Minimal supporting controls (band type, Q/freq/gain readout for selected node, reset).

## DSP Model
- Band model:
  - `id`, `type` (`peak`, `lowShelf`, `highShelf`, optional `highPass`, `lowPass`), `freqHz`, `gainDb`, `q`, `enabled`.
- Suggested defaults:
  - Start with 3 bands (low shelf, peak, high shelf) to mirror familiarity.
  - Allow adding/removing bands up to a safe max (e.g. 8-12).
- Processing:
  - Cascade biquad-style filters in fixed band order.
  - Recompute coefficients only when parameters change (or at automation sample rate).
  - Add output trim/safety strategy to prevent clipping when multiple boosts are active.

## Data Model Changes
- Extend deck/session types with:
  - `eqMode: "eq3" | "parametric"`
  - `parametricEqBands: ParametricEqBand[]`
  - Optional `parametricEqOutputTrimDb`
- Preserve existing EQ3 fields for backward compatibility.
- Session migration:
  - Existing sessions default to `eqMode: "eq3"`.
  - Parametric fields are optional and initialized when absent.

## Automation
- Initial scope:
  - No per-band point automation in phase 1.
  - Keep current automation lanes unchanged.
- Future extension:
  - Add lane-level automation targets for selected band gain/freq/Q.

## Pipeline Parity (Required)
- Parametric EQ behavior must match across:
  - Live deck playback graph.
  - Save Loop baked render path.
  - Export Mix offline render path.
  - Global master recording output.
- Implement through shared EQ processing/plugin utilities, not one-off graph logic.

## WASM Scope
- Yes, use WASM where it provides clear value.
- Phase 1 (JS first):
  - Implement correct behavior in TS/AudioWorklet with profiling hooks.
- Phase 2 (targeted WASM):
  - Move hot loop pieces to `dsp-core.wasm` if profiling shows CPU pressure:
    - multi-band sample block processing loop,
    - coefficient/batch update helpers.
- Keep UI interaction math in JS (not a WASM target).

## UI Interaction Details
- Graph coordinate mapping:
  - X-axis: log frequency (20Hz..20kHz).
  - Y-axis: gain (e.g. -18dB..+18dB).
- Node hit rules:
  - nearest node within radius threshold becomes selected.
  - click empty graph adds a `peak` band at cursor freq/gain.
- Accessibility:
  - keyboard nudging for selected node freq/gain/Q.
  - visible focus ring and text value readout.

## Performance Targets
- No glitches at current supported deck counts with one active parametric EQ per deck.
- Parameter drag should feel continuous (no zipper noise).
- CPU overhead should remain within current effect budget envelope.

## Rollout Plan
1. Add data model + session migration + mode selector (no DSP behavior change yet).
2. Implement parametric graph UI and node editing state.
3. Add live parametric processing in audio path under `eqMode === "parametric"`.
4. Add offline parity in Save Loop/Export/global recording.
5. Add tests and profiling instrumentation.
6. Optional WASM optimization pass based on measured hotspots.

## Test Plan
- Unit tests:
  - band add/remove/update constraints,
  - freq/gain/Q clamping,
  - mode switching state behavior.
- DSP tests:
  - coefficient stability for extreme values,
  - expected gain curve sanity checks,
  - no NaN/Inf outputs.
- Integration tests:
  - session save/load roundtrip with parametric bands,
  - parity checks between live and offline renders for same settings.

## Non-Goals (Phase 1)
- Full dynamic EQ/compressor behavior.
- Unlimited bands or per-sample automation of all band params.
- Replacing EQ3.
