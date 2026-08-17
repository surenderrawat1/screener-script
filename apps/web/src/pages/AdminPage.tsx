import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { AdminDataPolicyPanel } from './AdminDataPolicyPanel';
import {
  AdminFeaturesPanel,
  type AdminEffectiveSettings,
} from './AdminFeaturesPanel';
import { AdminIndicesPanel, type IndexStatusRow } from './AdminIndicesPanel';
import { AdminEtfsPanel } from './AdminEtfsPanel';

type AdminTab = 'overview' | 'jobs' | 'notifications' | 'data' | 'cache' | 'content';

interface AdminStats {
  nse_equity_count: number;
  promoter_holding_count: number;
  promoter_pledge_count?: number;
  universes: { key: string; name: string; symbolCount: number }[];
}

type IndexStatus = IndexStatusRow;

interface CachePrefixStat {
  prefix: string;
  count: number;
}

interface CacheStats {
  connected: boolean;
  db: number;
  keysEstimate: number;
  prefixes: CachePrefixStat[];
}

interface CacheScope {
  prefix: string;
  label: string;
  ttl: string;
  policy: string;
  clearable: boolean;
}

interface CacheKeyPreview {
  key: string;
  ttl: number;
}

interface CacheValuePreview {
  key: string;
  exists: boolean;
  ttl: number;
  type: string;
  bytes: number;
  truncated: boolean;
  value: unknown;
}

type EffectiveSettings = AdminEffectiveSettings;

interface DailySyncStatus {
  enabled: boolean;
  cron: string;
  timezone: string;
  completed_today: boolean;
  due_now: boolean;
  active: boolean;
  last_job: {
    id: string;
    status: string;
    finished_at: string | null;
    error?: string | null;
    result?: unknown;
  } | null;
}

interface ReadyStatus {
  status: string;
  checks?: {
    postgres?: { ok?: boolean };
    redis?: { ok?: boolean };
    worker?: { ok?: boolean; detail?: string };
  };
}

interface OpsAlertRow {
  id: string;
  title: string;
  detail: string;
  severity: string;
  category: string;
}

interface OpsAlertsPayload {
  alerts: OpsAlertRow[];
  summary?: { count: number; critical: number; warn: number };
  checked_at: string;
  nse?: { label?: string; ist_time?: string };
}

interface SmtpStatus {
  configured: boolean;
  host: string | null;
  from_masked: string | null;
  has_auth: boolean;
  has_to_override: boolean;
}

interface WhatsAppStatus {
  configured: boolean;
  provider: string | null;
  to_masked: string | null;
  env_hard_off: boolean;
}

interface RiskPolicy {
  note: string;
  swing: {
    max_portfolio_heat_pct: number;
    heat_block_pct: number;
    max_sector_notional_pct: number;
    max_risk_per_trade_pct: number;
    max_open_positions: number;
    default_nav_inr: number;
    quality_floor: {
      min_roe_pct: number;
      min_roce_pct: number;
      roce_waived_for: string[];
    };
  };
  paper_intraday: {
    opening_balance_inr: number;
    max_notional_inr: number;
    max_open_positions: number;
    max_heat_pct: number;
    daily_loss_kill_pct: number;
    slippage_bps: number;
  };
}

