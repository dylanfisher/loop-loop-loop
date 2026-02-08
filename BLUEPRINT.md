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
- Web Audio API graph with an AudioWorklet-based DSP core (phase vocoder pitch shift).
- Dedicated clock/scheduler for tight timing using AudioContext.currentTime.
- Routing matrix for decks, buses, and master chain.

### DSP Modules
- Beat/onset detection (WASM or lightweight JS analysis).
- FX chain: filters, delay (time/feedback/mix/tone + ping-pong plus feedback-loop character controls for saturation/damping/safety), deck-to-deck channel vocoder (modulator deck + carrier deck routing), Loop Rearranger (offline loop slicing/reordering with slices/offset/chaos/reverse controls, draggable colored slice-boundary handles in the waveform, click-between-handles to add a slice at pointer position, Shift+click in the slice zone to destructively remove the clicked slice audio from the deck buffer and shorten duration, and slice-handle click to remove only a divider while preserving audio, plus optional auto-rearrange each loop cycle), reverb, granular, spectral freeze, bitcrush, pitch shift (phase vocoder), per-deck Paulstretch render (offline stretch to new clip with phase/tilt/spacing/scatter controls).
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
- Deck as a graph: source -> per-deck FX -> deck bus (includes a per-deck limiter and soft clipper after EQ).
- Sources: file drop, mic input, oscillator/sampler, granular buffer.
- Looping, slicing, cueing, and morphing controls.

### UI & Interaction
- Primary UI in React (Vite-based SPA) to maximize ecosystem and AI-assisted development.
- Canvas/WebGL for waveform, spectrum, and experimental visual feedback.
- Controller support: Web MIDI, Gamepad, and keyboard/pointer.
- Deck cards support drag-and-drop audio file loading in addition to the file picker.
- Clip Recorder supports drag-and-drop audio import, with drop-target highlighting while files are dragged over it.
- Clip Recorder supports source-select recording: app master output or user input device (microphone/interface).
- Session zip import supports drag-and-drop onto the app root (with global drop-target hint) in addition to the Import button/file picker.
- Deck FX layout supports a wider stretch unit (spans two grid columns) to host extra Paulstretch controls.
- Parametric EQ is implemented as a dedicated 5-unit-wide FX panel with a draggable node graph (click-to-add, drag freq/gain, node type/Q controls), while keeping EQ3 available via per-deck EQ mode selection.
- Deck FX now includes a dedicated Gain unit (first slot) with its own collapsible panel and automation lane; waveform sidebar gain control was removed.
- Deck FX controls support per-effect collapsible panels plus a per-deck "open/close all" control.
- Deck FX includes a Vocoder panel with per-deck mix, modulator-deck selection, modulator monitor level (controls linked modulator deck audibility in the mix), mod-drive sensitivity boost for stronger envelope transfer, and a single `Phase Rotate` control that continuously cycles vocoder band phase offsets.
- Vocoder is bypassed in live/render paths when mix is zero or no modulator source is selected; selecting a modulator source auto-primes mix to 50%, and clearing source sets mix to 0%.
- Deck FX header includes a per-deck "Reset FX" action that restores effect parameters (and related automation tracks) to defaults.
- Header includes a deck-layout toggle (single-column vs two-column) for fast workspace density changes.
- Deck cards include a per-deck width override control (force full-width or half-width) next to the deck label.
- Header `Restore + Export` controls open as a full-width inner panel in a dedicated second header row (collapsible toggle in primary row).
- Rearranger includes an `Auto Slice` checkbox plus sensitivity control; when enabled, changing the `Slices` knob re-runs transient boundary detection (adaptive threshold + minimum spacing) and writes boundaries as manual slice regions.
- Rearranger also includes a `Delete Quiet` action that auto-detects low-energy spans inside the current loop and destructively removes them from deck audio.
- `Delete Quiet` exposes a per-deck quiet-threshold control to tune how aggressively low-energy spans are classified for removal.
- Rearranger includes a per-deck slice-fade control to soften slice edges and reduce clicks.
- Rearranger slice-fade defaults to `0ms` on new decks/sessions.
- Rearranger includes a per-deck slice-delay control (`0.00s` to `5.00s`): during live playback it is non-destructive and simulated on the audio thread as short per-slice hold windows (so downstream FX, such as delay tails, continue processing), while explicit offline renders (for example Export Mix/Save Loop baked paths) bake silence between slices and extend rendered duration.
- Rearranger includes a per-deck slice ping-pong control (0..1) that alternates slices toward L/R stereo placement in real time (not baked into rendered loop audio). Live ping-pong now runs through a dedicated AudioWorklet processor that derives slice side from loop timing on the audio thread to reduce main-thread scheduling jitter.
- Rearranger numeric hot paths now support an optional WASM backend (`/wasm/rearranger.wasm`) for segment rearrange and onset-region detection kernels (including optional interleaved multi-channel onset detection export), with automatic runtime fallback to the existing JS implementation when unavailable.
- Paulstretch render now uses a hybrid WASM setup: shared FFT from `/wasm/dsp-core.wasm` plus Paulstretch-specific overlap-add/spectral-bin kernels from `/wasm/paulstretch.wasm`, each with automatic JS fallback.
- Pitch shift phase-vocoder now uses shared FFT from `/wasm/dsp-core.wasm` for forward/inverse STFT steps, with automatic fallback to JS FFT when unavailable.
- Shared DSP core also exposes reusable window-to-complex and overlap-add kernels used by both Paulstretch and pitch-vocoder hot paths.
- Delay includes a phase-1 live-only `Slice Sync` mode that retimes delay-time per active rearranger slice boundary during loop playback.
- Keyboard shortcut layer targets the currently active deck (last interacted deck), includes transport/loop/rearranger/zoom/crop/duplicate/remove/session actions, and exposes a toggleable `?` shortcuts overlay from keyboard and header button.
- Stretch actions show a rough render-time estimate based on loop duration, stretch amount, and window size.
- Stretch estimate uses live per-device calibration (EMA factor stored locally) from measured render durations.
- Brand-new projects show a dismissible Welcome panel above the clip recorder with selectable first-run guidance, quickstart steps, and concise interaction hints for non-musicians.
- Welcome panel includes an `Open a Demo Loop` action that imports `public/example.zip` for immediate first-run exploration.
- Layout sketch (2-up decks on wide screens, stacked on small screens):
```
[Header row 1: brand + project + transport/session toggles + layout/theme/master]
[Header row 2 (collapsible): full-width Restore + Export panel]
[Welcome panel (new project only, dismissible)]
[Clip Recorder]
[Deck 1] [Deck 2]
[Deck 3] [Deck 4]
[Transport]
```

