import { useEffect, useState } from 'react';
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
}

function toneClass(tone: string): string {
  if (tone === 'success') return 'tp-card-success';
  if (tone === 'warning') return 'tp-card-warning';
  if (tone === 'danger') return 'tp-card-danger';
  return '';
}

export default function PresetsPage() {
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get('preset') ?? '';
  const [presets, setPresets] = useState<TradingPreset[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ presets: TradingPreset[] }>('/api/v1/trading/presets')
      .then((data) => setPresets(data.presets))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load presets'));
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
              className={`card tp-card ${toneClass(preset.tone)}${isActive ? ' tp-card-active' : ''}`}
            >
              <div className="tp-head">
                <span className="tp-icon" aria-hidden>
                  {preset.icon}
                </span>
                <div>
                  <h2>{preset.label}</h2>
                  <div className="tp-horizon">{preset.horizon}</div>
                </div>
              </div>
              <p className="tp-desc">{preset.description}</p>
              <ul className="tp-rules">
                {preset.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <div className="tp-actions">
                {preset.links.map((link) => (
                  <Link
                    key={link.href + link.label}
                    to={link.href}
                    className={link.primary ? 'tp-link tp-link-primary' : 'tp-link'}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </Page>
  );
}
