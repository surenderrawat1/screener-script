import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader, PageLoading } from '../components/PageLayout';
import {
  EconomicGateBanner,
  pickEconomicGate,
  type EconomicGateBook,
} from '../components/research/EconomicGateBanner';
import {
  IntradayDecisionCockpit,
  IntradayFnoPanel,
  IntradayLedgerLink,
  IntradayPresetTable,
  IntradayScalpSetupCard,
  IntradaySignalsPanel,
  IntradayTradePlanCard,
  type ProductMode,
} from '../components/intraday/IntradayFnoPanels';
import { IntradayPriceChart } from '../components/intraday/IntradayPriceChart';
import {
  IntradayOpenPanel,
  type IntradayPositionRow,
} from '../components/intraday/IntradayPositionsPanels';

type Interval = '5m' | '15m';

interface PositionsPollResponse {
  positions: IntradayPositionRow[];
  live?: {
    refreshed_at?: string;
    portfolio?: {
      exit_count?: number;
      urgent_count?: number;
      net_pnl_inr?: number | null;
    };
  } | null;
}

interface InstrumentTab {
  id: string;
  label: string;
  kind: 'index' | 'stock';
  fno_supported?: boolean;
}

const INDEX_TABS: InstrumentTab[] = [
  { id: 'nifty50', label: 'Nifty 50', kind: 'index', fno_supported: true },
  { id: 'banknifty', label: 'Bank Nifty', kind: 'index', fno_supported: true },
  { id: 'sensex', label: 'Sensex', kind: 'index', fno_supported: true },
  { id: 'finnifty', label: 'Fin Nifty', kind: 'index', fno_supported: true },
];

