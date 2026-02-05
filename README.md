# Loop Loop Loop

Loop Loop Loop is a browser-native live looping and mutation instrument.

It is designed for rapid experimentation: load audio, define a loop, transform it with FX, capture clips, and stack multiple decks. You do not need DJ workflow knowledge or music theory to use it.

*This project is fully vibe coded.*

## Who This Is For

- First-time users with no musical training
- Sound designers who want fast loop mutation
- Performers who want multi-deck live experimentation in-browser

## What It Does (Current)

- Multi-deck playback with per-deck loop ranges, tempo offset, pitch, gain, and full FX chain
- Per-deck FX rack with collapsible units and reset/open-all controls
- Automation lanes for: gain, DJ filter, resonance, low/mid/high EQ, balance, pitch
- Rearranger with manual slicing, auto-slice detection, destructive slice deletion, and auto-rearrange-on-loop
- Delete Quiet tool to remove low-energy loop regions destructively
- Clip Recorder with app-output recording or input-device recording
- Clip Rack with waveform preview playback and per-clip FX metadata apply toggle
- Session save/load in IndexedDB, plus zip export/import
- Global drag/drop zip import (drop anywhere on app)
- Keyboard shortcut overlay (`?`) and active-deck shortcut targeting

## Quickstart (10 Minutes)

1. Run the app and click **Add Deck** if you want more decks.
2. Load audio into a deck (button or drag/drop audio onto deck).
3. Press `Space` to play/pause the active deck.
4. Drag `IN`/`OUT` loop markers to isolate a short loop.
5. Open **Deck FX** and try: Gain, DJ Filter, Delay, Rearranger.
6. Click **Save Loop** to create a clip.
7. In Clip Rack, click a deck number under **Load Deck** to load that clip.

## Core Concepts

### Deck
An independent player and FX chain.

### Active Deck
The last interacted deck. Keyboard actions apply here.

### Loop
A bounded range in the source audio. Rearranger operations apply inside loop context.

### Clip
A saved audio artifact plus optional settings metadata.

## Rearranger Behavior (Important)

Rearranger controls: **Slices**, **Offset**, **Chaos**, **Reverse**, **Sensitivity**, **Quiet Thresh**, **On Loop**.

Waveform interactions when Rearranger is open:
- Click between boundaries: add a slice boundary
- Click a boundary handle: remove divider only (audio length unchanged)
- `Shift` + click a slice region: destructive removal of that slice audio (buffer shortens)

Auto tools:
- **Auto Slice**: transient/silence-attack based boundary detection
- **Delete Quiet**: detects low-energy regions and removes them destructively

## Tempo + Pitch Workflow

- Tempo can be edited directly from the tempo label in deck meta.
- `+/-` tempo nudges use semitone ratio steps (~5.95% per step), so 12 steps map to one octave relationship.
- This keeps tempo moves aligned with musically coherent pitch intervals.

## Save Loop and FX Metadata

Save Loop always stores clip audio and can store deck FX/settings metadata.

Clip Rack FX badge behavior:
- **FX on**: loading clip reapplies saved settings/automation
- **FX off**: load clip without applying saved settings

This allows one clip audio source to be reused in multiple deck contexts.

## Recording and Export

### Clip Recorder
- **App** source: records master output
- **Input** source: records microphone/interface input
- Input recordings are named as `Clip N (input)`

### Export / Global Recording Filenames
Saved audio files use:
- `loop-loop-loop-export_<Project-Name>-M-D-YYYY-H-M-S-AMPM.wav`
- `loop-loop-loop-recording_<Project-Name>-M-D-YYYY-H-M-S-AMPM.wav`

## Keyboard Shortcuts

- `Space`: Play/Pause active deck
- `Shift + Space`: Global Play/Pause
- `R`: Toggle Rearranger panel (active deck)
- `L`: Toggle loop (active deck)
- `Shift + L`: Reset active deck loop to full file
- `=`: Zoom out waveform (active deck)
- `-`: Zoom in waveform (active deck)
- `A`: Add deck
- `Cmd/Ctrl + Z`: Undo
- `Cmd/Ctrl + Shift + Z`: Redo
- `Cmd/Ctrl + S`: Save session
- `Cmd/Ctrl + O`: Open session
- `?`: Toggle keyboard shortcuts panel

## Session Model

Sessions persist:
- Deck parameters (including loop bounds, tempo, FX, automation)
- Deck UI state (including FX panel open/closed)
- Clips and clip settings metadata
- Welcome panel dismissed state

Storage/export:
- IndexedDB for local persistence
- Zip bundle for import/export (`session.json` + WAV assets)

## Layout and UI Notes

- Default deck layout mode is **2 columns**.
- Header can toggle between **2 Col** and **1 Col**.
- Each deck can also force width (`Full`/`Half`) via per-deck override.
- `Restore + Export` opens in a full-width header subpanel.

## WASM Status

Current implementation includes a small WASM-assisted onset gate in Rearranger auto-slice detection, with JS fallback.

This is an incremental step; larger DSP speedups are expected from moving heavier export/analysis kernels to Rust/C-generated WASM modules.

## Development

### Requirements
- Node.js 18+
- npm

### Commands
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run lint`
- `npm test`

## Project Map

- `src/components/` UI (`DeckCard`, `Waveform`, `ClipRecorder`, `WelcomePanel`)
- `src/hooks/useDecks.ts` core deck/session/automation state
- `src/hooks/useAudioEngine.ts` Web Audio orchestration
- `src/audio/effects/` effect implementations
- `src/utils/rearranger.ts` slice/reorder/detect logic
- `src/utils/rearrangerWasm.ts` tiny WASM onset kernel + fallback
- `BLUEPRINT.md` architecture reference and product constraints

## Notes for Contributors

- `BLUEPRINT.md` is the source of truth for architecture and constraints.
- Keep effect behavior parity across live playback, Save Loop, Export Mix, and global recording.
- Run tests and lint for logic/UI changes:
  - `npm test`
  - `npm run lint`
