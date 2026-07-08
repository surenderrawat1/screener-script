import { useState } from 'react';
import { api } from '../../api';
import { fetchSymbolPrice } from './fetchSymbolPrice';
import type { OpenPositionRow } from './OpenPositionsPanel';

function fmtRs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PositionInlineEdit({
  position,
  busy,
  onSaved,
  onError,
  onStart,
}: {
  position: OpenPositionRow;
  busy: boolean;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
  onStart?: () => void;
}) {
  const [form, setForm] = useState({
    entry_price: String(position.entry_price),
    entry_date: position.entry_date,
    shares: position.shares != null ? String(position.shares) : '',
    stop_loss: position.stop_loss != null ? String(position.stop_loss) : '',
    profit_target: position.profit_target != null ? String(position.profit_target) : '',
    notes: position.notes ?? '',
  });
  const [fetchBusy, setFetchBusy] = useState(false);

  async function fetchNow() {
    setFetchBusy(true);
    try {
      const price = await fetchSymbolPrice(position.symbol);
      if (price == null) {
        onError(`Could not fetch price for ${position.symbol}`);
        return;
      }
      setForm((f) => ({ ...f, entry_price: String(price) }));
    } finally {
      setFetchBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    onStart?.();
    try {
      await api(`/api/v1/swing/positions/${position.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          entry_price: Number(form.entry_price),
          entry_date: form.entry_date,
          shares: form.shares ? Number(form.shares) : null,
          stop_loss: form.stop_loss ? Number(form.stop_loss) : null,
          profit_target: form.profit_target ? Number(form.profit_target) : null,
          notes: form.notes || null,
        }),
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <details className="swing-pos-edit">
      <summary>Edit entry</summary>
      <form className="swing-edit-form" onSubmit={(e) => void save(e)}>
        <label>
          <span className="field-name">Entry ₹</span>
          <div className="swing-entry-price-wrap">
            <input
              type="number"
              step="0.05"
              required
              value={form.entry_price}
              onChange={(e) => setForm((f) => ({ ...f, entry_price: e.target.value }))}
            />
            <button type="button" className="btn btn-secondary btn-xs" disabled={fetchBusy || busy} onClick={() => void fetchNow()}>
              {fetchBusy ? '…' : 'Fetch now'}
            </button>
          </div>
        </label>
        <label>
          <span className="field-name">Date</span>
          <input
            type="date"
            required
            value={form.entry_date}
            onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
          />
        </label>
        <label>
          <span className="field-name">Shares</span>
          <input
            type="number"
            min={0}
            value={form.shares}
            onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))}
          />
        </label>
        <label>
          <span className="field-name">Stop ₹</span>
          <input
            type="number"
            step="0.05"
            value={form.stop_loss}
            onChange={(e) => setForm((f) => ({ ...f, stop_loss: e.target.value }))}
          />
        </label>
        <label>
          <span className="field-name">Target ₹</span>
          <input
            type="number"
            step="0.05"
            value={form.profit_target}
            onChange={(e) => setForm((f) => ({ ...f, profit_target: e.target.value }))}
          />
        </label>
        <label className="swing-edit-notes">
          <span className="field-name">Notes</span>
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
      </form>
    </details>
  );
}

export function PositionInlineClose({
  position,
  busy,
  onClosed,
  onError,
  onStart,
}: {
  position: OpenPositionRow;
  busy: boolean;
  onClosed: () => void | Promise<void>;
  onError: (msg: string) => void;
  onStart?: () => void;
}) {
  const [closedPrice, setClosedPrice] = useState(
    position.current_price != null ? String(position.current_price) : '',
  );
  const [reason, setReason] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(closedPrice);
    if (!Number.isFinite(price) || price <= 0) {
      onError('Valid exit price required');
      return;
    }
    if (!window.confirm(`Close ${position.symbol} at ${fmtRs(price)}?`)) return;
    onError('');
    onStart?.();
    try {
      await api(`/api/v1/swing/positions/${position.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          closed_price: price,
          closed_reason: reason.trim() || 'manual',
        }),
      });
      await onClosed();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Close failed');
    }
  }

  return (
    <form className="swing-inline-close" onSubmit={(e) => void submit(e)}>
      <input
        type="number"
        step="0.05"
        min={0.01}
        placeholder="Exit ₹"
        value={closedPrice}
        onChange={(e) => setClosedPrice(e.target.value)}
        required
      />
      <input
        type="text"
        placeholder="X1, X2, X4…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
        {busy ? '…' : 'Close'}
      </button>
    </form>
  );
}
