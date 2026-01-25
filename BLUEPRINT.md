# Blueprint: Experimental Web DJ

Purpose: A browser-based, experimental DJ system focused on live manipulation, not library management.

## Goals
- Real-time performance with low latency and stable timing.
- Experimental manipulation: granular, spectral, stochastic, and morphing effects.
- Modular architecture for rapid prototyping of new decks/effects.

## Non-Goals
- Large-scale music library management.
- Cloud streaming integration.

## Core Architecture
### Audio Engine (Browser)
- Web Audio API graph with an AudioWorklet-based DSP core.
- Dedicated clock/scheduler for tight timing using AudioContext.currentTime.
- Routing matrix for decks, buses, and master chain.

### DSP Modules
- Beat/onset detection (WASM or lightweight JS analysis).
- FX chain: filters, delay, reverb, granular, spectral freeze, bitcrush.
- Modulation system: LFOs, envelopes, random/stochastic sources.

## BPM Detection & Control (Planned)
- Per-deck BPM analysis pipeline (offline on load + optional real-time refine).
- Store detected BPM with confidence + offset alignment for playhead/loop snapping.
- UI control to override BPM (manual entry + tap tempo + nudge).
- BPM changes should alter playback speed.
- Optional warp/tempo map for non-constant tempo tracks (post-MVP).
- Implementation outline:
  - Decode buffer -> downmix to mono -> resample to analysis rate (e.g., 11-22k).
  - Run tempo analysis (autocorrelation + onset envelope or third-party WASM) in a worker.
  - Persist `bpm`, `bpmConfidence`, and `bpmOverride` per deck; expose effective BPM.
  - Add tap tempo + manual entry UI; allow reset to detected BPM.
  - If BPM is known, enable beat-grid snapping for loop/seek (post-MVP).

### Deck Model
- Deck as a graph: source -> per-deck FX -> deck bus.
- Sources: file drop, mic input, oscillator/sampler, granular buffer.
- Looping, slicing, cueing, and morphing controls.

### UI & Interaction
- Primary UI in React (Vite-based SPA) to maximize ecosystem and AI-assisted development.
- Canvas/WebGL for waveform, spectrum, and experimental visual feedback.
- Controller support: Web MIDI, Gamepad, and keyboard/pointer.
- Layout sketch (2-up decks on wide screens, stacked on small screens):
```
[Header]
[Clip Recorder]
[Deck 1] [Deck 2]
[Deck 3] [Deck 4]
[Transport]
```

### State & Presets
- Session state stored in memory with optional persistence to IndexedDB.
- Presets for FX chains, deck states, and mappings.

## Data Flow (High-Level)
- User/controller events -> UI -> engine API -> AudioWorklet graph.
- Audio analysis -> UI visuals and optional automation inputs.

## Build & Tooling
- TypeScript + Vite.
- WASM toolchain for DSP modules.
- Tests for DSP and scheduling behavior (Vitest for unit/integration).

## Code Structure (Current)
- UI components in `src/components/` (DeckStack, DeckCard, ClipRecorder, TransportBar).
- Audio + deck state in hooks under `src/hooks/` (`useDecks`, `useAudioEngine`).
- Shared types in `src/types/` (deck state/status).

## Code Structure (Audio Engine Module)
- `src/audio/engine.ts`: AudioContext lifecycle, master bus, and global FX routing.
- `src/audio/deck.ts`: Deck source lifecycle (buffer sources, gain, per-deck FX chain).
- `src/audio/analysis.ts`: Metering/FFT/onset analysis and UI data feeds.
- `src/audio/bpm.ts`: Offline BPM estimation helper for deck metadata.
- `src/workers/bpmWorker.ts`: Worker for BPM estimation off the main thread.

## Open Questions
- UI visual direction and interaction style.
- Which DSP features are MVP vs. experimental backlog?
- Minimum viable controller mapping and default devices.

