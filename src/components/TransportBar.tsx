import AsyncActionButton from "./AsyncActionButton";

type TransportBarProps = {
  exportMinutes: number;
  onExportMinutesChange: (value: number) => void;
  onExport: () => void;
  exporting: boolean;
  recording: boolean;
  onRecordToggle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const TransportBar = ({
  exportMinutes,
  onExportMinutesChange,
  onExport,
  exporting,
  recording,
  onRecordToggle,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: TransportBarProps) => {
  return (
    <section className="panel transport">
      <div className="panel__title">Global Recorder</div>
      <div className="transport__controls">
        <div className="transport__history">
          <button type="button" onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            Redo
          </button>
        </div>
        <div className="transport__export">
          <label>
            Minutes
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={exportMinutes}
              onChange={(event) => onExportMinutesChange(Number(event.target.value))}
            />
          </label>
          <AsyncActionButton
            onAction={onExport}
            disabled={exporting}
            busy={exporting}
            idleLabel="Export Mix"
            busyLabel="Exporting..."
          />
        </div>
        <button type="button" className="transport__record" onClick={onRecordToggle}>
          {recording ? "Stop Recording" : "Record"}
        </button>
      </div>
    </section>
  );
};

export default TransportBar;
