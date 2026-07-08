import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import type { SwingEntryPayload } from './types';

interface Props {
  symbol: string;
  price: number;
  asOfDate?: string | null;
  entry: SwingEntryPayload;
  onAdded?: () => void;
}

export function SwingAddPositionForm({ symbol, price, asOfDate, entry, onAdded }: Props) {
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState('');
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState({
    entry_price: '',
    entry_date: '',
    shares: '',
    stop_loss: '',
    profit_target: '',
    notes: '',
  });

  useEffect(() => {
    setForm({
      entry_price: price > 0 ? String(price) : '',
      entry_date: asOfDate ?? new Date().toISOString().slice(0, 10),
      shares: '',
      stop_loss: entry.stop_loss != null ? String(entry.stop_loss) : '',
      profit_target: entry.profit_target != null ? String(entry.profit_target) : '',
      notes: '',
    });
    setFormMsg('');
    setFormErr('');
  }, [symbol, price, asOfDate, entry.stop_loss, entry.profit_target]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErr('');
    setFormMsg('');
    try {
      await api('/api/v1/swing/positions', {
        method: 'POST',
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          entry_price: Number(form.entry_price),
          entry_date: form.entry_date,
          shares: form.shares ? Number(form.shares) : undefined,
          stop_loss: form.stop_loss ? Number(form.stop_loss) : undefined,
          profit_target: form.profit_target ? Number(form.profit_target) : undefined,
          notes: form.notes || undefined,
          source: 'scanner',
        }),
      });
      setFormMsg(`Added ${symbol} to swing positions.`);
      onAdded?.();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Could not add position');
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="swing-add-position">
      <summary>Add to positions tracker</summary>
      <p className="swing-subsection-hint muted">
        Pre-filled from engine trade plan. Adjust entry date if filling after the signal session.
      </p>
      <form className="swing-add-grid" onSubmit={handleSubmit}>
        <label>
          <span className="field-name">Entry price (₹)</span>
          <input
            type="number"
            step="0.05"
            min="0.01"
            required
            value={form.entry_price}
            onChange={(e) => setForm((f) => ({ ...f, entry_price: e.target.value }))}
          />
        </label>
        <label>
          <span className="field-name">Entry date</span>
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
            step="1"
            min="0"
            placeholder="Optional"
            value={form.shares}
            onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))}
          />
        </label>
        <label>
          <span className="field-name">Stop (₹)</span>
          <input
            type="number"
            step="0.05"
            min="0"
            value={form.stop_loss}
            onChange={(e) => setForm((f) => ({ ...f, stop_loss: e.target.value }))}
          />
        </label>
        <label>
          <span className="field-name">Target (₹)</span>
          <input
            type="number"
            step="0.05"
            min="0"
            value={form.profit_target}
            onChange={(e) => setForm((f) => ({ ...f, profit_target: e.target.value }))}
          />
        </label>
        <label className="swing-add-notes">
          <span className="field-name">Notes</span>
          <input
            type="text"
            placeholder="Optional thesis / catalyst"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </label>
        <div className="swing-add-actions">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Add position'}
          </button>
        </div>
      </form>
      {formMsg ? <p className="muted swing-form-msg">{formMsg}</p> : null}
      {formErr ? <p className="error">{formErr}</p> : null}
    </details>
  );
}
