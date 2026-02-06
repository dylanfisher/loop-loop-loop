import { useState } from "react";

type WelcomePanelProps = {
  onClose: () => void;
  onOpenDemoLoop: () => void | Promise<void>;
};

const WelcomePanel = ({ onClose, onOpenDemoLoop }: WelcomePanelProps) => {
  const [loadingDemo, setLoadingDemo] = useState(false);

  const handleOpenDemo = async () => {
    if (loadingDemo) return;
    setLoadingDemo(true);
    try {
      await onOpenDemoLoop();
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <section className="panel welcome-panel">
      <div className="welcome-panel__header">
        <div className="welcome-panel__title-wrap">
          <p className="welcome-panel__eyebrow">Welcome</p>
        </div>
        <button
          type="button"
          className="welcome-panel__close"
          aria-label="Close welcome panel"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>
      <p className="welcome-panel__body">
        Loop Loop Loop is built for experimenting with short audio ideas. Start by loading a file
        into a deck and defining a loop directly on the waveform. Then use the FX section to
        change rhythm, texture, and tone in real time. Save anything interesting as a clip and
        reuse it in another deck.
        &nbsp;
        <button
          type="button"
          className="welcome-panel__dismiss welcome-panel__demo-button"
          onClick={() => void handleOpenDemo()}
          disabled={loadingDemo}
        >
          {loadingDemo ? "Opening..." : "Open a Demo Loop"}
        </button>
      </p>
      <ol className="welcome-panel__list">
        <li>Load one file into Deck 1.</li>
        <li>Set a tight loop by dragging IN and OUT.</li>
        <li>Open Deck FX and tweak filter, EQ, delay, or rearranger.</li>
        <li>Save, then load that clip into another deck and layer it.</li>
      </ol>
      <div className="welcome-panel__columns">
        <article className="welcome-panel__card">
          <h3>Start Simple</h3>
          <p>
            Press <strong>A</strong> to add decks. Press <strong>Space</strong> to play or pause
            the active deck.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Load Audio</h3>
          <p>
            Drop in any WAV/MP3/AIFF style source. You do not need key detection or beat grids to
            begin making useful loops here.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Set a Loop</h3>
          <p>
            Drag the waveform loop handles to isolate a phrase. Short loops (1-4 seconds) are
            easiest to sculpt and layer.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Choose an Active Deck</h3>
          <p>
            Keyboard controls follow the last clicked deck. Click a deck before using shortcuts
            like loop toggle, zoom, or rearranger.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Shape Time</h3>
          <p>
            Drag loop points, open Rearranger, then click between slice boundaries to add slices.
            Hold <strong>Shift</strong> and click a slice region to destructively remove it.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Rearranger Tips</h3>
          <p>
            Swap Count selects how many slices trade places, Chaos controls how far they can jump,
            Reverse flips slices. Use small amounts first, then increase for glitchier structure.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Automation Lanes</h3>
          <p>
            Draw parameter motion over time. Use Sin/Tri/Ramp presets, then <strong>Inv</strong>{" "}
            to flip shape around center for instant variation.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>FX Metadata Toggle</h3>
          <p>
            Clip Rack clips can optionally load saved deck FX settings. Toggle the clip FX badge
            on or off depending on whether you want a clean or styled reload.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Global Capture</h3>
          <p>
            Clip Recorder captures the master output. This is useful for printing happy accidents
            and quickly reusing them as new source material.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Capture Ideas</h3>
          <p>
            Save captures loop material to Clip Rack. Use the FX badge to decide whether saved
            deck settings load with the clip.
          </p>
        </article>
        <article className="welcome-panel__card">
          <h3>Undo + Sessions</h3>
          <p>
            Use <strong>Cmd/Ctrl+Z</strong> often. Save sessions as milestones, especially before
            destructive slice deletes or major rearranger passes.
          </p>
        </article>
      </div>
      <div className="welcome-panel__footer">
        <button type="button" className="welcome-panel__dismiss" onClick={onClose}>
          Close This Panel
        </button>
      </div>
    </section>
  );
};

export default WelcomePanel;
