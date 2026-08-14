import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';

const GTT_TIERS = [
  { key: 'high_conviction', label: 'High Conviction' },
  { key: 'strict_enter', label: 'Strict ENTER' },
] as const;

const EMAIL_FLAGS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'evening_gtt', label: 'Evening GTT digest', hint: 'Post-close GTT email' },
  { key: 'exit_alerts', label: 'Open-book EXIT alerts', hint: 'Scheduled + manual EXIT cards' },
  { key: 'swing_radar', label: 'HOT radar emails', hint: 'High Conviction radar' },
  { key: 'morning_exits', label: 'Morning exit emails', hint: 'Morning page exit strings' },
  { key: 'pattern_alerts', label: 'Chart pattern digest', hint: 'Breakout/confirmed after daily scan' },
];

const WHATSAPP_FLAGS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'swing_radar', label: 'HOT radar WhatsApp', hint: 'New High Conviction additions' },
  { key: 'evening_gtt', label: 'Evening GTT WhatsApp', hint: 'Post-close GTT summary' },
  { key: 'exit_alerts', label: 'EXIT alerts WhatsApp', hint: 'Open-book exit summary' },
  { key: 'pattern_alerts', label: 'Chart pattern WhatsApp', hint: 'Breakout/confirmed digest' },
];

interface WhatsAppStatus {
  configured: boolean;
  provider: string | null;
  to_masked: string | null;
  features: Record<string, boolean>;
  env_hard_off: boolean;
}

interface SmtpStatus {
  configured: boolean;
  host: string | null;
  from_masked: string | null;
  has_auth: boolean;
  has_to_override: boolean;
}

export interface AdminEffectiveSettings {
  configRoot?: string;
  overrides?: Record<string, unknown>;
  fileDefaults?: {
    alerts?: Record<string, unknown>;
    schedules?: Record<string, unknown>;
    strategyDailyProof?: Record<string, unknown>;
    indices?: Record<string, unknown>;
    etfs?: Record<string, unknown>;
    dataPolicy?: Record<string, unknown>;
  };
  effective: {
    dataPolicy?: {
      timezone?: string;
      cache_ttl?: Record<string, number>;
      staleness?: {
        index_max_age_days?: number;
        nse_equity_max_age_days?: number;
        holdings_max_age_days?: number;
      };
      prefetch?: {
        enabled?: boolean;
        universes?: string[];
        include_open_positions?: boolean;
        max_symbols_per_batch?: number;
        delay_ms_between_batches?: number;
      };
      on_demand?: {
        allow_refresh_param?: boolean;
        rate_limit_per_user_per_hour?: number;
      };
    };
    indices?: {
      version?: number;
      definitions?: Record<
        string,
        {
          label: string;
          csv: string;
          mwPatterns: string[];
          bounds?: { min: number; max: number };
        }
      >;
    };
    etfs?: {
      version?: number;
      entries?: Array<{
        symbol: string;
        name: string;
        category: string;
        underlying: string;
        ter_pct: number;
        liquidity: string;
        radar?: boolean;
        note?: string;
      }>;
    };
    schedules: {
      daily_sync: { cron: string; timezone: string; enabled: boolean };
      intraday?: {
        evening_gtt?: { enabled?: boolean; cron?: string; timezone?: string };
        exit_alerts?: { enabled?: boolean; cron?: string; timezone?: string };
        strategy_daily_proof?: { enabled?: boolean; cron?: string; timezone?: string };
        morning_prewarm?: { enabled?: boolean; cron?: string };
        swing_auto_scan?: { enabled?: boolean; interval_sec?: number };
        regime_refresh?: { enabled?: boolean; interval_sec?: number };
        paper_auto_trade?: {
          enabled?: boolean;
          interval_sec?: number;
          max_notional_inr?: number;
          max_open_positions?: number;
          skip_accuracy_gate?: boolean;
        };
        swing_paper_auto_trade?: { enabled?: boolean; interval_sec?: number };
      };
    };
    alerts?: {
      email?: Partial<Record<string, boolean>>;
      whatsapp?: Partial<Record<string, boolean>>;
      evening_gtt?: {
        tiers?: string[];
        max_orders?: number;
        limit_premium_pct?: number;
        send_email?: boolean;
      };
      exit_alerts?: {
        include_swing?: boolean;
        include_intraday?: boolean;
        skip_weekends?: boolean;
        max_positions_per_book?: number;
      };
    };
    strategyDailyProof?: {
      enabled?: boolean;
      skip_weekends?: boolean;
      max_scan?: number;
      strategies?: string[];
    };
  };
}

