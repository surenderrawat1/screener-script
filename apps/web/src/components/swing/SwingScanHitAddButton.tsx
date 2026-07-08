import { useState } from 'react';
import { api } from '../../api';

interface Props {
  symbol: string;
  price: number;
  asOfDate?: string | null;
  stopLoss?: number | null;
  profitTarget?: number | null;
  verdict: string;
  rulesPassed: number;
}

export function SwingScanHitAddButton({
  symbol,
  price,
  asOfDate,
  stopLoss,
  profitTarget,
  verdict,
  rulesPassed,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function handleAdd() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api('/api/v1/swing/positions', {
        method: 'POST',
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          entry_price: price,
          entry_date: asOfDate ?? new Date().toISOString().slice(0, 10),
          stop_loss: stopLoss ?? undefined,
          profit_target: profitTarget ?? undefined,
          notes: `${verdict} ${rulesPassed}/11`,
          source: 'scanner',
        }),
      });
      setMsg('Added');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="swing-hit-add">
      <button
        type="button"
        className="btn btn-secondary btn-xs"
        disabled={busy || price <= 0}
        title="Add to positions tracker"
        onClick={() => void handleAdd()}
      >
        {busy ? '…' : '+ Add'}
      </button>
      {msg ? <span className="swing-hit-add-ok">{msg}</span> : null}
      {err ? <span className="swing-hit-add-err">{err}</span> : null}
    </span>
  );
}
