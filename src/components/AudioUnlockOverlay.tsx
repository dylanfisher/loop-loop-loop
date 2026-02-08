type AudioUnlockOverlayProps = {
  open: boolean;
  audioUnlockError: string | null;
  onEnableAudio: () => void;
};

const AudioUnlockOverlay = ({ open, audioUnlockError, onEnableAudio }: AudioUnlockOverlayProps) => {
  if (!open) return null;
  return (
    <div className="audio-unlock" role="dialog" aria-modal="true" aria-label="Enable audio">
      <div className="audio-unlock__card">
        <div className="audio-unlock__glow" aria-hidden="true" />
        <div className="audio-unlock__badge">Audio Gate</div>
        <h2>Enable Audio Engine</h2>
        <p>
          Your browser requires a user gesture before audio can play. Tap below
          to unlock live playback, recording, and exports.
        </p>
        <button type="button" className="audio-unlock__action" onClick={onEnableAudio}>
          Enable Audio
        </button>
        <div className="audio-unlock__hint">
          {audioUnlockError ?? "Tip: Spacebar works too."}
        </div>
      </div>
    </div>
  );
};

export default AudioUnlockOverlay;
