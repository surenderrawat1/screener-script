import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useVerifyLang } from '../i18n/useVerifyLang';
import { validateThesisInput } from '../lib/validateThesis';
import { Page, PageHeader } from '../components/PageLayout';
import AutoBadge from '../components/verify-full/AutoBadge';
import PhaseNav from '../components/verify-full/PhaseNav';
import PhasePanel from '../components/verify-full/PhasePanel';
import VerifyFullResults, {
  type VerifyFullResultData,
} from '../components/verify-full/VerifyFullResults';

interface PhaseDef {
  id: number;
  title: string;
  shortTitle: string;
  description: string;
  manualNote?: string;
  fields: {
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'yesno' | 'checkbox';
    section?: string;
    required?: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
    sectorPanel?: string;
    manualOnly?: boolean;
    hidden?: boolean;
    showWhen?: { field: string; equals: string | boolean };
  }[];
}

interface PrefillResponse {
  symbol: string;
  input: Record<string, string | number | boolean>;
  auto_keys: string[];
  phases: PhaseDef[];
  sectors: { value: string; label: string }[];
}

interface FetchMeta {
  count: number;
  name: string;
  symbol: string;
  sources: string[];
  from_cache?: boolean;
  cached_until?: string;
}

interface FetchResponse extends PrefillResponse {
  success: boolean;
  sources: string[];
  from_cache?: boolean;
  fetch_meta: FetchMeta;
}

interface RunResponse {
  success: boolean;
  symbol: string;
  result: VerifyFullResultData;
  run_id?: string;
  watchlist_saved?: boolean;
}

const DRAFT_KEY = 'sv:verify-full:draft';

function manualOverridesForFetch(
  input: Record<string, string | number | boolean>,
  autoKeys: Set<string>,
): Record<string, string | number | boolean> | undefined {
  if (autoKeys.size === 0) return undefined;
  const manual: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!autoKeys.has(key)) manual[key] = value;
  }
  return Object.keys(manual).length > 0 ? manual : undefined;
}

