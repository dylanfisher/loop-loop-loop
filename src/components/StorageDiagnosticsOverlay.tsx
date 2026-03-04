import { useCallback, useEffect, useState } from "react";
import {
  collectStorageDiagnostics,
  formatStorageBytes,
  type StorageDiagnosticsSummary,
} from "../utils/storageDiagnostics";

type StorageDiagnosticsOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const formatPercent = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(1)}%`;
};

const formatDateTime = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Date(value).toLocaleString();
};

const StorageDiagnosticsOverlay = ({ open, onClose }: StorageDiagnosticsOverlayProps) => {
  const [details, setDetails] = useState<StorageDiagnosticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const next = await collectStorageDiagnostics();
      setDetails(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load storage diagnostics.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void collectStorageDiagnostics()
      .then((next) => {
        setDetails(next);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load storage diagnostics.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const usagePercent =
    typeof details?.browserUsageBytes === "number" &&
    typeof details?.browserQuotaBytes === "number" &&
    details.browserQuotaBytes > 0
      ? details.browserUsageBytes / details.browserQuotaBytes
      : null;
  const indexedTotal =
    (details?.indexedDb.blobBytes ?? 0) + (details?.indexedDb.sessionBytesApprox ?? 0);

  return (
    <div
      className="storage-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Storage diagnostics"
      onClick={onClose}
    >
      <div className="storage-overlay__card" onClick={(event) => event.stopPropagation()}>
        <div className="storage-overlay__header">
          <strong>Storage Diagnostics</strong>
          <div className="storage-overlay__actions">
            <button type="button" onClick={() => void refresh()} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {loading ? <div className="storage-overlay__status">Loading storage details...</div> : null}
        {error ? <div className="storage-overlay__status storage-overlay__status--error">{error}</div> : null}
        {!loading && details ? (
          <div className="storage-overlay__body">
            <div className="storage-overlay__section">
              <h3>Browser Quota</h3>
              <div className="storage-overlay__kv">
                <span>Total usage</span>
                <span>{formatStorageBytes(details.browserUsageBytes)}</span>
                <span>Quota</span>
                <span>{formatStorageBytes(details.browserQuotaBytes)}</span>
                <span>Quota used</span>
                <span>{formatPercent(usagePercent)}</span>
                <span>Captured</span>
                <span>{formatDateTime(details.capturedAt)}</span>
              </div>
            </div>

            <div className="storage-overlay__section">
              <h3>IndexedDB ({formatStorageBytes(indexedTotal)})</h3>
              <div className="storage-overlay__kv">
                <span>Sessions</span>
                <span>{details.indexedDb.sessionCount}</span>
                <span>Session JSON (approx)</span>
                <span>{formatStorageBytes(details.indexedDb.sessionBytesApprox)}</span>
                <span>Blobs</span>
                <span>{details.indexedDb.blobCount}</span>
                <span>Blob bytes</span>
                <span>{formatStorageBytes(details.indexedDb.blobBytes)}</span>
              </div>
              <div className="storage-overlay__tables">
                <div>
                  <p>Largest blobs</p>
                  <ul className="storage-overlay__list">
                    {details.indexedDb.largestBlobs.length === 0 ? (
                      <li>None</li>
                    ) : (
                      details.indexedDb.largestBlobs.map((item) => (
                        <li key={item.id}>
                          <span>{item.id}</span>
                          <span>{formatStorageBytes(item.bytes)}</span>
                          <span>{item.mimeType}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <p>Sessions by size</p>
                  <ul className="storage-overlay__list">
                    {details.indexedDb.sessions.length === 0 ? (
                      <li>None</li>
                    ) : (
                      details.indexedDb.sessions.map((session) => (
                        <li key={session.id}>
                          <span>{session.name}</span>
                          <span>{formatStorageBytes(session.bytesApprox)}</span>
                          <span>
                            {session.decks} decks / {session.clips} clips
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </div>

            <div className="storage-overlay__section">
              <h3>localStorage ({formatStorageBytes(details.localStorage.totalBytes)})</h3>
              <div className="storage-overlay__kv">
                <span>Keys</span>
                <span>{details.localStorage.keyCount}</span>
              </div>
              <ul className="storage-overlay__list">
                {details.localStorage.items.length === 0 ? (
                  <li>None</li>
                ) : (
                  details.localStorage.items.map((item) => (
                    <li key={item.key}>
                      <span>{item.key}</span>
                      <span>{formatStorageBytes(item.bytes)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {details.notes.length > 0 ? (
              <div className="storage-overlay__section">
                <h3>Notes</h3>
                <ul className="storage-overlay__notes">
                  {details.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default StorageDiagnosticsOverlay;
