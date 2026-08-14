import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import type { IntradayPositionRow } from './IntradayPositionsPanels';

export interface InstrumentOption {
  id: string;
  label: string;
  kind: 'index' | 'stock';
}

export interface InstrumentsResponse {
  indices: InstrumentOption[];
  stocks: InstrumentOption[];
  etfs?: InstrumentOption[];
}

export interface LogEntryPrefill {
  instrument_id: string;
  product_type: 'spot' | 'futures' | 'options';
  side: 'long' | 'short';
  timeframe: '5m' | '15m';
  entry_price: string;
  stop_loss: string;
  target_t1: string;
  target_t2: string;
  target_t3: string;
  quantity: string;
  notes: string;
  source?: string;
}

interface Props {
  instruments: InstrumentsResponse;
  openPositions: IntradayPositionRow[];
  prefill: LogEntryPrefill;
  fromRadar: boolean;
  onCreated: () => void | Promise<void>;
}

function num(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function targetsFromRisk(entry: number, stop: number, side: 'long' | 'short') {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return { t1: '', t2: '', t3: '' };
  if (side === 'long') {
    return {
      t1: String(round2(entry + risk)),
      t2: String(round2(entry + 2 * risk)),
      t3: String(round2(entry + 3 * risk)),
    };
  }
  return {
    t1: String(round2(entry - risk)),
    t2: String(round2(entry - 2 * risk)),
    t3: String(round2(entry - 3 * risk)),
  };
}

function validateForm(form: LogEntryPrefill): string | null {
  const entry = num(form.entry_price);
  if (entry == null) return 'Entry price is required and must be > 0.';

  const stop = num(form.stop_loss);
  if (stop != null) {
    if (form.side === 'long' && stop >= entry) return 'Long stop must be below entry.';
    if (form.side === 'short' && stop <= entry) return 'Short stop must be above entry.';
  }

  for (const [label, raw] of [
    ['T1', form.target_t1],
    ['T2', form.target_t2],
    ['T3', form.target_t3],
  ] as const) {
    const t = num(raw);
    if (t == null) continue;
    if (form.side === 'long' && t <= entry) return `${label} must be above entry for long.`;
    if (form.side === 'short' && t >= entry) return `${label} must be below entry for short.`;
  }

  if (form.quantity.trim()) {
    const q = Number(form.quantity);
    if (!Number.isFinite(q) || q <= 0) return 'Quantity must be a positive number.';
  }
  return null;
}

export function IntradayLogEntryForm({ instruments, openPositions, prefill, fromRadar, onCreated }: Props) {
  const [form, setForm] = useState<LogEntryPrefill>(prefill);
  const [saving, setSaving] = useState(false);
  const [fetchingLtp, setFetchingLtp] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setForm(prefill);
  }, [prefill]);

  const duplicateOpen = openPositions.find(
    (p) => p.status === 'open' && p.instrument_id === form.instrument_id,
  );

  const preview = useMemo(() => {
    const entry = num(form.entry_price);
    const stop = num(form.stop_loss);
    const qty = form.quantity.trim() ? Number(form.quantity) : null;
    if (entry == null) return null;
    const riskPerShare = stop != null ? Math.abs(entry - stop) : null;
    const riskPct = riskPerShare != null && entry > 0 ? round2((riskPerShare / entry) * 100) : null;
    const notional = qty != null && qty > 0 ? round2(entry * qty) : null;
    const riskInr =
      riskPerShare != null && qty != null && qty > 0 ? round2(riskPerShare * qty) : null;
    const t1 = num(form.target_t1);
    const rr =
      riskPerShare != null && riskPerShare > 0 && t1 != null
        ? round2(Math.abs(t1 - entry) / riskPerShare)
        : null;
    return { entry, stop, qty, riskPerShare, riskPct, notional, riskInr, rr };
  }, [form]);

  function setField<K extends keyof LogEntryPrefill>(key: K, value: LogEntryPrefill[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
    setSuccess('');
  }

  function applyTargets() {
    const entry = num(form.entry_price);
    const stop = num(form.stop_loss);
    if (entry == null || stop == null) {
      setError('Enter entry and stop first to auto-fill 1R / 2R / 3R targets.');
      return;
    }
    const t = targetsFromRisk(entry, stop, form.side);
    setForm((f) => ({ ...f, ...t }));
    setError('');
  }

  async function fillLtp() {
    setFetchingLtp(true);
    setError('');
    try {
      const state = await api<{
        analysis?: { price?: number; ltp?: number };
        plan?: { entry?: { price?: number }; stop_loss?: { price?: number }; exits?: Array<{ price?: number }>; bias?: string };
      }>(
        `/api/v1/intraday/nifty/state?instrument=${encodeURIComponent(form.instrument_id)}&interval=${form.timeframe}`,
      );
      const ltp = Number(state.analysis?.ltp ?? state.analysis?.price ?? 0);
      const planEntry = Number(state.plan?.entry?.price ?? 0);
      const planStop = Number(state.plan?.stop_loss?.price ?? 0);
      const bias = String(state.plan?.bias ?? '');
      const exits = state.plan?.exits ?? [];
      setForm((f) => ({
        ...f,
        entry_price: planEntry > 0 ? String(round2(planEntry)) : ltp > 0 ? String(round2(ltp)) : f.entry_price,
        stop_loss: planStop > 0 ? String(round2(planStop)) : f.stop_loss,
        target_t1: exits[0]?.price != null ? String(round2(Number(exits[0].price))) : f.target_t1,
        target_t2: exits[1]?.price != null ? String(round2(Number(exits[1].price))) : f.target_t2,
        target_t3: exits[2]?.price != null ? String(round2(Number(exits[2].price))) : f.target_t3,
        side: bias === 'short' || bias === 'long' ? bias : f.side,
      }));
      if (ltp <= 0 && planEntry <= 0) setError('No live price available for this instrument.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LTP / plan');
    } finally {
      setFetchingLtp(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clientError = validateForm(form);
    if (clientError) {
      setError(clientError);
      return;
    }
    if (duplicateOpen) {
      setError(
        `Open ${duplicateOpen.instrument_label} already exists today @ ₹${duplicateOpen.entry_price}. Close it first.`,
      );
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await api<{ position: { id: string; instrument_label?: string; symbol?: string } }>(
        '/api/v1/intraday/positions',
        {
          method: 'POST',
          body: JSON.stringify({
            instrument_id: form.instrument_id,
            side: form.side,
            timeframe: form.timeframe,
            entry_price: Number(form.entry_price),
            stop_loss: form.stop_loss ? Number(form.stop_loss) : undefined,
            target_t1: form.target_t1 ? Number(form.target_t1) : undefined,
            target_t2: form.target_t2 ? Number(form.target_t2) : undefined,
            target_t3: form.target_t3 ? Number(form.target_t3) : undefined,
            quantity: form.quantity ? Number(form.quantity) : undefined,
            notes:
              [
                form.product_type !== 'spot' ? `[${form.product_type.toUpperCase()}]` : '',
                form.notes,
              ]
                .filter(Boolean)
                .join(' ')
                .trim() || undefined,
            source:
              form.source ||
              (form.product_type === 'spot' ? 'manual' : `fno_${form.product_type}`),
          }),
        },
      );
      const label = res.position.instrument_label ?? res.position.symbol ?? form.instrument_id;
      setSuccess(`Logged ${label} ${form.side.toUpperCase()} @ ₹${form.entry_price}`);
      setForm((f) => ({
        ...f,
        entry_price: '',
        stop_loss: '',
        target_t1: '',
        target_t2: '',
        target_t3: '',
        quantity: '',
        notes: '',
      }));
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card nip-log-entry">
      <div className="nip-log-entry-head">
        <h2>Log entry</h2>
        <div className="nip-log-entry-actions">
          <button type="button" className="btn btn-secondary" disabled={fetchingLtp || saving} onClick={() => void fillLtp()}>
            {fetchingLtp ? 'Fetching…' : 'Fill from radar'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={applyTargets}>
            Auto 1R/2R/3R
          </button>
        </div>
      </div>

      {fromRadar ? (
        <p className="nip-log-banner">
          Prefill loaded from <Link to={`/intraday?instrument=${encodeURIComponent(form.instrument_id)}`}>radar</Link>.
          Review levels before logging.
        </p>
      ) : null}

      {duplicateOpen ? (
        <p className="nip-log-warn" role="status">
          Open position already exists for {duplicateOpen.instrument_label} (entry ₹{duplicateOpen.entry_price}).
        </p>
      ) : null}

      {error && <p className="error">{error}</p>}
      {success && <p className="nip-log-success">{success}</p>}

      <form className="form-grid nip-log-form" onSubmit={(e) => void handleSubmit(e)}>
        <label>
          Product
          <select
            value={form.product_type}
            onChange={(e) => setField('product_type', e.target.value as LogEntryPrefill['product_type'])}
          >
            <option value="spot">Spot / cash</option>
            <option value="futures">Futures</option>
            <option value="options">Options</option>
          </select>
        </label>

        <label>
          Instrument
          <select value={form.instrument_id} onChange={(e) => setField('instrument_id', e.target.value)}>
            <optgroup label="Indices">
              {instruments.indices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Stocks">
              {instruments.stocks.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
            {(instruments.etfs ?? []).length > 0 && (
              <optgroup label="ETFs">
                {instruments.etfs!.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            )}
            {![...instruments.indices, ...instruments.stocks, ...(instruments.etfs ?? [])].some(
              (i) => i.id === form.instrument_id,
            ) && form.instrument_id ? (
              <optgroup label="Custom">
                <option value={form.instrument_id}>{form.instrument_id.toUpperCase()}</option>
              </optgroup>
            ) : null}
          </select>
        </label>
        <label>
          Or type any symbol
          <input
            value={form.instrument_id}
            onChange={(e) => setField('instrument_id', e.target.value.trim())}
            placeholder="SUNPHARMA, NIFTYBEES, INFY.BO"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label>
          Side
          <select value={form.side} onChange={(e) => setField('side', e.target.value as 'long' | 'short')}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>

        <label>
          Timeframe
          <select
            value={form.timeframe}
            onChange={(e) => setField('timeframe', e.target.value as '5m' | '15m')}
          >
            <option value="5m">5m</option>
            <option value="15m">15m</option>
          </select>
        </label>

        <label>
          Entry price *
          <input
            type="number"
            step="0.05"
            required
            value={form.entry_price}
            onChange={(e) => setField('entry_price', e.target.value)}
          />
        </label>

        <label>
          Stop loss
          <input
            type="number"
            step="0.05"
            value={form.stop_loss}
            onChange={(e) => setField('stop_loss', e.target.value)}
            placeholder={form.side === 'long' ? 'Below entry' : 'Above entry'}
          />
        </label>

        <label>
          Target T1 (1R)
          <input
            type="number"
            step="0.05"
            value={form.target_t1}
            onChange={(e) => setField('target_t1', e.target.value)}
          />
        </label>

        <label>
          Target T2 (2R)
          <input
            type="number"
            step="0.05"
            value={form.target_t2}
            onChange={(e) => setField('target_t2', e.target.value)}
          />
        </label>

        <label>
          Target T3 (3R)
          <input
            type="number"
            step="0.05"
            value={form.target_t3}
            onChange={(e) => setField('target_t3', e.target.value)}
          />
        </label>

        <label>
          Quantity
          <input
            type="number"
            min={1}
            step={1}
            value={form.quantity}
            onChange={(e) => setField('quantity', e.target.value)}
            placeholder={form.product_type === 'futures' ? 'e.g. 75 = 1 Nifty lot' : 'Shares'}
          />
        </label>

        <label className="nip-log-notes">
          Notes
          <input
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            maxLength={500}
            placeholder="Setup, trigger, rationale…"
          />
        </label>

        <div className="nip-log-submit">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Log position'}
          </button>
        </div>
      </form>

      {preview ? (
        <div className="nip-log-preview">
          {preview.riskPct != null ? <span>Risk/share {preview.riskPct}%</span> : null}
          {preview.rr != null ? <span>T1 R:R {preview.rr}R</span> : null}
          {preview.notional != null ? (
            <span>Notional ₹{preview.notional.toLocaleString('en-IN')}</span>
          ) : null}
          {preview.riskInr != null ? (
            <span>Risk ₹{preview.riskInr.toLocaleString('en-IN')}</span>
          ) : null}
          <span className="muted">Time stop 14:30 IST</span>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Prefill from <Link to="/intraday">intraday radar</Link>, or use Fill from radar / Auto 1R/2R/3R.
        </p>
      )}
    </section>
  );
}
