# Loop Loop Loop

Experimental, browser-based DJ system focused on live manipulation rather than library management.

## Development
- Install dependencies: `npm install`
- Start dev server: `npm run dev`

## Current MVP Features
- Multi-deck layout (1+ decks with add/remove).
- Per-deck file load + decode + play/stop.
- Per-deck gain control.

## Planned: Per-Deck BPM
- Offline BPM detection on load (store BPM + confidence).
- Manual BPM override (input + tap tempo).
- Optional tempo map for tracks with variable tempo (post-MVP).
- Outline:
  - Analyze decoded buffer (mono + resample) to estimate BPM + confidence.
  - Store detected BPM in deck state, allow override and reset.
  - Add tap tempo to compute BPM from recent taps.
  - (Later) use BPM for beat-grid snapping in loop/seek.
- BPM changes should change playback speed.

## Testing
- Run tests after changes to hooks, audio engine, or core UI logic: `npm test`
- Add or update tests for new features when appropriate.
- Unit/integration tests are planned with Vitest.

## Linting
- Run linting after JS/TS changes and fix issues: `npm run lint`
