type WelcomePanelProps = {
  onClose: () => void;
};

const WelcomePanel = ({ onClose }: WelcomePanelProps) => (
  <section className="panel welcome-panel">
    <div className="welcome-panel__header">
      <div className="panel__title">Welcome to Loop Loop Loop</div>
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
      Load audio to a deck, set loop points on the waveform, then shape the sound with deck FX.
    </p>
    <ul className="welcome-panel__list">
      <li>Use the clip recorder to capture the master output, then reload clips into any deck.</li>
      <li>Save Loop captures loop audio; Save FX Settings stores deck settings with the clip.</li>
      <li>Export Mix renders the full mixdown offline from the Minutes value.</li>
      <li>Use Rearranger and Fractal for the most extreme transformations.</li>
    </ul>
  </section>
);

export default WelcomePanel;
