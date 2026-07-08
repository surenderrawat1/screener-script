import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader, PageLoading } from '../components/PageLayout';
import {
  IntradayDecisionCockpit,
  IntradayFnoPanel,
  IntradayLedgerLink,
  IntradayPresetTable,
  IntradayTradePlanCard,
  type ProductMode,
} from '../components/intraday/IntradayFnoPanels';
import { IntradayPriceChart } from '../components/intraday/IntradayPriceChart';

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

  function selectInterval(tf: Interval) {
    setInterval(tf);
    const next = new URLSearchParams(searchParams);
    next.set('interval', tf);
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
  const sessionPresetId =
    presetId === 'intraday_session' || presetId === 'intraday' || presetId === 'scalp'
      ? interval === '5m'
        ? 'trend_scalp_5m'
        : 'cfa_precision'
      : null;
  const activePresetHighlight = sessionPresetId ?? recommendedPreset;
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
                  onClick={() => selectInterval(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link to="/intraday/backtest" className="btn btn-secondary">
              60d backtest
            </Link>
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
          {sessionPresetId ? (
            <>
              {' '}
              · highlighting <strong>{sessionPresetId.replace(/_/g, ' ')}</strong>
            </>
          ) : null}
          {' · '}
          <Link to="/presets">All presets</Link>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <IntradayDecisionCockpit
        playbook={playbook}
        analysis={analysis}
        mtf={mtf}
        plan={plan}
        presets={presetEval}
        recommended={activePresetHighlight}
        interval={interval}
        productMode={productMode}
        onProductModeChange={setProductMode}
        kind={instrumentKind}
        fnoSupported={fnoSupported}
      />
      {expiry?.label ? (
        <p className={`intraday-expiry-note ${expiry.is_today ? 'is-today' : ''}`}>Expiry {String(expiry.label)}</p>
      ) : null}

      <IntradayPriceChart instrumentId={instrument} interval={interval} label={indexLabel} plan={plan} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>{productMode === 'spot' ? 'Spot trade plan' : `${productMode} plan`}</h2>
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
          Recommended: <strong>{activePresetHighlight.replace(/_/g, ' ')}</strong> — gates before taking spot or F&O trades.
        </p>
        <IntradayPresetTable presets={presetEval} activeInterval={interval} recommended={activePresetHighlight} />
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