export default function IntradayPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const presetId = searchParams.get('preset');
  const initialInterval: Interval = searchParams.get('interval') === '5m' ? '5m' : '15m';
  const initialInstrument = searchParams.get('instrument') ?? searchParams.get('index') ?? 'nifty50';

  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [indexTabs, setIndexTabs] = useState<InstrumentTab[]>(INDEX_TABS);
  const [stockTabs, setStockTabs] = useState<InstrumentTab[]>([]);
  const [etfTabs, setEtfTabs] = useState<InstrumentTab[]>([]);
  const [symbolDraft, setSymbolDraft] = useState(initialInstrument);
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [instrument, setInstrument] = useState(initialInstrument);
  const [productMode, setProductMode] = useState<ProductMode>('spot');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [econBooks, setEconBooks] = useState<EconomicGateBook[]>([]);
  const [positionsData, setPositionsData] = useState<PositionsPollResponse | null>(null);

  const REFRESH_MS = 60_000;

  useEffect(() => {
    void api<{ books: EconomicGateBook[] }>('/api/v1/trading/economic-gates')
      .then((r) => setEconBooks(r.books ?? []))
      .catch(() => setEconBooks([]));
  }, []);

  useEffect(() => {
    void api<{ stocks: InstrumentTab[]; indices: InstrumentTab[]; etfs?: InstrumentTab[] }>('/api/v1/intraday/instruments')
      .then((data) => {
        if (data.indices?.length) setIndexTabs(data.indices);
        setStockTabs(data.stocks ?? []);
        setEtfTabs(data.etfs ?? []);
      })
      .catch(() => {
        setStockTabs([]);
        setEtfTabs([]);
      });
  }, []);

  useEffect(() => {
    const next = searchParams.get('interval') === '5m' ? '5m' : searchParams.get('interval') === '15m' ? '15m' : null;
    if (next) setInterval(next);
    const inst = searchParams.get('symbol') ?? searchParams.get('instrument') ?? searchParams.get('index');
    if (inst) {
      setInstrument(inst);
      setSymbolDraft(inst);
    }
  }, [searchParams]);

  const load = useCallback(
    async (refresh = false) => {
      setError('');
      setLoading(true);
      try {
        const q = new URLSearchParams({ interval, instrument, positions: '0' });
        if (refresh) q.set('refresh', '1');
        const data = await api<Record<string, unknown>>(`/api/v1/intraday/nifty/state?${q}`);
        const resolved = data.instrument as { id?: string } | undefined;
        if (resolved?.id && resolved.id !== instrument) {
          setInstrument(resolved.id);
          setSymbolDraft(resolved.id);
        }
        setState(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    },
    [interval, instrument],
  );

  const loadPositions = useCallback(async () => {
    try {
      const data = await api<PositionsPollResponse>('/api/v1/intraday/positions?status=open&live=1');
      setPositionsData(data);
    } catch {
      /* positions poll is best-effort */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(false), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    void loadPositions();
    const id = window.setInterval(() => void loadPositions(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadPositions]);

  const allTabs = [...indexTabs, ...stockTabs, ...etfTabs];
  const activeTab = allTabs.find((t) => t.id === instrument);
  const resolvedKind = (state?.instrument as Record<string, unknown> | undefined)?.kind;
  const instrumentKind = (activeTab?.kind
    ?? (resolvedKind === 'stock' || resolvedKind === 'index' ? resolvedKind : null)
    ?? (String(instrument).startsWith('^') || INDEX_TABS.some((t) => t.id === instrument.toLowerCase())
      ? 'index'
      : 'stock')) as 'index' | 'stock';
  const fnoSupported = Boolean(state?.fno_supported ?? activeTab?.fno_supported);

  useEffect(() => {
    if (!fnoSupported && productMode !== 'spot') setProductMode('spot');
  }, [fnoSupported, productMode]);

  function selectInstrument(id: string) {
    const nextId = id.trim();
    if (!nextId) return;
    setInstrument(nextId);
    setSymbolDraft(nextId);
    const next = new URLSearchParams(searchParams);
    next.set('instrument', nextId);
    next.delete('index');
    next.delete('symbol');
    setSearchParams(next);
  }

  function submitSymbol(event: FormEvent) {
    event.preventDefault();
    selectInstrument(symbolDraft);
  }

  function selectInterval(tf: Interval) {
    setInterval(tf);
    const next = new URLSearchParams(searchParams);
    next.set('interval', tf);
    setSearchParams(next);
  }

  if (loading && !state) return <PageLoading label="Loading intraday playbook…" />;

  const playbook = (state?.playbook as Record<string, unknown> | undefined) ?? {};
  const steps = (playbook.steps as Array<Record<string, unknown>>) ?? [];
  const analysis = state?.analysis as Record<string, unknown> | undefined;
  const mtf = state?.mtf as Record<string, unknown> | undefined;
  const plan = state?.plan as Record<string, unknown> | null | undefined;
  const fno = state?.fno as Record<string, unknown> | null | undefined;
  const presetEval = (state?.preset_eval as Array<Record<string, unknown>>) ?? [];
  const accuracyGate = state?.accuracy_gate as Record<string, unknown> | undefined;
  const recommendedPreset = String(state?.recommended_preset ?? 'cfa_precision');
  const sessionPresetId =
    presetId === 'ma20_stratzy' ||
    presetId === 'stratzy' ||
    presetId === 'startazy' ||
    presetId === 'startzy' ||
    presetId === 'ma20' ||
    presetId === '20ma' ||
    presetId === 'sma20'
      ? 'ma20_stratzy'
      : presetId === 'intraday_session' || presetId === 'intraday' || presetId === 'scalp'
        ? interval === '5m'
          ? 'trend_scalp_5m'
          : 'cfa_precision'
        : null;
  const activePresetHighlight = sessionPresetId ?? recommendedPreset;
  const indexLabel = String(state?.index_label ?? instrument.toUpperCase() ?? 'Nifty 50');
  const stratzyGate =
    interval === '15m' && (instrument === 'nifty50' || instrument === 'banknifty')
      ? pickEconomicGate(econBooks, {
          book: 'intraday_stratzy',
          instrument_id: instrument,
        })
      : undefined;
  const expiry = fno?.expiry as Record<string, unknown> | undefined;
  const scalpSetup = state?.scalp_setup as Record<string, unknown> | undefined;
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

      {stratzyGate ? (
        <EconomicGateBanner
          gate={stratzyGate}
          backtestHref={`/intraday/backtest?instrument=${instrument}&interval=15m&autorun=1`}
        />
      ) : null}

      <div className="intraday-instrument-pickers">
        <form className="intraday-symbol-form" onSubmit={submitSymbol}>
          <label className="intraday-picker-label" htmlFor="intraday-symbol-input">
            Any stock / ETF / index
          </label>
          <div className="intraday-symbol-row">
            <input
              id="intraday-symbol-input"
              className="intraday-symbol-input"
              value={symbolDraft}
              onChange={(e) => setSymbolDraft(e.target.value)}
              placeholder="TCS, NIFTYBEES, SUNPHARMA, INFY.BO, ^NSEI"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn">
              Load
            </button>
          </div>
        </form>
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
        {etfTabs.length > 0 && (
          <div className="intraday-picker-group">
            <span className="intraday-picker-label">ETFs</span>
            <div className="intraday-idx-tabs intraday-stock-tabs">
              {etfTabs.map((tab) => (
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
        )}
        {!allTabs.some((tab) => tab.id === instrument) && instrument ? (
          <p className="muted">
            Custom: <strong>{indexLabel}</strong> ({instrument.toUpperCase()}) · spot playbook
          </p>
        ) : null}
      </div>

      <p className="muted">
        Mobile shell: <Link to={`/intraday/app?instrument=${encodeURIComponent(instrument)}&interval=${interval}`}>Intraday App</Link>
        {' · '}
        <Link to="/intraday/positions">Positions ledger</Link>
      </p>
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
      {accuracyGate ? (
        <p className={accuracyGate.accuracy_pass ? 'success' : 'disclaimer'}>
          60d accuracy gate for <strong>{String(accuracyGate.label ?? recommendedPreset)}</strong>:{' '}
          <strong>
            {accuracyGate.win_rate_pct != null ? `${String(accuracyGate.win_rate_pct)}%` : 'unavailable'}
          </strong>{' '}
          across {String(accuracyGate.trades ?? 0)} trades · required{' '}
          <strong>&gt;{String(accuracyGate.accuracy_floor_pct ?? 70)}%</strong> with at least{' '}
          {String(accuracyGate.min_trades_required ?? 10)} trades ·{' '}
          <strong>{accuracyGate.accuracy_pass ? 'LIVE ELIGIBLE' : 'BLOCKED'}</strong>
        </p>
      ) : null}

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
        econStatus={stratzyGate?.status}
      />
      <IntradaySignalsPanel
        analysis={analysis}
        interval={interval}
        trigger={(plan?.trigger as Record<string, unknown> | undefined) ?? undefined}
      />
      <IntradayScalpSetupCard setup={scalpSetup} instrumentId={instrument} interval={interval} />

      <IntradayOpenPanel
        heading={
          <div className="nip-panel-head">
            <h2 style={{ margin: 0 }}>Open positions</h2>
            <span className="muted">Live · 60s</span>
          </div>
        }
        footer={
          <p className="muted nip-panel-foot">
            <Link to="/intraday/positions">Full ledger</Link>
            {' · '}
            <Link to={`/intraday/app?instrument=${encodeURIComponent(instrument)}&interval=${interval}`}>
              Mobile app
            </Link>
          </p>
        }
        positions={positionsData?.positions ?? []}
        portfolio={positionsData?.live?.portfolio}
        refreshedAt={positionsData?.live?.refreshed_at}
        onRefresh={loadPositions}
        onClosed={loadPositions}
      />

      {expiry?.label ? (
        <p className={`intraday-expiry-note ${expiry.is_today ? 'is-today' : ''}`}>
          {expiry.is_today ? 'Expiry today · ' : 'Next expiry · '}
          {expiry.weekday ? `${String(expiry.weekday)} ` : ''}
          {String(expiry.label)}
          {expiry.schedule ? ` · ${String(expiry.schedule)}` : ''}
          {expiry.holiday_shifted ? ' · holiday-adjusted' : ''}
          {fno?.monthly_expiry &&
          typeof fno.monthly_expiry === 'object' &&
          String((fno.monthly_expiry as Record<string, unknown>).date ?? '') !== String(expiry.date ?? '')
            ? ` · monthly ${String((fno.monthly_expiry as Record<string, unknown>).label ?? '')}`
            : ''}
        </p>
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
