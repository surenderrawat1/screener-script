import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader, PageLoading } from '../components/PageLayout';
import {
  IntradayFnoPanel,
  IntradayLedgerLink,
  IntradayPresetTable,
  IntradayProductTabs,
  IntradayTradePlanCard,
  type ProductMode,
} from '../components/intraday/IntradayFnoPanels';

type Interval = '5m' | '15m';

interface InstrumentTab {
  id: string;
  label: string;
  kind: 'index' | 'stock';
  fno_supported?: boolean;
}

const INDEX_TABS: InstrumentTab[] = [
  { id: 'nifty50', label: 'Nifty 50', kind: 'index', fno_supported: true },
  { id: 'banknifty', label: 'Bank Nifty', kind: 'index', fno_supported: true },
];

export default function IntradayPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const presetId = searchParams.get('preset');
  const initialInterval: Interval = searchParams.get('interval') === '5m' ? '5m' : '15m';
  const initialInstrument = searchParams.get('instrument') ?? searchParams.get('index') ?? 'nifty50';

  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [stockTabs, setStockTabs] = useState<InstrumentTab[]>([]);
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [instrument, setInstrument] = useState(initialInstrument);
  const [productMode, setProductMode] = useState<ProductMode>('spot');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<{ stocks: InstrumentTab[] }>('/api/v1/intraday/instruments')
      .then((data) => setStockTabs(data.stocks ?? []))
      .catch(() => setStockTabs([]));
  }, []);

  useEffect(() => {
    const next = searchParams.get('interval') === '5m' ? '5m' : searchParams.get('interval') === '15m' ? '15m' : null;
    if (next) setInterval(next);
    const inst = searchParams.get('instrument') ?? searchParams.get('index');
    if (inst) setInstrument(inst);
  }, [searchParams]);

  const load = useCallback(
    async (refresh = false) => {
      setError('');
      setLoading(true);
      try {
        const q = new URLSearchParams({ interval, instrument });
        if (refresh) q.set('refresh', '1');
        const data = await api<Record<string, unknown>>(`/api/v1/intraday/nifty/state?${q}`);
        setState(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    },
    [interval, instrument],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const allTabs = [...INDEX_TABS, ...stockTabs];
  const activeTab = allTabs.find((t) => t.id === instrument);
  const instrumentKind = (activeTab?.kind ?? (state?.instrument as Record<string, unknown> | undefined)?.kind ?? 'index') as
    | 'index'
    | 'stock';
  const fnoSupported = Boolean(state?.fno_supported ?? activeTab?.fno_supported);

  useEffect(() => {
    if (!fnoSupported && productMode !== 'spot') setProductMode('spot');
  }, [fnoSupported, productMode]);

  function selectInstrument(id: string) {
    setInstrument(id);
    const next = new URLSearchParams(searchParams);
    next.set('instrument', id);
    setSearchParams(next);
  }

  if (loading && !state) return <PageLoading label="Loading intraday playbook…" />;
  if (error && !state) {
    return (
      <Page>
        <p className="error">{error}</p>
      </Page>
    );
  }
  if (!state) return null;

  const playbook = state.playbook as Record<string, unknown>;
  const steps = (playbook.steps as Array<Record<string, unknown>>) ?? [];
  const analysis = state.analysis as Record<string, unknown> | undefined;
  const mtf = state.mtf as Record<string, unknown> | undefined;
  const plan = state.plan as Record<string, unknown> | null | undefined;
  const fno = state.fno as Record<string, unknown> | null | undefined;
  const presetEval = (state.preset_eval as Array<Record<string, unknown>>) ?? [];
  const recommendedPreset = String(state.recommended_preset ?? 'cfa_precision');
  const indexLabel = String(state.index_label ?? 'Nifty 50');
  const expiry = fno?.expiry as Record<string, unknown> | undefined;
  const pageTitle = instrumentKind === 'stock' ? `${indexLabel} Intraday` : 'Index Intraday';
  const pageSubtitle =
    instrumentKind === 'stock'
      ? fnoSupported
        ? `${indexLabel} · equity, futures & options playbook`
        : `${indexLabel} · equity intraday (spot only)`
      : `${indexLabel} · spot, futures & options playbook`;

  return (
    <Page>
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          <>
            <div className="segmented">
              {(['5m', '15m'] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  className={interval === tf ? 'btn' : 'btn btn-secondary'}
                  onClick={() => setInterval(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      <div className="intraday-instrument-pickers">
        <div className="intraday-picker-group">
          <span className="intraday-picker-label">Indices</span>
          <div className="intraday-idx-tabs">
            {INDEX_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={instrument === tab.id ? 'intraday-idx-tab active' : 'intraday-idx-tab'}
                onClick={() => selectInstrument(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {stockTabs.length > 0 && (
          <div className="intraday-picker-group">
            <span className="intraday-picker-label">Stocks</span>
            <div className="intraday-idx-tabs intraday-stock-tabs">
              {stockTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={instrument === tab.id ? 'intraday-idx-tab active' : 'intraday-idx-tab'}
                  onClick={() => selectInstrument(tab.id)}
                  title={tab.fno_supported ? 'Spot + F&O' : 'Spot only'}
                >
                  {tab.label}
                  {tab.fno_supported ? <span className="intraday-fno-dot" aria-hidden> ◆</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="disclaimer">
        Intraday signals for education — F&O premiums and margins are estimates, not live chain data. Confirm on NSE/broker
        before orders.
      </p>
      {presetId && (
        <p className="muted">
          Preset: <strong>{presetId.replace(/_/g, ' ')}</strong>
          {' · '}
          <Link to="/presets">All presets</Link>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <section className="card intraday-hero">
        <div className="intraday-kpi-pills">
          <span className={`intraday-pill ${playbook.actionable ? 'pill-live' : 'pill-wait'}`}>
            {playbook.actionable ? '● Actionable' : '○ Wait'}
          </span>
          <span className="intraday-pill">Bias {String(playbook.bias_label ?? '—')}</span>
          <span className="intraday-pill">
            LTP {playbook.current_price != null ? `₹${Number(playbook.current_price).toFixed(2)}` : '—'}
          </span>
          <span className="intraday-pill">MTF {String(mtf?.title ?? mtf?.key ?? '—')}</span>
          <span className="intraday-pill">Deploy {Number(mtf?.deploy_pct ?? 0)}%</span>
          {expiry?.label ? (
            <span className={`intraday-pill ${expiry.is_today ? 'pill-expiry' : ''}`}>
              Expiry {String(expiry.label)}
            </span>
          ) : null}
        </div>
        <h2 style={{ margin: '0.75rem 0 0.35rem' }}>{String(playbook.headline ?? '—')}</h2>
        <p className="muted">
          Direction {String(analysis?.direction ?? '—')} · confidence {String(analysis?.confidence ?? '—')}% ·{' '}
          {String(mtf?.message ?? '')}
        </p>
      </section>

      <section className="card">
        <IntradayProductTabs
          mode={productMode}
          onChange={setProductMode}
          kind={instrumentKind}
          fnoSupported={fnoSupported}
        />
        {productMode === 'spot' ? (
          <>
            <IntradayTradePlanCard plan={plan} />
            <IntradayLedgerLink instrumentId={instrument} plan={plan} product="spot" />
          </>
        ) : (
          <>
            <IntradayFnoPanel fno={fno} mode={productMode} />
            <IntradayLedgerLink instrumentId={instrument} plan={plan} product={productMode} />
            {((fno?.risk_notes as string[]) ?? []).length > 0 && (
              <ul className="intraday-risk-notes">
                {((fno?.risk_notes as string[]) ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Entry presets ({interval})</h2>
        <p className="muted">
          Recommended: <strong>{recommendedPreset.replace(/_/g, ' ')}</strong> — gates before taking spot or F&O trades.
        </p>
        <IntradayPresetTable presets={presetEval} activeInterval={interval} recommended={recommendedPreset} />
      </section>

      <section className="card">
        <h2>Playbook steps</h2>
        {steps.length === 0 ? (
          <p className="muted">No steps available for current session.</p>
        ) : (
          <ol className="intraday-steps">
            {steps.map((s) => (
              <li key={String(s.step)} className={`intraday-step intraday-step-${String(s.status ?? 'info')}`}>
                <strong>{String(s.title)}</strong> — {String(s.instruction)}
                {s.price != null ? (
                  <span className="intraday-step-price"> @ ₹{Number(s.price).toFixed(2)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Page>
  );
}
