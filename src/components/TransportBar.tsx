type TransportBarProps = {
  exportMinutes: number;
  onExportMinutesChange: (value: number) => void;
  onExport: () => void;
  exporting: boolean;
  recording: boolean;
  onRecordToggle: () => void;
};

const TransportBar = ({
  exportMinutes,
  onExportMinutesChange,
  onExport,
  exporting,
  recording,
  onRecordToggle,
}: TransportBarProps) => {
  return (
    <section className="panel transport">
      <div className="panel__title">Global Recorder</div>
      <div className="transport__controls">
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
          <button type="button" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting..." : "Export Mix"}
          </button>
        </div>
        <button type="button" className="transport__record" onClick={onRecordToggle}>
          {recording ? "Stop Recording" : "Record"}
        </button>
      </div>
    </section>
  );
};

export default TransportBar;