### Effect Pipeline Parity (Constraint)
- Per-deck effects must stay behaviorally aligned across all output paths:
  - Live playback graph (real-time deck engine)
  - Save Loop baked render path (offline clip render when not saving metadata-only settings)
  - Export Mix offline render path
  - Global recording path (master stream capture)
- New effects should be added to all four paths in the same change set (or explicitly documented as intentionally excluded).

### File Modularity (Constraint)
- Keep orchestration files focused on composition and wiring, not deep feature implementations.
- Prefer splitting by cohesive domain boundaries (for example: recording, session I/O, loop editing, keyboard control) before files become monolithic.
- Avoid mixed-concern mega-files; when a file grows substantially, extract self-contained hooks/utils/components while preserving behavior.
- Prioritize DRY boundaries and stable APIs between modules so both humans and LLM tools can operate on smaller context windows.

### State & Presets
- Session state stored in memory with optional persistence to IndexedDB.
- Presets for FX chains, deck states, and mappings.
- Session persistence: save/load session JSON to IndexedDB plus audio blobs for deck/clip audio.
- Clip session persistence now preserves original clip blob format (for example `audio/webm` from Clip Recorder) instead of re-encoding unchanged clips to WAV on each autosave.
- Deck UI state (including per-effect FX panel open/closed state) is persisted in sessions and exported/imported project zips.
- Deck UI state is also mirrored immediately to localStorage (lightweight patch) so quick refreshes restore panel state before the next full autosave.
- Session WAV encoding (for deck audio and transformed renders) uses a dedicated web worker to reduce main-thread stalls.
- Welcome panel dismissed state is persisted through autosave, saved sessions, and exported/imported project zips.
- After the welcome panel is dismissed, it remains hidden across New Session/reset flows and is reopened explicitly from the header `?` shortcut/help control.
- Auto-rearrange (On Loop) updates are treated as transient: they do not create undo history snapshots and skip immediate autosave scheduling to avoid runaway memory/encode pressure during continuous looping.
- Auto-rearrange playback reload path reuses existing deck audio nodes (source-only restart) to avoid repeated node graph teardown/rebuild churn on every loop.
- Export Mix simulates Rearranger `On Loop` by applying iterative per-cycle reshuffles in the offline render path.
- Rearranger custom boundaries are re-derived on a sample-quantized grid to prevent cumulative floating-point drift during repeated rearrange passes.
- Clip metadata can include per-clip deck settings + automation snapshots to rehydrate FX on load.
- Save Loop clips always persist FX settings metadata; Clip Rack exposes a per-clip FX badge toggle that controls whether those saved settings are applied when loading the clip into a deck.
- Save Loop clip audio is always exported from the raw loop slice (unbaked audio); FX settings are stored as metadata and can be selectively applied on clip load via the Clip Rack FX toggle.
- Automation lanes support compact preset waveforms and length scaling controls.
- Sessions are named and stored as multiple entries in IndexedDB for later recall.
- Session export/import: zip bundle with `session.json` manifest and audio assets (WAV for decks; clips preserve original format when unchanged).

