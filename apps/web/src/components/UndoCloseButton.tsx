import { useEffect, useState } from 'react';
import { api } from '../api';

const UNDO_CLOSE_WINDOW_MS = 5 * 60 * 1000;

function undoCloseMeta(closedAt: string | null | undefined, nowMs = Date.now()) {
  if (!closedAt) return { can_undo: false, undo_seconds_left: 0 };
  const closedMs = Date.parse(closedAt);
  if (Number.isNaN(closedMs)) return { can_undo: false, undo_seconds_left: 0 };
  const remaining = UNDO_CLOSE_WINDOW_MS - (nowMs - closedMs);
  return {
    can_undo: remaining > 0,
    undo_seconds_left: remaining > 0 ? Math.ceil(remaining / 1000) : 0,
  };
}

function fmtCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function UndoCloseButton({
  positionId,
  closedAt,
  reopenPath,
  onDone,
}: {
  positionId: string;
  closedAt: string | null | undefined;
  reopenPath: string;
  onDone?: () => void | Promise<void>;
}) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const meta = undoCloseMeta(closedAt, Date.now());
    if (!meta.can_undo) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [closedAt]);

  const meta = undoCloseMeta(closedAt, now);
  if (!meta.can_undo || !positionId) return null;

  async function handleUndo() {
    if (!window.confirm('Reopen this position? It will return to open status.')) return;
    setBusy(true);
    setError('');
    try {
      await api(reopenPath, { method: 'POST', body: JSON.stringify({}) });
      await onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="undo-close-wrap">
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void handleUndo()}>
        {busy ? '…' : 'Undo'}
      </button>
      <span className="muted undo-close-timer">{fmtCountdown(meta.undo_seconds_left)}</span>
      {error ? <div className="error undo-close-error">{error}</div> : null}
    </div>
  );
}
