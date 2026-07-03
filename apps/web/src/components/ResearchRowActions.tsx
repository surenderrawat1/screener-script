import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export interface SwingPositionSeed {
  symbol: string;
  price: number;
  stop_loss?: number | null;
  profit_target?: number | null;
}

export function ResearchRowActions({
  symbol,
  source,
  sourceLabel,
  swing,
  onMessage,
}: {
  symbol: string;
  source?: string;
  sourceLabel?: string;
  swing?: SwingPositionSeed | null;
  onMessage?: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<'watchlist' | 'position' | null>(null);

  async function addWatchlist() {
    setBusy('watchlist');
    try {
      await api('/api/v1/watchlist/items', {
        method: 'PUT',
        body: JSON.stringify({
          symbol,
          notes: sourceLabel ? `From ${sourceLabel}` : undefined,
          meta: source ? { source, added_from: source } : undefined,
        }),
      });
      onMessage?.(`Added ${symbol} to watchlist.`);
    } catch (err) {
      onMessage?.(err instanceof Error ? err.message : 'Watchlist failed');
    } finally {
      setBusy(null);
    }
  }

  async function addSwingPosition() {
    if (!swing?.price) return;
    if (!window.confirm(`Add ${symbol} to swing positions at ₹${swing.price}?`)) return;
    setBusy('position');
    try {
      await api('/api/v1/swing/positions', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          entry_price: swing.price,
          entry_date: new Date().toISOString().slice(0, 10),
          stop_loss: swing.stop_loss ?? undefined,
          profit_target: swing.profit_target ?? undefined,
          source: source ?? 'strategy',
          notes: sourceLabel,
        }),
      });
      onMessage?.(`Added ${symbol} to swing positions.`);
    } catch (err) {
      onMessage?.(err instanceof Error ? err.message : 'Add position failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="research-row-actions">
      <Link to={`/verify?symbol=${encodeURIComponent(symbol)}`} className="btn btn-secondary btn-sm">
        Verify
      </Link>
      <Link to={`/verify/full?symbol=${encodeURIComponent(symbol)}`} className="btn btn-secondary btn-sm">
        Full
      </Link>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy !== null}
        onClick={() => void addWatchlist()}
      >
        {busy === 'watchlist' ? '…' : 'Watchlist'}
      </button>
      {swing?.price ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy !== null}
          onClick={() => void addSwingPosition()}
        >
          {busy === 'position' ? '…' : 'Add swing'}
        </button>
      ) : null}
    </div>
  );
}