## Data Flow (High-Level)
- User/controller events -> UI -> engine API -> AudioWorklet graph.
- Audio analysis -> UI visuals and optional automation inputs.

## Build & Tooling
- TypeScript + Vite.
- WASM toolchain for DSP modules.
- Rearranger WASM kernels can be precompiled manually from `wasm-src/rearranger.c` into `public/wasm/rearranger.wasm` to avoid adding Rust/C build steps to normal app scripts.
- Shared DSP core WASM kernels can be precompiled manually from `wasm-src/dsp_core.c` into `public/wasm/dsp-core.wasm`.
- Paulstretch WASM kernels can be precompiled manually from `wasm-src/paulstretch.c` into `public/wasm/paulstretch.wasm`.
- JS DSP implementations remain the required fallback path when WASM fails to load or execute.
- Tests for DSP and scheduling behavior (Vitest for unit/integration).

## Code Structure (Current)
- UI components in `src/components/` (DeckStack, DeckCard, ClipRecorder, TransportBar).
- Audio + deck state in hooks under `src/hooks/` (`useDecks`, `useAudioEngine`).
- Shared types in `src/types/` (deck state/status).
- Optional WASM wrappers in `src/utils/` for precompiled DSP kernels.
- App-level pure helpers are extracted to `src/utils/appHelpers.ts` to keep `App.tsx` focused on orchestration.
- `useDecks` shared constants/defaults/automation helper types are extracted to `src/hooks/useDecksShared.ts` to keep deck lifecycle/state transitions centralized in the hook body.
- Session/autosave/import-export and zip drag/drop orchestration are extracted from `App.tsx` into `src/hooks/useSessionManager.ts`.
- Global keyboard shortcut registration is extracted from `App.tsx` into `src/hooks/useGlobalKeyboardShortcuts.ts`.
- Clip lifecycle/render/load/save/crop/duplicate logic is extracted from `App.tsx` into `src/hooks/useClipLibrary.ts`.
- Active-deck transport/loop/rearranger/zoom keyboard-targeted actions are extracted from `App.tsx` into `src/hooks/useFocusedDeckActions.ts`.
- Master recording toggle/download flow is extracted from `App.tsx` into `src/hooks/useRecordingManager.ts`.
- Deck loop editing actions (Stretch, Rearrange, Delete Slice, Auto Slice, Delete Quiet) are extracted from `App.tsx` into `src/hooks/useDeckLoopTools.ts`.
- Rearranger live runtime scheduling (slice-delay holds, delay-sync, ping-pong scheduling, auto-loop precompute/retrigger) is extracted from `App.tsx` into `src/hooks/useRearrangerRuntime.ts`.
- Offline mixdown rendering pipeline is extracted from `App.tsx` into `src/utils/exportMixdown.ts`, keeping `App.tsx` focused on export UI state and download orchestration.
- Header/session transport/export rendering is extracted from `App.tsx` into `src/components/AppHeader.tsx`.
- Keyboard shortcut dialog rendering is extracted from `App.tsx` into `src/components/KeyboardShortcutsDialog.tsx`.
- Audio unlock gate rendering is extracted from `App.tsx` into `src/components/AudioUnlockOverlay.tsx`.
- `DeckStack` prop assembly/callback wiring is extracted from `App.tsx` into `src/hooks/useDeckStackProps.ts`.

## Code Structure (Audio Engine Module)
- `src/audio/engine.ts`: AudioContext lifecycle, master bus, and global FX routing.
- `src/audio/deck.ts`: Deck source lifecycle (buffer sources, gain, per-deck FX chain).
- `src/audio/effects/`: Modular effect plugins + shared offline post-EQ pipeline (`postEqPipeline.ts`) used by Save Loop and Export Mix.
- `src/audio/analysis.ts`: Metering/FFT/onset analysis and UI data feeds.
- `src/audio/bpm.ts`: Offline BPM estimation helper for deck metadata.
- `src/workers/bpmWorker.ts`: Worker for BPM estimation off the main thread.

## Open Questions
- UI visual direction and interaction style.
- Which DSP features are MVP vs. experimental backlog?
- Minimum viable controller mapping and default devices.

## Feature Specs
- Parametric EQ implementation plan: `PARAMETRIC_EQ_SPEC.md`

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
