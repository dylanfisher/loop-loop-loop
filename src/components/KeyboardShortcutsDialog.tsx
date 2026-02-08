type KeyboardShortcutsDialogProps = {
  open: boolean;
  onClose: () => void;
};

const KeyboardShortcutsDialog = ({ open, onClose }: KeyboardShortcutsDialogProps) => {
  if (!open) return null;
  return (
    <div className="app__shortcuts" role="dialog" aria-modal="false" aria-label="Keyboard shortcuts">
      <div className="app__shortcuts-card">
        <div className="app__shortcuts-header">
          <strong>Keyboard Shortcuts</strong>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            ×
          </button>
        </div>
        <ul className="app__shortcuts-list">
          <li><kbd>Space</kbd> Play/Pause active deck</li>
          <li><kbd>Shift</kbd> + <kbd>Space</kbd> Global Play/Pause</li>
          <li><kbd>R</kbd> Toggle Rearranger panel (active deck)</li>
          <li><kbd>L</kbd> Toggle loop (active deck)</li>
          <li><kbd>Shift</kbd> + <kbd>L</kbd> Reset loop to full file</li>
          <li><kbd>C</kbd> Crop active deck to loop</li>
          <li><kbd>D</kbd> Duplicate active deck</li>
          <li><kbd>Delete</kbd>/<kbd>Backspace</kbd> Remove active deck</li>
          <li><kbd>=</kbd> Zoom out waveform</li>
          <li><kbd>-</kbd> Zoom in waveform</li>
          <li><kbd>A</kbd> Add deck</li>
          <li><kbd>Cmd/Ctrl</kbd> + <kbd>Z</kbd> Undo</li>
          <li><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> Redo</li>
          <li><kbd>Cmd/Ctrl</kbd> + <kbd>S</kbd> Save session</li>
          <li><kbd>Cmd/Ctrl</kbd> + <kbd>O</kbd> Open session</li>
          <li><kbd>?</kbd> Toggle this panel</li>
        </ul>
      </div>
    </div>
  );
};

export default KeyboardShortcutsDialog;
