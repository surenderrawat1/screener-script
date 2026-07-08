import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface TradingPresetLink {
  href: string;
  label: string;
  primary?: boolean;
}

interface TradingPreset {
  id: string;
  label: string;
  icon: string;
  horizon: string;
  tone: string;
  description: string;
  rules: string[];
  links: TradingPresetLink[];
  ready: boolean;
  blocked_reason?: string;
}

interface NseSession {
  phase: string;
  label: string;
  message: string;
  live_quotes: boolean;
  ist_time: string;
  ist_date: string;
}

function toneClass(tone: string): string {
  if (tone === 'success') return 'tp-card-success';
  if (tone === 'warning') return 'tp-card-warning';
  if (tone === 'danger') return 'tp-card-danger';
  return '';
}

function sessionClass(phase: string): string {
  if (phase === 'open') return 'morning-session-open';
  if (phase === 'weekend' || phase === 'post') return 'morning-session-closed';
  return 'morning-session-pre';
}

function normalizePresetHighlight(raw: string, presets: TradingPreset[]): string {
  if (!raw) return '';
  const key = raw.toLowerCase().trim();
  const aliases: Record<string, string> = {
    conservative: 'conservative_swing',
    swing: 'conservative_swing',
    swing_conservative: 'conservative_swing',
    etf: 'etf_rotation',
    rotation: 'etf_rotation',
    intraday: 'intraday_session',
    scalp: 'intraday_session',
  };
  const id = aliases[key] ?? key;
  return presets.some((p) => p.id === id) ? id : '';
}

export default function PresetsPage() {
  const [searchParams] = useSearchParams();
  const [presets, setPresets] = useState<TradingPreset[]>([]);
  const [session, setSession] = useState<NseSession | null>(null);
  const [guideTips, setGuideTips] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    api<{ presets: TradingPreset[]; session: NseSession; guide_tips: string[] }>('/api/v1/trading/presets')
      .then((data) => {
        setPresets(data.presets);
        setSession(data.session);
        setGuideTips(data.guide_tips ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load presets'));
  }, []);

  const highlight = normalizePresetHighlight(searchParams.get('preset') ?? '', presets);

  const copyPresetLink = useCallback(async (preset: TradingPreset) => {
    const url = `${window.location.origin}/presets?preset=${encodeURIComponent(preset.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(preset.id);
      window.setTimeout(() => setCopiedId(''), 2000);
    } catch {
      setCopiedId('');
    }
  }, []);

  return (
    <Page>
      <PageHeader
        title="Trading Presets"
        subtitle="One-click profiles — conservative swing · ETF rotation · intraday session"
      />
      <p className="disclaimer">
        Bookmarkable deep links encode filter state. Presets are starting points, not orders — adjust on the
        target page before sizing.
      </p>

      {session && (
        <div className={`card morning-session ${sessionClass(session.phase)}`}>
          <div className="morning-session-row">
            <div>
              <strong>NSE · {session.label}</strong>
              <span className="muted" style={{ marginLeft: '0.75rem' }}>
                {session.ist_date} · {session.ist_time} IST
              </span>
            </div>
            {session.live_quotes && <span className="badge badge-buy">Live quotes</span>}
          </div>
          <p className="muted" style={{ margin: '0.5rem 0 0' }}>
            {session.message}
          </p>
        </div>
      )}

      {guideTips.length > 0 && (
        <div className="card tp-guide">
          <strong>Accuracy tips</strong>
          <ul>
            {guideTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="muted">
        Quick launch from <Link to="/morning">Morning Routine</Link> or pick a profile below.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="tp-grid">
        {presets.map((preset) => {
          const isActive = highlight !== '' && preset.id === highlight;
          return (
            <article
              key={preset.id}
              id={`preset-${preset.id}`}
              className={`card tp-card ${toneClass(preset.tone)}${isActive ? ' tp-card-active' : ''}${!preset.ready ? ' tp-card-blocked' : ''}`}
            >
              <div className="tp-head">
                <span className="tp-icon" aria-hidden>
                  {preset.icon}
                </span>
                <div className="tp-head-text">
                  <h2>{preset.label}</h2>
                  <div className="tp-horizon">{preset.horizon}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary tp-copy-btn"
                  title="Copy bookmark link"
                  onClick={() => void copyPresetLink(preset)}
                >
                  {copiedId === preset.id ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p className="tp-desc">{preset.description}</p>
              {!preset.ready && preset.blocked_reason ? (
                <p className="tp-blocked">{preset.blocked_reason}</p>
              ) : null}
              <ul className="tp-rules">
                {preset.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <div className="tp-actions">
                {preset.links.map((link) => {
                  const isPrimary = Boolean(link.primary);
                  const disabled = isPrimary && !preset.ready;
                  if (disabled) {
                    return (
                      <span
                        key={link.href + link.label}
                        className="tp-link tp-link-primary tp-link-disabled"
                        title={preset.blocked_reason ?? 'Not ready'}
                      >
                        {link.label}
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={link.href + link.label}
                      to={link.href}
                      className={isPrimary ? 'tp-link tp-link-primary' : 'tp-link'}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </Page>
  );
}
