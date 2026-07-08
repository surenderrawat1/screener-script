import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import { fmtMoney, fmtNum } from './format';
import { SwingEntryRulesTable, type SwingRuleRow } from './SwingEntryRulesTable';
import type { SwingEntryPayload } from './types';

interface ExitResult {
  ok: boolean;
  price?: number;
  as_of_date?: string | null;
  exit?: {
    verdict?: string;
    gain_pct?: number;
    sessions_held?: number;
    active_stop?: number;
    profit_target?: number;
    rules?: SwingRuleRow[];
    triggered?: string[];
  };
  error?: string;
}

interface Props {
  symbol: string;
  entry: SwingEntryPayload;
  asOfDate?: string | null;
}

export function SwingExitTestPanel({ symbol, entry, asOfDate }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExitResult | null>(null);
  const [form, setForm] = useState({
    entry_price: '',
    entry_date: '',
  });

  useEffect(() => {
    setForm({
      entry_price: entry.entry_price != null ? String(entry.entry_price) : '',
      entry_date: asOfDate ?? new Date().toISOString().slice(0, 10),
    });
    setResult(null);
    setError('');
  }, [symbol, entry.entry_price, asOfDate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<ExitResult>('/api/v1/swing/evaluate-exit', {
        method: 'POST',
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          entry_price: Number(form.entry_price),
          entry_date: form.entry_date,
          profit_target: entry.profit_target ?? undefined,
          target_pct: entry.target_pct ?? undefined,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Exit evaluation failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const exit = result?.exit;
  const verdictClass = exit?.verdict === 'EXIT' ? 'swing-verdict-avoid' : 'swing-verdict-enter';

  return (
    <section className="swing-exit-test swing-subsection" aria-label="Test exit rules">
      <h4 className="swing-exit-ref-title">Test exit rules</h4>
      <p className="swing-subsection-hint muted">
        Score X1–X9 against the current chart using your entry price and date. Target is frozen from the entry trade
        plan when available.
      </p>
      <form className="swing-exit-test-form" onSubmit={handleSubmit}>
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
        <button type="submit" className="btn btn-secondary" disabled={loading}>
          {loading ? 'Scoring…' : 'Score exit rules'}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {exit ? (
        <div className="swing-exit-test-result">
          <p className="swing-exit-test-verdict">
            <span className={`swing-verdict-pill ${verdictClass}`}>{exit.verdict ?? '—'}</span>
            {' · '}
            Mark {fmtMoney(result?.price)} vs entry {fmtMoney(form.entry_price)}
            {exit.gain_pct != null ? ` · gain ${fmtNum(exit.gain_pct, '%')}` : ''}
            {exit.sessions_held != null ? ` · ${exit.sessions_held} sessions` : ''}
          </p>
          <p className="muted swing-exit-test-stops">
            Active stop {fmtMoney(exit.active_stop)} · target {fmtMoney(exit.profit_target ?? entry.profit_target)}
            {exit.triggered?.length ? ` · triggered: ${exit.triggered.join(', ')}` : ''}
          </p>
          <SwingEntryRulesTable rules={exit.rules ?? []} />
        </div>
      ) : null}
    </section>
  );
}
