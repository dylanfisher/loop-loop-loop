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
- Time-stretch/pitch (WASM-based, e.g., rubberband/soundtouch).
- Beat/onset detection (WASM or lightweight JS analysis).
- FX chain: filters, delay, reverb, granular, spectral freeze, bitcrush.
- Modulation system: LFOs, envelopes, random/stochastic sources.

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
[Global FX]
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
- Tests for DSP and scheduling behavior.

## Open Questions
- UI visual direction and interaction style.
- Which DSP features are MVP vs. experimental backlog?
- Minimum viable controller mapping and default devices.

## Next Steps (Web Frontend and Technical Implementation)
- [ ] Initialize the React + TypeScript app with Vite to generate `package.json` and base tooling.
- [ ] Install dependencies (`react`, `react-dom`) and dev tooling (`vite`, `@vitejs/plugin-react`, `typescript`).
- [ ] Add minimal `index.html`, `src/main.tsx`, and `src/App.tsx` to render a simple MVP shell.
- [ ] Create a basic layout scaffold (deck panel placeholder, transport bar, FX rack placeholder).
- [ ] Add `npm` scripts for `dev`, `build`, and `preview` to verify local browser rendering.

## Next Steps (High-Level Application Design)
- [ ] Define MVP scope (single deck vs. dual, core FX set, baseline controls) to bound architecture.
  - Starts at 1 deck. Decks are modular.
  - Ability to add a new deck, with no limit on number of decks.
  - Each deck has it's own set of associated effects.
- [ ] Choose DSP stack for MVP (e.g., stretch/pitch + basic FX) and confirm WASM toolchain.
- [ ] Draft engine API surface (deck controls, transport, routing, automation) to drive UI wiring.
- [ ] Sketch UI layout and interaction model aligned with the engine API and controller mappings.
- [ ] Establish timing/scheduling strategy and write a minimal audio graph prototype.