const TABS: Array<{ key: AdminTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'data', label: 'Data' },
  { key: 'cache', label: 'Cache' },
  { key: 'content', label: 'Content' },
];

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  const tone = ok == null ? 'muted' : ok ? 'ok' : 'danger';
  return (
    <span className={`admin-status-pill admin-status-${tone}`}>
      <span className="admin-status-dot" />
      {label}
    </span>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [indices, setIndices] = useState<IndexStatus[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheScopes, setCacheScopes] = useState<CacheScope[]>([]);
  const [cacheKeys, setCacheKeys] = useState<CacheKeyPreview[]>([]);
  const [cacheValue, setCacheValue] = useState<CacheValuePreview | null>(null);
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  const [syncStatus, setSyncStatus] = useState<DailySyncStatus | null>(null);
  const [ready, setReady] = useState<ReadyStatus | null>(null);
  const [ops, setOps] = useState<OpsAlertsPayload | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [opsError, setOpsError] = useState('');
  const [smtp, setSmtp] = useState<SmtpStatus | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [riskPolicy, setRiskPolicy] = useState<RiskPolicy | null>(null);
  const [cachePrefix, setCachePrefix] = useState('sv:stock');
  const [cacheConfirm, setCacheConfirm] = useState('');
  const [cachePreviewError, setCachePreviewError] = useState('');
  const [showCachePreview, setShowCachePreview] = useState(false);
  const [nseFile, setNseFile] = useState<File | null>(null);
  const [holdingFile, setHoldingFile] = useState<File | null>(null);
  const [pledgeFile, setPledgeFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api<AdminStats>('/api/v1/admin/uploads/stats'));
    } catch {
      setStats(null);
    }
  }, []);

  const loadIndices = useCallback(async () => {
    try {
      const data = await api<{ indices: IndexStatus[] }>('/api/v1/admin/indices/status');
      setIndices(data.indices);
    } catch {
      setIndices([]);
    }
  }, []);

  const loadCacheStats = useCallback(async () => {
    try {
      const data = await api<{ stats: CacheStats; scopes?: CacheScope[] }>('/api/v1/admin/cache/stats');
      setCacheStats(data.stats);
      setCacheScopes(data.scopes ?? []);
    } catch {
      setCacheStats(null);
      setCacheScopes([]);
    }
  }, []);

  const loadCacheKeys = useCallback(async (prefix = cachePrefix) => {
    setCachePreviewError('');
    setCacheValue(null);
    try {
      const data = await api<{ keys: CacheKeyPreview[] }>(
        `/api/v1/admin/cache/keys?prefix=${encodeURIComponent(prefix)}&limit=25`,
      );
      setCacheKeys(data.keys);
    } catch (err) {
      setCacheKeys([]);
      setCachePreviewError(err instanceof Error ? err.message : 'Cache preview failed');
    }
  }, [cachePrefix]);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api<EffectiveSettings>('/api/v1/admin/settings'));
    } catch {
      setSettings(null);
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await api<DailySyncStatus>('/api/v1/admin/sync/status'));
    } catch {
      setSyncStatus(null);
    }
  }, []);

  const loadReady = useCallback(async () => {
    try {
      setReady(await api<ReadyStatus>('/api/v1/admin/status'));
    } catch {
      setReady(null);
    }
  }, []);

  const loadOps = useCallback(async () => {
    setOpsLoading(true);
    try {
      setOps(await api<OpsAlertsPayload>('/api/v1/ops/alerts'));
      setOpsError('');
    } catch (err) {
      setOps(null);
      setOpsError(err instanceof Error ? err.message : 'Ops alerts unavailable');
    } finally {
      setOpsLoading(false);
    }
  }, []);

  const loadDelivery = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api<SmtpStatus>('/api/v1/admin/smtp/status'),
        api<WhatsAppStatus>('/api/v1/admin/whatsapp/status'),
      ]);
      setSmtp(s);
      setWhatsapp(w);
    } catch {
      setSmtp(null);
      setWhatsapp(null);
    }
  }, []);

  const loadRiskPolicy = useCallback(async () => {
    try {
      setRiskPolicy(await api<RiskPolicy>('/api/v1/admin/risk-policy'));
    } catch {
      setRiskPolicy(null);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadIndices();
    void loadCacheStats();
    void loadSettings();
    void loadSyncStatus();
    void loadReady();
    void loadOps();
    void loadDelivery();
    void loadRiskPolicy();
  }, [
    loadStats,
    loadIndices,
    loadCacheStats,
    loadSettings,
    loadSyncStatus,
    loadReady,
    loadOps,
    loadDelivery,
    loadRiskPolicy,
  ]);

  useEffect(() => {
    setCacheConfirm('');
    if (cachePrefix) void loadCacheKeys(cachePrefix);
  }, [cachePrefix, loadCacheKeys]);

  async function upload(endpoint: string, file: File | null, successLabel = 'Imported') {
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const count = data.imported ?? data.count ?? 0;
      const key = data.indexKey ? ` (${data.indexKey})` : '';
      setMessage(`${successLabel} ${count} row(s)${key}`);
      await loadStats();
      await loadIndices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function syncIndicesFromDisk() {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await api<{ synced: number; total: number; indicesDir: string }>(
        '/api/v1/admin/indices/sync',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setMessage(`Synced ${data.synced}/${data.total} indices from ${data.indicesDir}`);
      await loadStats();
      await loadIndices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Index sync failed');
    } finally {
      setLoading(false);
    }
  }

  async function clearCachePrefix() {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await api<{ deleted: number; prefix: string }>(
        `/api/v1/admin/cache?prefix=${encodeURIComponent(cachePrefix)}&confirm=${encodeURIComponent(cacheConfirm)}`,
        { method: 'DELETE' },
      );
      setMessage(`Cleared ${data.deleted} key(s) under ${data.prefix}`);
      setCacheConfirm('');
      await loadCacheStats();
      await loadCacheKeys(data.prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cache clear failed');
    } finally {
      setLoading(false);
    }
  }

  async function reloadYamlConfig() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ ok: boolean; generation: number; configRoot: string }>(
        '/api/v1/admin/config/reload',
        { method: 'POST', body: '{}' },
      );
      setMessage(
        `Config reloaded (generation ${res.generation}). Worker picks it up within ~60s.`,
      );
      await loadSettings();
      await loadReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Config reload failed');
    } finally {
      setLoading(false);
    }
  }

  async function runDailySyncNow(force = false) {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await api<{
        accepted?: boolean;
        ok?: boolean;
        job_id: string;
        message?: string;
        steps?: { id: string; ok: boolean }[];
      }>('/api/v1/admin/sync/daily', {
        method: 'POST',
        body: JSON.stringify({ force }),
      });

      if (data.accepted) {
        setMessage(`Daily sync started (job ${data.job_id}) — waiting for completion…`);
        await loadSyncStatus();
        for (let i = 0; i < 180; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await api<DailySyncStatus>('/api/v1/admin/sync/status');
          setSyncStatus(status);
          if (!status.active) {
            const last = status.last_job;
            const result = last?.result as
              | { ok?: boolean; steps?: { id: string; ok: boolean }[] }
              | null
              | undefined;
            const failedSteps = Array.isArray(result?.steps)
              ? result.steps.filter((s) => !s.ok).length
              : 0;
            if (last?.status === 'done') {
              setMessage(`Daily sync completed — job ${last.id}`);
            } else if (last?.status === 'failed') {
              setMessage(
                `Daily sync finished with errors — job ${last.id}${
                  failedSteps ? ` (${failedSteps} step(s) failed)` : ''
                }${last.error ? `: ${last.error}` : ''}`,
              );
            } else {
              setMessage(`Daily sync ended — job ${data.job_id}`);
            }
            await loadCacheStats();
            await loadIndices();
            await loadOps();
            return;
          }
          if (i % 5 === 4) {
            setMessage(
              `Daily sync still running (job ${data.job_id})… ~${Math.round(((i + 1) * 2) / 60)}m`,
            );
          }
        }
        setMessage(`Daily sync still running after polling — check status for job ${data.job_id}`);
        return;
      }

      const failed = (data.steps ?? []).filter((s) => !s.ok).length;
      setMessage(
        `Daily sync ${data.ok ? 'completed' : 'finished with errors'} — job ${data.job_id}${
          failed ? ` (${failed} step(s) failed)` : ''
        }`,
      );
      await loadSyncStatus();
      await loadCacheStats();
      await loadIndices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Daily sync failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendEveningGtt() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ order_count: number; email_sent?: boolean; date_key: string }>(
        '/api/v1/signals/evening-gtt/build',
        { method: 'POST', body: JSON.stringify({ force: true, send_email: true }) },
      );
      setMessage(
        `Evening GTT ${res.date_key}: ${res.order_count} order(s)${res.email_sent ? ' · email sent' : ' · email not sent'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evening GTT failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendExitAlerts() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{
        swing_exits: number;
        intraday_exits: number;
        emails_sent: number;
      }>('/api/v1/signals/exit-alerts/send', { method: 'POST', body: '{}' });
      setMessage(
        `Exit alerts: swing ${res.swing_exits} · intraday ${res.intraday_exits} · emails ${res.emails_sent}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Exit alerts failed');
    } finally {
      setLoading(false);
    }
  }

  async function runDailyProof() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ ran: number; failed: number; date_key: string }>(
        '/api/v1/strategies/daily-proof/run',
        { method: 'POST', body: JSON.stringify({ force: true }) },
      );
      setMessage(`Daily proof ${res.date_key}: ${res.ran} run(s), ${res.failed} failed`);
      await loadOps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Daily proof failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendPatternAlerts() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{
        pattern_count: number;
        emails_sent: number;
        whatsapp_sent: boolean;
        skipped?: boolean;
        reason?: string;
        date_key: string;
      }>('/api/v1/signals/pattern-alerts/send', { method: 'POST', body: JSON.stringify({ force: true }) });
      setMessage(
        res.skipped
          ? `Pattern alerts skipped (${res.date_key}): ${res.reason ?? 'no send'}`
          : `Pattern alerts ${res.date_key}: ${res.pattern_count} breakout/confirmed · emails ${res.emails_sent}${
              res.whatsapp_sent ? ' · WhatsApp sent' : ''
            }`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pattern alerts failed');
    } finally {
      setLoading(false);
    }
  }

  async function repairIntradayBooks() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{
        ok: boolean;
        paper?: { voided?: number; relabeled?: number };
        journal?: { flattened?: number };
      }>('/api/v1/admin/intraday/repair-closed-books', { method: 'POST', body: '{}' });
      setMessage(
        `Intraday books repaired — voided ${res.paper?.voided ?? 0} scale-mismatch close(s), relabeled ${res.paper?.relabeled ?? 0}, flattened ${res.journal?.flattened ?? 0} leftover journal row(s)`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Intraday book repair failed');
    } finally {
      setLoading(false);
    }
  }

  async function runChartPatternScan() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ accepted: boolean; symbols_total: number; background?: boolean }>(
        '/api/v1/admin/chart-patterns/scan',
        { method: 'POST', body: JSON.stringify({ wait: false }) },
      );
      setMessage(
        res.background
          ? `Chart pattern scan started in background (${res.symbols_total} symbols)`
          : `Chart pattern scan queued (${res.symbols_total} symbols)`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chart pattern scan failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendSmtpTest() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ ok: boolean; to?: string | null; reason?: string }>(
        '/api/v1/admin/smtp/test',
        { method: 'POST', body: '{}' },
      );
      setMessage(
        res.ok
          ? `SMTP test sent${res.to ? ` → ${res.to}` : ''}`
          : res.reason || 'SMTP test failed',
      );
      await loadDelivery();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SMTP test failed');
    } finally {
      setLoading(false);
    }
  }

  async function refreshOverview() {
    setLoading(true);
    try {
      await Promise.all([
        loadReady(),
        loadOps(),
        loadDelivery(),
        loadSyncStatus(),
        loadStats(),
        loadIndices(),
        loadRiskPolicy(),
      ]);
      setMessage('Overview refreshed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadCacheValue(key: string) {
    setCachePreviewError('');
    setCacheValue(null);
    try {
      const data = await api<{ preview: CacheValuePreview }>(
        `/api/v1/admin/cache/value?prefix=${encodeURIComponent(cachePrefix)}&key=${encodeURIComponent(key)}`,
      );
      setCacheValue(data.preview);
    } catch (err) {
      setCachePreviewError(err instanceof Error ? err.message : 'Cache data preview failed');
    }
  }

  const selectedCacheScope = cacheScopes.find((scope) => scope.prefix === cachePrefix);
  const selectedCacheCount =
    cacheStats?.prefixes.find((row) => row.prefix === cachePrefix)?.count ?? cacheKeys.length;
  const canClearCache =
    Boolean(selectedCacheScope?.clearable) && cacheConfirm === cachePrefix && !loading;
  const cacheValueText =
    cacheValue?.value == null
      ? ''
      : typeof cacheValue.value === 'string'
        ? cacheValue.value
        : JSON.stringify(cacheValue.value, null, 2);

  const staleIndexCount = useMemo(
    () => indices.filter((i) => i.stale || i.count === 0).length,
    [indices],
  );
  const opsCritical = ops?.summary?.critical ?? 0;
  const opsWarn = ops?.summary?.warn ?? 0;
  const opsCount = ops?.summary?.count ?? ops?.alerts?.length ?? 0;

  return (
    <Page>
      <PageHeader
        title="Admin"
        subtitle="Research ops cockpit — health, jobs, delivery, data policy, and cache"
        actions={
          <div className="admin-header-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => void refreshOverview()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => void reloadYamlConfig()}
            >
              Reload YAML
            </button>
          </div>
        }
      />

      {(message || error) && (
        <div className={`admin-toast ${error ? 'admin-toast-error' : 'admin-toast-ok'}`}>
          {error || message}
        </div>
      )}

      <div className="admin-ops-strip">
        <StatusPill ok={ready?.checks?.postgres?.ok ?? null} label="Postgres" />
        <StatusPill ok={ready?.checks?.redis?.ok ?? cacheStats?.connected ?? null} label="Redis" />
        <StatusPill ok={ready?.checks?.worker?.ok ?? null} label="Worker" />
        <StatusPill
          ok={syncStatus ? syncStatus.completed_today || syncStatus.active : null}
          label={
            syncStatus?.active
              ? 'Daily sync running'
              : syncStatus?.completed_today
                ? 'Daily sync done'
                : 'Daily sync pending'
          }
        />
        <StatusPill
          ok={staleIndexCount === 0 ? true : staleIndexCount > 0 ? false : null}
          label={staleIndexCount > 0 ? `${staleIndexCount} index issue(s)` : 'Indices OK'}
        />
        <StatusPill
          ok={smtp ? smtp.configured : null}
          label={smtp?.configured ? 'SMTP ready' : 'SMTP off'}
        />
        <StatusPill
          ok={whatsapp ? whatsapp.configured && !whatsapp.env_hard_off : null}
          label={
            whatsapp?.env_hard_off
              ? 'WhatsApp hard-off'
              : whatsapp?.configured
                ? 'WhatsApp ready'
                : 'WhatsApp off'
          }
        />
        <StatusPill
          ok={opsError ? false : opsLoading ? null : opsCount === 0 ? true : opsCritical > 0 ? false : null}
          label={
            opsError
              ? 'Ops unavailable'
              : opsLoading
                ? 'Ops loading…'
                : opsCount === 0
                  ? 'Ops clear'
                  : `${opsCount} ops alert(s)`
          }
        />
      </div>

      <div className="card segmented strategies-tabs admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'btn' : 'btn btn-secondary'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <section className="card">
            <div className="admin-card-head">
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>Ops alerts</h2>
              <span className="muted">
                {ops?.nse?.label ?? 'NSE'}
                {ops?.nse?.ist_time ? ` · ${ops.nse.ist_time}` : ''}
                {opsCritical || opsWarn
                  ? ` · ${opsCritical} critical · ${opsWarn} warn`
                  : ' · all clear'}
              </span>
            </div>
            {opsError ? (
              <p className="error">{opsError}</p>
            ) : opsLoading ? (
              <p className="muted">Loading ops alerts…</p>
            ) : ops?.alerts?.length ? (
              <ul className="admin-ops-alerts">
                {ops.alerts.slice(0, 8).map((a) => (
                  <li key={a.id} className={`admin-ops-alert admin-ops-alert-${a.severity}`}>
                    <strong>{a.title}</strong>
                    <span className="muted">{a.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No open ops alerts.</p>
            )}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Run jobs</h2>
            <p className="muted">
              {syncStatus
                ? `Daily sync: ${syncStatus.completed_today ? 'completed today' : 'not run today'}${
                    syncStatus.active ? ' · running' : ''
                  }${
                    syncStatus.last_job?.finished_at
                      ? ` · last ${new Date(syncStatus.last_job.finished_at).toLocaleString()}`
                      : ''
                  }`
                : 'One place to trigger research jobs — configure schedules under Jobs.'}
            </p>
            <div className="admin-action-grid">
              <button
                type="button"
                className="btn"
                disabled={loading || syncStatus?.active}
                onClick={() => void runDailySyncNow(false)}
              >
                Run daily sync
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || syncStatus?.active}
                onClick={() => void runDailySyncNow(true)}
              >
                Force daily sync
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void sendEveningGtt()}
              >
                Send evening GTT
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void sendExitAlerts()}
              >
                Send exit alerts
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void runDailyProof()}
              >
                Run daily proof
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void runChartPatternScan()}
              >
                Scan chart patterns
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void sendPatternAlerts()}
              >
                Send pattern alerts
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void repairIntradayBooks()}
              >
                Repair intraday books
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || !smtp?.configured}
                onClick={() => void sendSmtpTest()}
              >
                Test SMTP
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setTab('jobs')}>
                Configure schedules →
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTab('notifications')}
              >
                Delivery channels →
              </button>
            </div>
          </section>

          <div className="admin-overview-grid">
            {stats && (
              <section className="card">
                <h2 style={{ marginTop: 0 }}>Universe snapshot</h2>
                <div className="admin-metric-grid">
                  <div className="admin-metric">
                    <span>NSE equity</span>
                    <strong>{stats.nse_equity_count}</strong>
                  </div>
                  <div className="admin-metric">
                    <span>Promoter holdings</span>
                    <strong>{stats.promoter_holding_count}</strong>
                  </div>
                  <div className="admin-metric">
                    <span>Promoter pledges</span>
                    <strong>{stats.promoter_pledge_count ?? 0}</strong>
                  </div>
                  <div className="admin-metric">
                    <span>Universes</span>
                    <strong>{stats.universes.length}</strong>
                  </div>
                  <div className="admin-metric">
                    <span>Index issues</span>
                    <strong>{staleIndexCount}</strong>
                  </div>
                </div>
              </section>
            )}

            <section className="card">
              <h2 style={{ marginTop: 0 }}>Delivery</h2>
              <ul className="admin-kv">
                <li>
                  <span>SMTP</span>
                  <code>
                    {smtp?.configured
                      ? `${smtp.host ?? 'host'} · ${smtp.from_masked ?? 'from'}`
                      : 'not configured'}
                  </code>
                </li>
                <li>
                  <span>WhatsApp</span>
                  <code>
                    {whatsapp?.env_hard_off
                      ? 'env hard-off'
                      : whatsapp?.configured
                        ? `${whatsapp.provider ?? 'provider'} · ${whatsapp.to_masked ?? 'to'}`
                        : 'not configured'}
                  </code>
                </li>
              </ul>
              <p className="muted" style={{ marginBottom: 0 }}>
                Channel toggles live under Notifications.
              </p>
            </section>
          </div>

          {riskPolicy && (
            <section className="card admin-risk-card">
              <div className="admin-card-head">
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>CFA risk policy</h2>
                <span className="admin-badge-readonly">Read-only</span>
              </div>
              <p className="muted">{riskPolicy.note}</p>
              <div className="admin-risk-grid">
                <div>
                  <h3 className="admin-subhead">Swing</h3>
                  <ul className="admin-kv">
                    <li>
                      <span>Portfolio heat</span>
                      <code>{riskPolicy.swing.max_portfolio_heat_pct}%</code>
                    </li>
                    <li>
                      <span>Heat block</span>
                      <code>{riskPolicy.swing.heat_block_pct}%</code>
                    </li>
                    <li>
                      <span>Sector cap</span>
                      <code>{riskPolicy.swing.max_sector_notional_pct}%</code>
                    </li>
                    <li>
                      <span>Risk / trade</span>
                      <code>{riskPolicy.swing.max_risk_per_trade_pct}%</code>
                    </li>
                    <li>
                      <span>Max positions</span>
                      <code>{riskPolicy.swing.max_open_positions}</code>
                    </li>
                    <li>
                      <span>Quality floor</span>
                      <code>
                        ROE ≥ {riskPolicy.swing.quality_floor.min_roe_pct}% · ROCE ≥{' '}
                        {riskPolicy.swing.quality_floor.min_roce_pct}%
                      </code>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="admin-subhead">Paper intraday</h3>
                  <ul className="admin-kv">
                    <li>
                      <span>Opening balance</span>
                      <code>₹{riskPolicy.paper_intraday.opening_balance_inr.toLocaleString()}</code>
                    </li>
                    <li>
                      <span>Max notional</span>
                      <code>₹{riskPolicy.paper_intraday.max_notional_inr.toLocaleString()}</code>
                    </li>
                    <li>
                      <span>Max heat</span>
                      <code>{riskPolicy.paper_intraday.max_heat_pct}%</code>
                    </li>
                    <li>
                      <span>Daily loss kill</span>
                      <code>{riskPolicy.paper_intraday.daily_loss_kill_pct}%</code>
                    </li>
                    <li>
                      <span>Slippage</span>
                      <code>{riskPolicy.paper_intraday.slippage_bps} bps</code>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {tab === 'jobs' && (
        <>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Run now</h2>
            <p className="muted">
              Manual triggers for scheduled research jobs. Prefer Overview for day-to-day ops;
              use this tab to edit cron and paper knobs.
            </p>
            <div className="admin-action-grid">
              <button
                type="button"
                className="btn"
                disabled={loading || syncStatus?.active}
                onClick={() => void runDailySyncNow(false)}
              >
                Run daily sync
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || syncStatus?.active}
                onClick={() => void runDailySyncNow(true)}
              >
                Force daily sync
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void sendEveningGtt()}
              >
                Send evening GTT
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void sendExitAlerts()}
              >
                Send exit alerts
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void runDailyProof()}
              >
                Run daily proof
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void sendPatternAlerts()}
              >
                Send pattern alerts
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void repairIntradayBooks()}
              >
                Repair intraday books
              </button>
            </div>
          </section>
          {settings ? (
            <AdminFeaturesPanel
              section="jobs"
              settings={settings}
              loading={loading}
              onBusy={setLoading}
              onMessage={setMessage}
              onError={setError}
              onSaved={async () => {
                await loadSettings();
                await loadSyncStatus();
              }}
            />
          ) : (
            <p className="muted">Loading job settings…</p>
          )}
        </>
      )}

      {tab === 'notifications' &&
        (settings ? (
          <AdminFeaturesPanel
            section="notifications"
            settings={settings}
            loading={loading}
            onBusy={setLoading}
            onMessage={setMessage}
            onError={setError}
            onSaved={async () => {
              await loadSettings();
              await loadDelivery();
            }}
          />
        ) : (
          <p className="muted">Loading notification settings…</p>
        ))}

      {tab === 'data' && (
        <>
          {settings ? (
            <AdminDataPolicyPanel
              settings={settings}
              loading={loading}
              onBusy={setLoading}
              onMessage={setMessage}
              onError={setError}
              onSaved={async () => {
                await loadSettings();
                await loadIndices();
              }}
            />
          ) : null}

          <AdminIndicesPanel
            indices={indices}
            definitions={settings?.effective.indices?.definitions ?? {}}
            loading={loading}
            onBusy={setLoading}
            onMessage={setMessage}
            onError={setError}
            onSaved={async () => {
              await loadSettings();
              await loadIndices();
              await loadStats();
            }}
            onSyncDisk={() => void syncIndicesFromDisk()}
          />

          <AdminEtfsPanel
            entries={settings?.effective.etfs?.entries ?? []}
            loading={loading}
            onBusy={setLoading}
            onMessage={setMessage}
            onError={setError}
            onSaved={async () => {
              await loadSettings();
            }}
          />

          {stats && (
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Loaded data</h2>
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>NSE equity list</td>
                    <td>{stats.nse_equity_count} symbols</td>
                  </tr>
                  <tr>
                    <td>Promoter holdings</td>
                    <td>{stats.promoter_holding_count} symbols</td>
                  </tr>
                  <tr>
                    <td>Promoter pledges</td>
                    <td>{stats.promoter_pledge_count ?? 0} symbols</td>
                  </tr>
                  {stats.universes.map((u) => (
                    <tr key={u.key}>
                      <td>{u.name}</td>
                      <td>{u.symbolCount} symbols</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              void upload('/api/v1/admin/uploads/nse-equity', nseFile);
            }}
          >
            <h2 style={{ marginTop: 0 }}>All NSE — EQUITY_L.csv</h2>
            <p className="muted">CSV with SYMBOL column. Updates total_nse universe.</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setNseFile(e.target.files?.[0] ?? null)}
            />
            <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
              Upload NSE equity list
            </button>
          </form>

          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              void upload('/api/v1/admin/uploads/promoter-holding', holdingFile);
            }}
          >
            <h2 style={{ marginTop: 0 }}>Promoter holding CSV</h2>
            <p className="muted">Columns: symbol, promoter_holding_pct, as_of (optional)</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setHoldingFile(e.target.files?.[0] ?? null)}
            />
            <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
              Upload promoter holdings
            </button>
          </form>

          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              void upload('/api/v1/admin/uploads/promoter-pledge', pledgeFile);
            }}
          >
            <h2 style={{ marginTop: 0 }}>Promoter pledge CSV</h2>
            <p className="muted">
              No free pledge API — upload bulk CSV for Full Verify Phase 1.6 and screener expand.
              Columns: <code>symbol,promoter_pledge_pct,as_of</code>
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setPledgeFile(e.target.files?.[0] ?? null)}
            />
            <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
              Upload promoter pledges
            </button>
          </form>
        </>
      )}

      {tab === 'cache' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Redis cache</h2>
          <p className="muted">
            Hot cache only. Clear one approved scope at a time; avoid job progress / rate-limit /
            heartbeat keys.
          </p>
          {cacheStats && (
            <>
              <p className="muted">
                DB {cacheStats.db} · ~{cacheStats.keysEstimate} keys ·{' '}
                {cacheStats.connected ? 'connected' : 'disconnected'}
              </p>
              {cacheScopes.length > 0 && (
                <table className="data-table" style={{ marginBottom: '1rem' }}>
                  <thead>
                    <tr>
                      <th>Scope</th>
                      <th>TTL</th>
                      <th>Keys</th>
                      <th>Rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cacheScopes.map((scope) => {
                      const count =
                        cacheStats.prefixes.find((row) => row.prefix === scope.prefix)?.count ?? 0;
                      return (
                        <tr key={scope.prefix}>
                          <td>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => setCachePrefix(scope.prefix)}
                            >
                              {scope.label}
                            </button>
                            <br />
                            <code>{scope.prefix}</code>
                          </td>
                          <td>{scope.ttl}</td>
                          <td>{count}</td>
                          <td>{scope.clearable ? 'Clearable with confirmation' : 'Protected'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
          <div className="admin-cache-grid">
            <label>
              Cache scope
              <select
                value={cachePrefix}
                onChange={(e) => setCachePrefix(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
              >
                {cacheScopes.map((scope) => (
                  <option key={scope.prefix} value={scope.prefix}>
                    {scope.label} ({scope.prefix})
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-cache-policy">
              <strong>{selectedCacheScope?.label ?? cachePrefix}</strong>
              <p>{selectedCacheScope?.policy ?? 'Select an approved cache scope.'}</p>
              <small>
                TTL: {selectedCacheScope?.ttl ?? 'unknown'} · Current keys: {selectedCacheCount} ·{' '}
                {selectedCacheScope?.clearable ? 'Manual clear allowed' : 'Protected scope'}
              </small>
            </div>
          </div>

          <div className="admin-cache-advanced">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowCachePreview((v) => !v);
                if (!showCachePreview) void loadCacheKeys(cachePrefix);
              }}
            >
              {showCachePreview ? 'Hide key inspector' : 'Show key inspector (advanced)'}
            </button>
            {showCachePreview && (
              <div className="admin-cache-preview">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>Key preview</strong>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={loading || !cachePrefix}
                    onClick={() => void loadCacheKeys(cachePrefix)}
                  >
                    Refresh preview
                  </button>
                </div>
                {cachePreviewError && <p className="error">{cachePreviewError}</p>}
                {cacheKeys.length > 0 ? (
                  <ul>
                    {cacheKeys.slice(0, 10).map((row) => (
                      <li key={row.key}>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => void loadCacheValue(row.key)}
                        >
                          <code>{row.key}</code>
                        </button>
                        <span className="muted">
                          {' '}
                          · TTL {row.ttl < 0 ? 'none' : `${row.ttl}s`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No keys found for this scope.</p>
                )}
                {cacheValue && (
                  <div className="admin-cache-value">
                    <div className="admin-cache-value-meta">
                      <strong>Data preview</strong>
                      <span>
                        {cacheValue.type} · {cacheValue.bytes.toLocaleString()} bytes · TTL{' '}
                        {cacheValue.ttl < 0 ? 'none' : `${cacheValue.ttl}s`}
                        {cacheValue.truncated ? ' · truncated' : ''}
                      </span>
                    </div>
                    <code>{cacheValue.key}</code>
                    {cacheValue.exists ? (
                      <pre>{cacheValueText}</pre>
                    ) : (
                      <p className="muted">This key no longer exists.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <label>
            Type <code>{cachePrefix}</code> to confirm clearing this scope
            <input
              type="text"
              value={cacheConfirm}
              onChange={(e) => setCacheConfirm(e.target.value)}
              placeholder={cachePrefix}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!canClearCache}
            style={{ marginTop: '0.75rem' }}
            onClick={() => void clearCachePrefix()}
          >
            Clear selected scope
          </button>
        </section>
      )}

      {tab === 'content' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>CFA documentation</h2>
          <p className="muted">
            Glossary and reference copy used in Verify and Screener. Strategy formulas and risk
            constants are not editable here — see Overview → CFA risk policy.
          </p>
          <div className="admin-action-grid">
            <Link to="/admin/cfa-docs" className="btn">
              Manage CFA Docs
            </Link>
            <Link to="/cfa-reference" className="btn btn-secondary">
              View CFA Reference
            </Link>
            <Link to="/signals" className="btn btn-secondary">
              Open signals
            </Link>
          </div>
        </section>
      )}
    </Page>
  );
}