interface StrategyOption {
  key: string;
  label: string;
  ready?: boolean;
  style?: string;
}

type Props = {
  settings: AdminEffectiveSettings;
  loading: boolean;
  onBusy: (busy: boolean) => void;
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
  onSaved: () => Promise<void>;
  /** Show only jobs schedules, only notifications, or both (default). */
  section?: 'jobs' | 'notifications' | 'all';
};

function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn btn-sm ${on ? '' : 'btn-secondary'}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
    >
      {on ? 'On' : 'Off'}
    </button>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {children}
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

export function AdminFeaturesPanel({
  settings,
  loading,
  onBusy,
  onMessage,
  onError,
  onSaved,
  section = 'all',
}: Props) {
  const eff = settings.effective;
  const intraday = eff.schedules.intraday ?? {};
  const alerts = eff.alerts ?? {};
  const proof = eff.strategyDailyProof ?? {};

  const [dailyEnabled, setDailyEnabled] = useState(eff.schedules.daily_sync.enabled !== false);
  const [dailyCron, setDailyCron] = useState(eff.schedules.daily_sync.cron);

  const [gttEnabled, setGttEnabled] = useState(intraday.evening_gtt?.enabled !== false);
  const [gttCron, setGttCron] = useState(intraday.evening_gtt?.cron ?? '0 16 * * *');
  const [exitEnabled, setExitEnabled] = useState(intraday.exit_alerts?.enabled !== false);
  const [exitCron, setExitCron] = useState(intraday.exit_alerts?.cron ?? '45 15 * * *');
  const [proofSchedEnabled, setProofSchedEnabled] = useState(
    intraday.strategy_daily_proof?.enabled !== false,
  );
  const [proofCron, setProofCron] = useState(intraday.strategy_daily_proof?.cron ?? '15 16 * * *');
  const [morningEnabled, setMorningEnabled] = useState(intraday.morning_prewarm?.enabled !== false);
  const [morningCron, setMorningCron] = useState(intraday.morning_prewarm?.cron ?? '45 8 * * *');

  const [swingAutoEnabled, setSwingAutoEnabled] = useState(
    intraday.swing_auto_scan?.enabled !== false,
  );
  const [swingAutoInterval, setSwingAutoInterval] = useState(
    String(intraday.swing_auto_scan?.interval_sec ?? 300),
  );
  const [regimeEnabled, setRegimeEnabled] = useState(intraday.regime_refresh?.enabled !== false);
  const [regimeInterval, setRegimeInterval] = useState(
    String(intraday.regime_refresh?.interval_sec ?? 900),
  );
  const [paperEnabled, setPaperEnabled] = useState(intraday.paper_auto_trade?.enabled !== false);
  const [paperInterval, setPaperInterval] = useState(
    String(intraday.paper_auto_trade?.interval_sec ?? 60),
  );
  const [paperMaxNotional, setPaperMaxNotional] = useState(
    String(intraday.paper_auto_trade?.max_notional_inr ?? 30000),
  );
  const [paperMaxOpen, setPaperMaxOpen] = useState(
    String(intraday.paper_auto_trade?.max_open_positions ?? 10),
  );
  const [skipAccuracyGate, setSkipAccuracyGate] = useState(
    intraday.paper_auto_trade?.skip_accuracy_gate !== false,
  );
  const [swingPaperEnabled, setSwingPaperEnabled] = useState(
    intraday.swing_paper_auto_trade?.enabled !== false,
  );
  const [swingPaperInterval, setSwingPaperInterval] = useState(
    String(intraday.swing_paper_auto_trade?.interval_sec ?? 60),
  );

  const [emailFlags, setEmailFlags] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const f of EMAIL_FLAGS) {
      out[f.key] = alerts.email?.[f.key] !== false;
    }
    return out;
  });
  const [whatsappFlags, setWhatsappFlags] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const f of WHATSAPP_FLAGS) {
      out[f.key] = alerts.whatsapp?.[f.key] !== false;
    }
    return out;
  });
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [gttTiers, setGttTiers] = useState<string[]>(
    alerts.evening_gtt?.tiers?.length
      ? [...alerts.evening_gtt.tiers]
      : ['high_conviction', 'strict_enter'],
  );
  const [gttMaxOrders, setGttMaxOrders] = useState(String(alerts.evening_gtt?.max_orders ?? 15));
  const [gttPremium, setGttPremium] = useState(String(alerts.evening_gtt?.limit_premium_pct ?? 0.2));
  const [gttSendEmail, setGttSendEmail] = useState(alerts.evening_gtt?.send_email !== false);

  const [exitSwing, setExitSwing] = useState(alerts.exit_alerts?.include_swing !== false);
  const [exitIntraday, setExitIntraday] = useState(alerts.exit_alerts?.include_intraday !== false);
  const [exitSkipWeekends, setExitSkipWeekends] = useState(
    alerts.exit_alerts?.skip_weekends !== false,
  );
  const [exitMaxPos, setExitMaxPos] = useState(
    String(alerts.exit_alerts?.max_positions_per_book ?? 50),
  );

  const [proofEnabled, setProofEnabled] = useState(proof.enabled !== false);
  const [proofSkipWeekends, setProofSkipWeekends] = useState(proof.skip_weekends !== false);
  const [proofMaxScan, setProofMaxScan] = useState(String(proof.max_scan ?? 60));
  const [proofStrategies, setProofStrategies] = useState<string[]>(proof.strategies ?? []);
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ strategies: StrategyOption[] }>('/api/v1/strategies');
        if (!cancelled) {
          setStrategyOptions(
            (data.strategies ?? [])
              .filter((s) => s.ready !== false && !s.key.startsWith('user_'))
              .sort((a, b) => a.label.localeCompare(b.label)),
          );
        }
      } catch {
        if (!cancelled) setStrategyOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [wa, smtp] = await Promise.all([
          api<WhatsAppStatus>('/api/v1/admin/whatsapp/status'),
          api<SmtpStatus>('/api/v1/admin/smtp/status'),
        ]);
        if (!cancelled) {
          setWaStatus(wa);
          setSmtpStatus(smtp);
        }
      } catch {
        if (!cancelled) {
          setWaStatus(null);
          setSmtpStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Resync local form when parent reloads settings
  useEffect(() => {
    const e = settings.effective;
    const i = e.schedules.intraday ?? {};
    const a = e.alerts ?? {};
    const p = e.strategyDailyProof ?? {};
    setDailyEnabled(e.schedules.daily_sync.enabled !== false);
    setDailyCron(e.schedules.daily_sync.cron);
    setGttEnabled(i.evening_gtt?.enabled !== false);
    setGttCron(i.evening_gtt?.cron ?? '0 16 * * *');
    setExitEnabled(i.exit_alerts?.enabled !== false);
    setExitCron(i.exit_alerts?.cron ?? '45 15 * * *');
    setProofSchedEnabled(i.strategy_daily_proof?.enabled !== false);
    setProofCron(i.strategy_daily_proof?.cron ?? '15 16 * * *');
    setMorningEnabled(i.morning_prewarm?.enabled !== false);
    setMorningCron(i.morning_prewarm?.cron ?? '45 8 * * *');
    setSwingAutoEnabled(i.swing_auto_scan?.enabled !== false);
    setSwingAutoInterval(String(i.swing_auto_scan?.interval_sec ?? 300));
    setRegimeEnabled(i.regime_refresh?.enabled !== false);
    setRegimeInterval(String(i.regime_refresh?.interval_sec ?? 900));
    setPaperEnabled(i.paper_auto_trade?.enabled !== false);
    setPaperInterval(String(i.paper_auto_trade?.interval_sec ?? 60));
    setPaperMaxNotional(String(i.paper_auto_trade?.max_notional_inr ?? 30000));
    setPaperMaxOpen(String(i.paper_auto_trade?.max_open_positions ?? 10));
    setSkipAccuracyGate(i.paper_auto_trade?.skip_accuracy_gate !== false);
    setSwingPaperEnabled(i.swing_paper_auto_trade?.enabled !== false);
    setSwingPaperInterval(String(i.swing_paper_auto_trade?.interval_sec ?? 60));
    const flags: Record<string, boolean> = {};
    for (const f of EMAIL_FLAGS) flags[f.key] = a.email?.[f.key] !== false;
    setEmailFlags(flags);
    const waFlags: Record<string, boolean> = {};
    for (const f of WHATSAPP_FLAGS) waFlags[f.key] = a.whatsapp?.[f.key] !== false;
    setWhatsappFlags(waFlags);
    setGttTiers(
      a.evening_gtt?.tiers?.length ? [...a.evening_gtt.tiers] : ['high_conviction', 'strict_enter'],
    );
    setGttMaxOrders(String(a.evening_gtt?.max_orders ?? 15));
    setGttPremium(String(a.evening_gtt?.limit_premium_pct ?? 0.2));
    setGttSendEmail(a.evening_gtt?.send_email !== false);
    setExitSwing(a.exit_alerts?.include_swing !== false);
    setExitIntraday(a.exit_alerts?.include_intraday !== false);
    setExitSkipWeekends(a.exit_alerts?.skip_weekends !== false);
    setExitMaxPos(String(a.exit_alerts?.max_positions_per_book ?? 50));
    setProofEnabled(p.enabled !== false);
    setProofSkipWeekends(p.skip_weekends !== false);
    setProofMaxScan(String(p.max_scan ?? 60));
    setProofStrategies(p.strategies ?? []);
  }, [settings]);

  const overrideKeys = useMemo(
    () =>
      Object.keys(settings.overrides ?? {}).filter((k) =>
        ['alerts', 'schedules', 'strategyDailyProof', 'indices', 'dataPolicy'].includes(k),
      ),
    [settings.overrides],
  );

  async function patch(body: Record<string, unknown>, okMsg: string) {
    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
      onMessage(okMsg);
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      onBusy(false);
    }
  }

  async function saveSchedules(e: FormEvent) {
    e.preventDefault();
    await patch(
      {
        schedules: {
          daily_sync: { enabled: dailyEnabled, cron: dailyCron.trim() },
          intraday: {
            evening_gtt: { enabled: gttEnabled, cron: gttCron.trim() },
            exit_alerts: { enabled: exitEnabled, cron: exitCron.trim() },
            strategy_daily_proof: { enabled: proofSchedEnabled, cron: proofCron.trim() },
            morning_prewarm: { enabled: morningEnabled, cron: morningCron.trim() },
            swing_auto_scan: {
              enabled: swingAutoEnabled,
              interval_sec: Number(swingAutoInterval) || 300,
            },
            regime_refresh: {
              enabled: regimeEnabled,
              interval_sec: Number(regimeInterval) || 900,
            },
            paper_auto_trade: {
              enabled: paperEnabled,
              interval_sec: Number(paperInterval) || 60,
              max_notional_inr: Number(paperMaxNotional) || 30000,
              max_open_positions: Number(paperMaxOpen) || 10,
              skip_accuracy_gate: skipAccuracyGate,
            },
            swing_paper_auto_trade: {
              enabled: swingPaperEnabled,
              interval_sec: Number(swingPaperInterval) || 60,
            },
          },
        },
      },
      'Schedules saved — worker picks up within ~60s',
    );
  }

  async function saveAlerts(e: FormEvent) {
    e.preventDefault();
    if (gttTiers.length === 0) {
      onError('Select at least one evening GTT tier');
      return;
    }
    await patch(
      {
        alerts: {
          email: emailFlags,
          whatsapp: whatsappFlags,
          evening_gtt: {
            tiers: gttTiers,
            max_orders: Math.max(1, Number(gttMaxOrders) || 15),
            limit_premium_pct: Number(gttPremium) || 0.2,
            send_email: gttSendEmail,
          },
          exit_alerts: {
            include_swing: exitSwing,
            include_intraday: exitIntraday,
            skip_weekends: exitSkipWeekends,
            max_positions_per_book: Math.max(1, Number(exitMaxPos) || 50),
          },
        },
      },
      'Alerts settings saved',
    );
  }

  async function sendWhatsAppTest() {
    onBusy(true);
    onError('');
    onMessage('');
    try {
      const res = await api<{ ok: boolean; sent: boolean; provider: string | null; reason?: string }>(
        '/api/v1/admin/whatsapp/test',
        { method: 'POST', body: '{}' },
      );
      onMessage(
        res.sent
          ? `WhatsApp test sent via ${res.provider ?? 'provider'}`
          : `WhatsApp test not sent: ${res.reason ?? 'unknown'}`,
      );
      const status = await api<WhatsAppStatus>('/api/v1/admin/whatsapp/status');
      setWaStatus(status);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'WhatsApp test failed');
    } finally {
      onBusy(false);
    }
  }

  async function sendSmtpTest() {
    onBusy(true);
    onError('');
    onMessage('');
    try {
      const res = await api<{ ok: boolean; to?: string | null; reason?: string }>(
        '/api/v1/admin/smtp/test',
        { method: 'POST', body: '{}' },
      );
      onMessage(
        res.ok
          ? `SMTP test sent${res.to ? ` → ${res.to}` : ''}`
          : res.reason || 'SMTP test failed',
      );
      setSmtpStatus(await api<SmtpStatus>('/api/v1/admin/smtp/status'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'SMTP test failed');
    } finally {
      onBusy(false);
    }
  }

  async function saveProof(e: FormEvent) {
    e.preventDefault();
    if (proofStrategies.length === 0) {
      onError('Select at least one strategy for daily proof');
      return;
    }
    await patch(
      {
        strategyDailyProof: {
          enabled: proofEnabled,
          skip_weekends: proofSkipWeekends,
          max_scan: Math.max(5, Number(proofMaxScan) || 60),
          strategies: proofStrategies,
        },
      },
      'Strategy daily proof saved',
    );
  }

  async function resetSection(key: 'alerts' | 'schedules' | 'strategyDailyProof') {
    if (!confirm(`Reset ${key} overrides to YAML defaults?`)) return;
    await patch({ [key]: null }, `${key} reset to YAML defaults`);
  }

  function toggleTier(key: string) {
    setGttTiers((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key],
    );
  }

  function toggleStrategy(key: string) {
    setProofStrategies((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
    );
  }

  const showJobs = section === 'all' || section === 'jobs';
  const showNotifications = section === 'all' || section === 'notifications';

  return (
    <div className="admin-features">
      {section === 'all' && (
        <div className="admin-override-banner muted">
          Config root: <code>{settings.configRoot ?? 'config/'}</code>
          {overrideKeys.length > 0 ? (
            <>
              {' '}
              · DB overrides active: <code>{overrideKeys.join(', ')}</code>
            </>
          ) : (
            <> · using YAML defaults (no DB overrides)</>
          )}
          <span className="muted"> · Env hard-off still wins (e.g. EVENING_GTT_EMAIL=0)</span>
        </div>
      )}

      {showJobs && (
      <form className="card" onSubmit={saveSchedules}>
        <div className="admin-card-head">
          <h2 style={{ margin: 0 }}>Job schedules</h2>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => void resetSection('schedules')}>
            Reset to YAML
          </button>
        </div>
        <p className="muted">Enable/disable jobs and edit crons without touching schedules.yaml.</p>

        <div className="admin-feature-grid">
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Daily sync</strong>
              <Toggle on={dailyEnabled} disabled={loading} onClick={() => setDailyEnabled((v) => !v)} />
            </div>
            <Field label="Cron">
              <input value={dailyCron} onChange={(e) => setDailyCron(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Evening GTT</strong>
              <Toggle on={gttEnabled} disabled={loading} onClick={() => setGttEnabled((v) => !v)} />
            </div>
            <Field label="Cron" hint="Default 16:00 IST">
              <input value={gttCron} onChange={(e) => setGttCron(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Exit alerts</strong>
              <Toggle on={exitEnabled} disabled={loading} onClick={() => setExitEnabled((v) => !v)} />
            </div>
            <Field label="Cron" hint="Default 15:45 IST">
              <input value={exitCron} onChange={(e) => setExitCron(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Strategy daily proof</strong>
              <Toggle
                on={proofSchedEnabled}
                disabled={loading}
                onClick={() => setProofSchedEnabled((v) => !v)}
              />
            </div>
            <Field label="Cron" hint="Default 16:15 IST">
              <input value={proofCron} onChange={(e) => setProofCron(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Morning prewarm</strong>
              <Toggle on={morningEnabled} disabled={loading} onClick={() => setMorningEnabled((v) => !v)} />
            </div>
            <Field label="Cron">
              <input value={morningCron} onChange={(e) => setMorningCron(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Swing Auto scan</strong>
              <Toggle on={swingAutoEnabled} disabled={loading} onClick={() => setSwingAutoEnabled((v) => !v)} />
            </div>
            <Field label="Interval (sec)">
              <input type="number" min={60} value={swingAutoInterval} onChange={(e) => setSwingAutoInterval(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Regime refresh</strong>
              <Toggle on={regimeEnabled} disabled={loading} onClick={() => setRegimeEnabled((v) => !v)} />
            </div>
            <Field label="Interval (sec)">
              <input type="number" min={60} value={regimeInterval} onChange={(e) => setRegimeInterval(e.target.value)} />
            </Field>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Intraday paper auto</strong>
              <Toggle on={paperEnabled} disabled={loading} onClick={() => setPaperEnabled((v) => !v)} />
            </div>
            <Field label="Interval (sec)">
              <input type="number" min={30} value={paperInterval} onChange={(e) => setPaperInterval(e.target.value)} />
            </Field>
            <Field label="Max notional ₹">
              <input type="number" min={1000} value={paperMaxNotional} onChange={(e) => setPaperMaxNotional(e.target.value)} />
            </Field>
            <Field label="Max open">
              <input type="number" min={1} value={paperMaxOpen} onChange={(e) => setPaperMaxOpen(e.target.value)} />
            </Field>
            <div className="admin-feature-block-head" style={{ marginTop: 8 }}>
              <strong>Skip accuracy gate</strong>
              <Toggle on={skipAccuracyGate} disabled={loading} onClick={() => setSkipAccuracyGate((v) => !v)} />
            </div>
          </div>

          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Swing paper auto</strong>
              <Toggle on={swingPaperEnabled} disabled={loading} onClick={() => setSwingPaperEnabled((v) => !v)} />
            </div>
            <Field label="Interval (sec)">
              <input type="number" min={30} value={swingPaperInterval} onChange={(e) => setSwingPaperInterval(e.target.value)} />
            </Field>
          </div>
        </div>

        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.85rem' }}>
          Save schedules
        </button>
      </form>
      )}

      {showNotifications && (
      <>
      <form className="card" onSubmit={saveAlerts}>
        <div className="admin-card-head">
          <h2 style={{ margin: 0 }}>Alerts & email</h2>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => void resetSection('alerts')}>
            Reset to YAML
          </button>
        </div>
        <p className="muted">Product knobs for digests — no alerts.yaml edit needed.</p>

        <h3 className="admin-subhead">SMTP</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {smtpStatus?.configured
            ? `${smtpStatus.host ?? 'host'} · from ${smtpStatus.from_masked ?? '—'}${
                smtpStatus.has_to_override ? ' · SIGNAL_ALERT_EMAIL_TO set' : ''
              }`
            : 'Not configured — set SMTP_HOST + SMTP_FROM/SMTP_USER in .env'}
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading || !smtpStatus?.configured}
          onClick={() => void sendSmtpTest()}
        >
          Send SMTP test
        </button>

        <h3 className="admin-subhead">Email feature flags</h3>
        <div className="admin-toggle-list">
          {EMAIL_FLAGS.map((f) => (
            <label key={f.key} className="admin-toggle-row">
              <span>
                <strong>{f.label}</strong>
                <span className="muted block">{f.hint}</span>
              </span>
              <Toggle
                on={emailFlags[f.key] !== false}
                disabled={loading}
                onClick={() => setEmailFlags((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              />
            </label>
          ))}
        </div>

        <h3 className="admin-subhead">WhatsApp channel</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {waStatus?.configured
            ? `Provider ${waStatus.provider ?? '—'} · to ${waStatus.to_masked ?? '—'}`
            : waStatus?.env_hard_off
              ? 'Hard-off via WHATSAPP_ALERTS=0'
              : 'Not configured — set WHATSAPP_TO + Twilio/CallMeBot/Meta in .env (see docs/WHATSAPP-ALERTS.md)'}
        </p>
        <div className="admin-toggle-list">
          {WHATSAPP_FLAGS.map((f) => (
            <label key={f.key} className="admin-toggle-row">
              <span>
                <strong>{f.label}</strong>
                <span className="muted block">{f.hint}</span>
              </span>
              <Toggle
                on={whatsappFlags[f.key] !== false}
                disabled={loading}
                onClick={() => setWhatsappFlags((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading || !waStatus?.configured}
          style={{ marginTop: '0.65rem' }}
          onClick={() => void sendWhatsAppTest()}
        >
          Send WhatsApp test
        </button>

        <h3 className="admin-subhead">Evening GTT product</h3>
        <div className="admin-feature-grid">
          <div className="admin-feature-block">
            <strong>Tiers</strong>
            <div className="admin-chip-row">
              {GTT_TIERS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`btn btn-sm ${gttTiers.includes(t.key) ? '' : 'btn-secondary'}`}
                  disabled={loading}
                  onClick={() => toggleTier(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Max orders">
            <input type="number" min={1} max={50} value={gttMaxOrders} onChange={(e) => setGttMaxOrders(e.target.value)} />
          </Field>
          <Field label="Limit premium %" hint="Buy limit = trigger × (1 + pct/100)">
            <input type="number" step="0.1" min={0} value={gttPremium} onChange={(e) => setGttPremium(e.target.value)} />
          </Field>
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Send SMTP on build</strong>
              <Toggle on={gttSendEmail} disabled={loading} onClick={() => setGttSendEmail((v) => !v)} />
            </div>
          </div>
        </div>

        <h3 className="admin-subhead">Exit alert books</h3>
        <div className="admin-feature-grid">
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Include swing journal</strong>
              <Toggle on={exitSwing} disabled={loading} onClick={() => setExitSwing((v) => !v)} />
            </div>
          </div>
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Include intraday journal</strong>
              <Toggle on={exitIntraday} disabled={loading} onClick={() => setExitIntraday((v) => !v)} />
            </div>
          </div>
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Skip weekends</strong>
              <Toggle on={exitSkipWeekends} disabled={loading} onClick={() => setExitSkipWeekends((v) => !v)} />
            </div>
          </div>
          <Field label="Max positions / book">
            <input type="number" min={1} value={exitMaxPos} onChange={(e) => setExitMaxPos(e.target.value)} />
          </Field>
        </div>

        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.85rem' }}>
          Save alerts
        </button>
      </form>

      <form className="card" onSubmit={saveProof}>
        <div className="admin-card-head">
          <h2 style={{ margin: 0 }}>Strategy daily proof</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loading}
            onClick={() => void resetSection('strategyDailyProof')}
          >
            Reset to YAML
          </button>
        </div>
        <p className="muted">Allowlist which catalog strategies run after close.</p>

        <div className="admin-feature-grid">
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Feature enabled</strong>
              <Toggle on={proofEnabled} disabled={loading} onClick={() => setProofEnabled((v) => !v)} />
            </div>
          </div>
          <div className="admin-feature-block">
            <div className="admin-feature-block-head">
              <strong>Skip weekends</strong>
              <Toggle
                on={proofSkipWeekends}
                disabled={loading}
                onClick={() => setProofSkipWeekends((v) => !v)}
              />
            </div>
          </div>
          <Field label="Max scan symbols">
            <input type="number" min={5} max={200} value={proofMaxScan} onChange={(e) => setProofMaxScan(e.target.value)} />
          </Field>
        </div>

        <h3 className="admin-subhead">
          Strategies ({proofStrategies.length} selected)
        </h3>
        <div className="admin-strategy-grid">
          {strategyOptions.map((s) => {
            const on = proofStrategies.includes(s.key);
            return (
              <label key={s.key} className={`admin-strategy-chip ${on ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={loading}
                  onChange={() => toggleStrategy(s.key)}
                />
                <span>
                  <strong>{s.label}</strong>
                  <span className="muted block">{s.key}</span>
                </span>
              </label>
            );
          })}
          {strategyOptions.length === 0 && (
            <p className="muted">Could not load strategy catalog.</p>
          )}
        </div>

        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.85rem' }}>
          Save strategy proof
        </button>
      </form>
      </>
      )}
    </div>
  );
}
