# Loop Loop Loop

Loop Loop Loop is a browser-based experimental DJ and loop instrument.

It is designed for discovery, not perfection. You load sounds, carve loops, and mutate them with unusual effects. The app is intentionally "instrument-like": fast interaction, lots of happy accidents, and nonlinear workflow.

If you have no musical training, that is completely fine. This README is written for you.

## What This App Is (In Plain Language)

Think of each deck as a tiny audio workbench:
- you load a sound file,
- pick a segment to repeat (a loop),
- reshape that loop with FX,
- capture interesting moments,
- and layer multiple decks together.

This is not a traditional DJ library manager. There is no crate digging or BPM-first workflow required. It is closer to live collage and sound design.

## First 10 Minutes (No Experience Needed)

1. Open the app and load one audio file into Deck 1.
2. Press `Space` to play/pause the active deck.
3. In the waveform, drag the `IN` and `OUT` loop markers so the loop is short (1-4 seconds).
4. Open Deck FX and try:
   - DJ Filter (sweep tone),
   - Delay (echo),
   - Rearranger (slice/reorder),
   - Fractal Resonator (textural harmonic color).
5. Use **Save Loop** to create a clip.
6. Load the saved clip into a second deck.
7. Start/stop decks to build a layered pattern.

You are now using the app correctly.

## Core Concepts (Beginner-Friendly)

### Deck
A deck is one independent player with its own:
- audio file,
- loop window,
- playback state,
- FX settings,
- automation.

### Loop
A loop is a selected time range inside the file.
- Example: if your file is 30 seconds, your loop might be seconds 4.2 to 6.0.
- The deck repeats this range continuously when loop is enabled.

### Active Deck
Keyboard shortcuts affect the active deck (usually last clicked/interacted).

### Clip Rack
When you save loop material, clips appear in Clip Rack.
- You can reload clips into any deck.
- Clips can carry metadata about FX and automation settings.

## Rearranger: The Most Important "Esoteric" Feature

Rearranger works on your loop by dividing it into slices and changing their order/behavior.

Controls:
- **Slices**: how many chunks the loop is divided into.
- **Offset**: rotates slice order.
- **Chaos**: introduces randomized reordering.
- **Reverse**: chance that a slice plays backwards.
- **On Loop**: re-runs rearrangement each time loop wraps.

Waveform interactions when Rearranger is visible:
- Click between slice boundaries: **add slice**.
- Click a slice handle (boundary dot): **remove divider only** (audio stays same length).
- Hold `Shift` + click a slice region: **destructive slice delete** (that audio segment is removed from buffer; duration shortens).

Destructive delete example:
- 10-second clip,
- delete a 1-second slice,
- deck becomes 9 seconds,
- waveform and duration update.

## Automation (Animated Parameter Motion)

Automation lets a parameter move over time automatically.

Typical use:
- automate DJ Filter for rhythmic sweeps,
- automate EQ or pitch for shape movement,
- layer multiple automated decks.

In each automation lane you can:
- draw values directly,
- toggle active/bypass,
- reset,
- apply presets (`Sin`, `Tri`, `Ramp`),
- invert curve (`Inv`),
- scale length/amplitude.

## Save Loop, FX Metadata, and "What Gets Baked"

This app separates **audio content** and **settings metadata**:
- Save Loop stores raw loop audio (not always permanently baked with all deck FX).
- Clip metadata stores deck settings/automation snapshots.
- Clip Rack FX toggle controls whether loading a clip also reapplies stored settings.

This keeps clips reusable: same audio, different deck context.

## Keyboard Shortcuts (Current Workflow)

Transport and deck workflow:
- `Space`: play/pause active deck
- `Shift + Space`: global play/pause
- `R`: toggle Rearranger panel (active deck)
- `L`: toggle loop (active deck)
- `Shift + L`: reset loop to full file (active deck)
- `=` / `-`: waveform zoom in/out (active deck)

Session/workflow:
- `Cmd/Ctrl + Z`: undo
- `Cmd/Ctrl + Shift + Z`: redo
- `Cmd/Ctrl + S`: save session
- `Cmd/Ctrl + O`: open session
- `A`: add deck
- `?`: toggle keyboard help overlay

## Undo/Redo Behavior Notes

Undo tracks meaningful deck/session actions.

For loop-bound dragging:
- loop moves update live while dragging,
- history commits on interaction end (pointer release),
- undo should return to pre-drag bounds.

If behavior ever feels surprising, check whether you changed:
- loop bounds,
- rearranger regions,
- destructive slice operations,
which can all be represented in history/state differently.

## Audio Engine and Rendering Paths (Why It Matters)

Several paths must stay aligned so what you hear matches what you save/export:
- live deck playback,
- Save Loop rendering,
- Export Mix rendering,
- master recording output.

The project architecture intentionally emphasizes parity across those paths.

## Sessions and Persistence

You can save/load sessions. A session stores:
- deck state,
- loop bounds,
- FX settings,
- automation snapshots,
- panel UI states,
- references to audio assets.

Export/import uses a zip bundle with session manifest plus WAV assets.

## Development Setup

Requirements:
- Node.js 18+
- npm

Install and run:
- `npm install`
- `npm run dev`

Other commands:
- `npm run build`
- `npm run preview`
- `npm run lint`
- `npm test`

## Project Layout (Quick Map)

- `src/components/`: UI components (`DeckCard`, `Waveform`, `ClipRecorder`, etc.)
- `src/hooks/useDecks.ts`: deck/session state orchestration
- `src/audio/`: engine and DSP plumbing
- `src/audio/effects/`: effect modules
- `src/utils/`: helper modules (session store, rearranger math, zip, etc.)
- `BLUEPRINT.md`: architecture and product direction

## Guidance for First-Time Sound Explorers

If you feel lost, do this loop:
1. Make loops shorter.
2. Change one control at a time.
3. Save clips often.
4. Duplicate ideas across decks.
5. Use undo aggressively.

The app rewards experimentation over correctness.

## Known Product Direction

Loop Loop Loop is intentionally esoteric:
- It supports destructive and non-destructive transformations.
- It allows "wrong" but interesting workflows.
- It treats mistakes as composition material.

That is a design goal, not a bug.