## Next Steps (Web Frontend and Technical Implementation)
- [x] Initialize the React + TypeScript app with Vite to generate `package.json` and base tooling.
- [x] Install dependencies (`react`, `react-dom`) and dev tooling (`vite`, `@vitejs/plugin-react`, `typescript`).
- [x] Add minimal `index.html`, `src/main.tsx`, and `src/App.tsx` to render a simple MVP shell.
- [x] Create a basic layout scaffold (deck panel placeholder, transport bar, FX rack placeholder).
- [x] Add `npm` scripts for `dev`, `build`, and `preview` to verify local browser rendering.
- [ ] Wire up per-deck file loading and decode to AudioBuffer.
  - [ ] Add per-deck file input and store selected file in state.
  - [ ] Decode via `AudioContext.decodeAudioData` and store `AudioBuffer`.
  - [ ] Implement play/stop for one deck with a `GainNode` and `AudioBufferSourceNode`.
  - [ ] Generalize play/stop to multiple decks with independent sources.
  - [ ] Add a simple status indicator (loaded/playing/error).
- [ ] Build a minimal Web Audio engine (AudioContext, per-deck gain, master bus).
- [ ] Implement transport controls (play/stop, loop toggle) with stable scheduling.
- [ ] Add initial per-deck FX nodes (filter + delay) in the audio graph.
- [x] Render a simple waveform preview with Canvas for loaded buffers.
- [ ] Add error handling UX (decode failures, AudioContext resume prompts).
- [ ] Implement basic keyboard navigation for transport and deck controls.

## Next Steps (High-Level Application Design)
- [ ] Define MVP scope (single deck vs. dual, core FX set, baseline controls) to bound architecture.
  - Starts at 1 deck. Decks are modular.
  - Ability to add a new deck, with no limit on number of decks.
  - Each deck has it's own set of associated effects.
- [ ] Choose DSP stack for MVP (e.g., basic FX + analysis) and confirm any WASM toolchain needs.
- [ ] Draft engine API surface (deck controls, transport, routing, automation) to drive UI wiring.
- [ ] Sketch UI layout and interaction model aligned with the engine API and controller mappings.
- [ ] Establish timing/scheduling strategy and write a minimal audio graph prototype.
- [ ] Define session state model (deck state, FX params, routing, mappings) and persistence plan.
- [ ] Specify controller mapping strategy (Web MIDI defaults, learn mode, conflict handling).
- [ ] Decide on analysis features (onset/beat detection, metering) and their impact on UI.
- [ ] Set a visual language direction (type, color, density) consistent with performance use.
- [ ] Outline testing strategy (audio node unit tests, scheduling tests, manual UX checks).
- [ ] Define session file format (JSON schema) and import/export flows.
- [ ] Set performance budgets (latency target, CPU per deck, max decks).
- [ ] Define local file handling policy and permission messaging.

## Next Steps (Audio Engine and DSP)
- [ ] Define core audio graph (deck source -> per-deck FX -> deck bus -> master FX -> output).
- [ ] Add analysis pipeline plan (meters, FFT, onset) and data flow to UI.
- [ ] Establish automation/modulation model (LFOs, envelopes, random) and parameter routing.
- [ ] Plan AudioWorklet structure (worklet modules, messaging, shared buffers).
- [ ] Implement per-deck BPM detection (offline) and expose BPM in deck state.
- [ ] Add BPM override controls (manual input + tap tempo) with confidence display.
  - [ ] Add analysis helper (standalone module or worker) to compute BPM from AudioBuffer.
  - [ ] Add deck state fields and UI to display detected/override/effective BPM.
  - [ ] Store tap history per deck and compute BPM from recent taps.
  - [ ] Integrate BPM into loop/seek snapping (optional, later).

## Next Steps (Project Ops and Release)
- [x] Decide package manager (npm/pnpm/yarn) and standardize lockfile.
- [x] Add linting/formatting (ESLint + Prettier) and editor config.
- [x] Set up Vitest for unit/integration tests and add a baseline test.
- [ ] Define environment requirements (Node version, browsers supported).
- [x] Add a minimal README with run steps and contribution notes.
- [ ] Set up basic CI (lint + build) when repo is ready.
- [ ] Add asset pipeline plan (icons, SVGs, waveform caching).
- [ ] Add integration test plan for load->play->loop and multi-deck concurrency.

## Next Steps (Controller and Hardware Integration)
- [ ] Inventory target controllers (Launchpad, MIDI Fighter, generic MIDI) and select defaults.
- [ ] Define mapping schema (per-deck vs. global controls, shift layers, learn mode).
- [ ] Implement basic Web MIDI device discovery and event routing.
- [ ] Add a lightweight mapping UI for test devices (bind, clear, save).
- [ ] Plan fallback controls for keyboard/gamepad.