export default function VerifyFullPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang, setLang, t } = useVerifyLang();
  const initialSymbol =
    searchParams.get('symbol') ??
    (location.state as { symbol?: string } | null)?.symbol ??
    'TCS';

  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [prefill, setPrefill] = useState<PrefillResponse | null>(null);
  const [input, setInput] = useState<Record<string, string | number | boolean>>({});
  const [autoKeys, setAutoKeys] = useState<Set<string>>(new Set());
  const [activePhase, setActivePhase] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchMeta, setFetchMeta] = useState<FetchMeta | null>(null);
  const [runResult, setRunResult] = useState<VerifyFullResultData | null>(null);
  const [watchlistSaved, setWatchlistSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const skipUrlPrefillRef = useRef(false);
  const autoFetchDoneRef = useRef(false);
  const fromVerify =
    searchParams.get('from') === 'verify' || searchParams.get('autofill') === '1';

  function updateSymbolParam(sym: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('symbol', sym);
        return next;
      },
      { replace: true },
    );
  }

  const loadPrefill = useCallback(async (sym: string) => {
    setLoading(true);
    setError('');
    try {
      const q = sym.trim() ? `?symbol=${encodeURIComponent(sym.trim())}` : '';
      const res = await api<PrefillResponse>(`/api/v1/verify/full/prefill${q}`);
      setPrefill(res);
      setInput(res.input);
      setAutoKeys(new Set(res.auto_keys));
      setSymbol(res.symbol || sym.toUpperCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load form');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skipUrlPrefillRef.current) {
      skipUrlPrefillRef.current = false;
      return;
    }
    void loadPrefill(initialSymbol);
  }, [initialSymbol, loadPrefill]);

  const phases = useMemo(() => {
    const raw = prefill?.phases ?? [];
    return raw.map((p) => ({
      ...p,
      title: t(`phase.${p.id}.title`, p.title),
      shortTitle: t(`phase.${p.id}.short`, p.shortTitle),
    }));
  }, [prefill?.phases, t]);
  const sector = String(input.sector ?? 'general');

  const epsLabels = useMemo(
    () => ({
      basis: t('eps.basis', 'EPS basis (annual report)'),
      consolidated: t('eps.consolidated', 'Consolidated'),
      standalone: t('eps.standalone', 'Standalone'),
      hint: t('eps.hint', 'Valuation recalculates on verify.'),
    }),
    [t],
  );

  const phaseNav = useMemo(
    () => phases.map((p) => ({ id: p.id, shortTitle: p.shortTitle })),
    [phases],
  );

  function onFieldChange(key: string, value: string | boolean) {
    setInput((prev) => ({ ...prev, [key]: value }));
    setAutoKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function onLoadSymbol() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    skipUrlPrefillRef.current = true;
    updateSymbolParam(sym);
    void loadPrefill(sym);
  }

  async function onFetchFill(refresh = false) {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setFetching(true);
    setError('');
    setFetchMeta(null);
    skipUrlPrefillRef.current = true;
    updateSymbolParam(sym);
    try {
      const manual = manualOverridesForFetch(input, autoKeys);
      const res = await api<FetchResponse>('/api/v1/verify/full/fetch', {
        method: 'POST',
        body: JSON.stringify({
          symbol: sym,
          refresh,
          ...(manual ? { manual } : {}),
        }),
      });
      setPrefill({
        symbol: res.symbol,
        input: res.input,
        auto_keys: res.auto_keys,
        phases: res.phases ?? [],
        sectors: res.sectors ?? prefill?.sectors ?? [],
      });
      setInput(res.input);
      setAutoKeys(new Set(res.auto_keys));
      setFetchMeta(res.fetch_meta);
      setSymbol(res.symbol);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
      setFetchMeta(null);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    autoFetchDoneRef.current = false;
  }, [initialSymbol]);

  useEffect(() => {
    if (!fromVerify || autoFetchDoneRef.current || loading || fetching) return;
    if (!symbol.trim()) return;
    autoFetchDoneRef.current = true;
    void onFetchFill(false);
  }, [fromVerify, loading, fetching, symbol]);

  const thesisValidation = useMemo(() => validateThesisInput(input), [input]);

  const attestationRequired = thesisValidation.errors.some((e) => e.includes('attestation'));

  async function onRunVerification() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setRunning(true);
    setError('');
    setRunResult(null);
    setWatchlistSaved(false);
    try {
      const res = await api<RunResponse>('/api/v1/verify/full/run', {
        method: 'POST',
        body: JSON.stringify({ symbol: sym, input }),
      });
      setRunResult(res.result);
      setSymbol(res.symbol);
      setWatchlistSaved(Boolean(res.watchlist_saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setRunning(false);
    }
  }

  function onNext() {
    setActivePhase((p) => Math.min(p + 1, 8));
  }

  function onBack() {
    setActivePhase((p) => Math.max(p - 1, 0));
  }

  async function saveDraft() {
    if (!symbol) return;
    const draft = {
      symbol,
      input,
      auto_keys: [...autoKeys],
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${DRAFT_KEY}:${symbol}`, JSON.stringify(draft));
    try {
      await api('/api/v1/verify/full/draft', {
        method: 'PUT',
        body: JSON.stringify({ symbol, input, auto_keys: [...autoKeys] }),
      });
    } catch {
      /* local draft still saved */
    }
  }

  async function loadDraft() {
    const sym = symbol.trim().toUpperCase();
    try {
      const res = await api<{
        draft: {
          input: Record<string, string | number | boolean>;
          auto_keys?: string[];
        } | null;
      }>(`/api/v1/verify/full/draft?symbol=${encodeURIComponent(sym)}`);
      if (res.draft?.input) {
        setInput((prev) => ({ ...prev, ...res.draft!.input }));
        if (res.draft.auto_keys) setAutoKeys(new Set(res.draft.auto_keys));
        return;
      }
    } catch {
      /* fall through to localStorage */
    }
    const raw = localStorage.getItem(`${DRAFT_KEY}:${sym}`);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        input: Record<string, string | number | boolean>;
        auto_keys?: string[];
      };
      setInput((prev) => ({ ...prev, ...draft.input }));
      if (draft.auto_keys) setAutoKeys(new Set(draft.auto_keys));
    } catch {
      /* ignore corrupt draft */
    }
  }

  const activePhaseDef = phases.find((p) => p.id === activePhase);

  return (
    <Page>
      <div className="verify-page-header">
        <PageHeader
          title={t('page.title', 'Full Verify')}
          subtitle={t(
            'page.subtitle',
            '8-phase allocation gate — manual attestation required before investing',
          )}
        />
        <button
          type="button"
          className="btn btn-secondary lang-switch-btn"
          onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
        >
          {lang === 'hi' ? t('lang.switch_en', 'English') : t('lang.switch', 'हिंदी')}
        </button>
      </div>

      {lang === 'hi' ? <p className="muted verify-lang-partial">{t('lang.partial', '')}</p> : null}

      <nav className="analyst-strip" aria-label="Analyst workflow">
        <span>Workflow:</span>
        <Link to="/screener">Screener</Link>
        <Link to="/verify">CFA Verify</Link>
        <Link to={`/stock/${encodeURIComponent(symbol || 'TCS')}`}>Stock Details</Link>
        <Link to="/watchlist">Watchlist</Link>
      </nav>

      <p className="disclaimer">
        {t(
          'page.disclaimer',
          'Educational tool only — not SEBI-registered investment advice. Screening auto-verify is not a substitute for Full Verify.',
        )}
      </p>

      {error && <p className="error">{error}</p>}

      {watchlistSaved && (
        <div className="verify-fetch-success">
          Thesis and review date saved to{' '}
          <Link to="/watchlist">
            <strong>Watchlist</strong>
          </Link>
          .
        </div>
      )}

      {fetchMeta && (
        <div className="verify-fetch-success">
          Auto-filled <strong>{fetchMeta.count}</strong> fields for{' '}
          <strong>{fetchMeta.name}</strong> ({fetchMeta.symbol})
          {fetchMeta.from_cache ? (
            <>
              {' '}
              from <strong>cache</strong>
              {fetchMeta.cached_until ? ` (until ${fetchMeta.cached_until})` : ''}.
            </>
          ) : (
            <> from {fetchMeta.sources.join(', ')}.</>
          )}{' '}
          Review <AutoBadge /> tags and complete manual gates below.
        </div>
      )}

      <div className="verify-full-layout">
        <section className="verify-full-main card">
          <h2>{t('page.checklist', 'Verification Checklist')}</h2>

          <div className="verify-fetch-bar">
            <h4>{t('fetch.title', 'Auto mode — fetch & fill gates')}</h4>
            <div className="verify-fetch-row">
              <label className="verify-field verify-symbol-field">
                <span className="verify-field-label">{t('fetch.symbol', 'NSE/BSE symbol')}</span>
                <input
                  type="text"
                  value={symbol}
                  placeholder="e.g. TCS, RELIANCE"
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && onLoadSymbol()}
                />
              </label>
              <button type="button" className="btn" disabled={loading} onClick={onLoadSymbol}>
                {t('btn.load', 'Load form')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={fetching || !symbol.trim()}
                onClick={() => void onFetchFill(false)}
              >
                {fetching ? '…' : t('btn.fetch', 'Fetch & Fill')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={fetching || !symbol.trim()}
                onClick={() => void onFetchFill(true)}
                title="Bypass cache"
              >
                {t('btn.refresh', 'Refresh')}
              </button>
              <Link
                className="btn btn-secondary"
                to={`/verify?symbol=${encodeURIComponent(symbol)}`}
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                CFA Verify →
              </Link>
            </div>
            <p className="verify-legend muted">
              <AutoBadge /> {t('fetch.legend', '= fetched value (editable). Phase 0, circle of competence, portfolio & exit gates = manual only.')}
            </p>
          </div>

          {loading ? (
            <p className="muted">Loading form…</p>
          ) : activePhaseDef ? (
            <>
              <PhaseNav phases={phaseNav} active={activePhase} onSelect={setActivePhase} />
              <PhasePanel
                phase={activePhaseDef}
                input={input}
                autoKeys={autoKeys}
                sector={sector}
                sectors={prefill?.sectors ?? []}
                thesisErrors={activePhase === 8 ? thesisValidation.errors : undefined}
                epsLabels={epsLabels}
                onChange={onFieldChange}
                onGoPhase0={() => setActivePhase(0)}
              />
              <div className="verify-nav-row">
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={activePhase === 0}
                    onClick={onBack}
                  >
                    {t('btn.back', '← Back')}
                  </button>
                  {activePhase < 8 ? (
                    <button type="button" className="btn" onClick={onNext}>
                      {t('btn.next', 'Next →')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={running || attestationRequired}
                      title={
                        attestationRequired
                          ? 'Check attestation on Phase 8 after reviewing auto-filled data'
                          : undefined
                      }
                      onClick={() => void onRunVerification()}
                    >
                      {running ? '…' : t('btn.run', 'Run verification')}
                    </button>
                  )}
                </div>
                <div className="verify-draft-actions">
                  <button type="button" className="btn btn-secondary" onClick={loadDraft}>
                    {t('btn.draft_load', 'Load draft')}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={saveDraft}>
                    {t('btn.draft_save', 'Save draft')}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </section>

        <VerifyFullResults
          result={runResult}
          running={running}
          labels={{
            title: t('results.title', 'Results'),
            score: t('results.score', 'Master score'),
            ready: t('results.ready', 'Investment ready'),
            verdict: t('results.verdict', 'Verdict'),
            pending: t('results.pending', 'Pending'),
          }}
        />
      </div>
    </Page>
  );
}
