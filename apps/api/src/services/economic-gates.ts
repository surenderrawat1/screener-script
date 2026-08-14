import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { fetchInstrumentIntradayChart, getSwingAutoSnapshotDurable } from '@sv/data-adapters';
import {
  backtestIntradayCombo,
  MIN_INTRADAY_PROFIT_FACTOR,
  MIN_INTRADAY_EXPECTANCY_R,
  MIN_INTRADAY_TRADES_PROVEN,
  resolveInstrument,
} from '@sv/intraday';
import { economicEdgeGateStatus, type EconomicEdgeStatus } from '@sv/swing';

const GATE_CACHE_TTL_SEC = 3600;
const GATE_CACHE_KEY = cacheKey('sv:trading', 'economic-gates:v1');

export type GateStatus = 'pass' | 'fail' | 'unproven' | 'missing';

export interface EconomicGateBook {
  id: string;
  label: string;
  book: string;
  status: GateStatus;
  paper_only: boolean;
  net_expectancy_r?: number | null;
  profit_factor?: number | null;
  trades?: number;
  period_days: number;
  preset_id?: string;
  instrument_id?: string;
  interval?: string;
  hc_hits?: number;
  hc_econ_pass?: number;
  detail?: string;
  reasons?: string[];
}

export interface EconomicGatesResponse {
  ok: true;
  as_of: string;
  cached: boolean;
  books: EconomicGateBook[];
  disclaimer: string;
}

type IntradayPresetRow = {
  preset_id: string;
  label: string;
  trades: number;
  net_expectancy_r: number | null;
  profit_factor: number | null;
  economic_status: string;
  economic_pass: boolean;
  win_rate_pct: number | null;
};

async function intradayPresetGate(
  instrumentId: string,
  presetId: string,
  interval: '5m' | '15m',
): Promise<IntradayPresetRow | null> {
  const meta = resolveInstrument(instrumentId);
  if (!meta) return null;

  try {
    const [chart5, chart15] = await Promise.all([
      fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, '5m', false, '60d'),
      fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, '15m', false, '60d'),
    ]);
    if (!chart5?.bars?.length || !chart15?.bars?.length) return null;

    const result = backtestIntradayCombo(
      { bars: chart5.bars, closes: chart5.closes, interval: '5m' },
      { bars: chart15.bars, closes: chart15.closes, interval: '15m' },
      { interval, mode: 'single', preset_id: presetId },
    );
    return (result.presets[0] as IntradayPresetRow | undefined) ?? null;
  } catch {
    return null;
  }
}

function mapIntradayStatus(raw: string | undefined): GateStatus {
  if (raw === 'pass') return 'pass';
  if (raw === 'fail') return 'fail';
  if (raw === 'unproven') return 'unproven';
  return 'missing';
}

function bookFromIntradayRow(
  id: string,
  book: string,
  label: string,
  instrumentId: string,
  presetId: string,
  interval: '5m' | '15m',
  row: IntradayPresetRow | null,
): EconomicGateBook {
  const status = mapIntradayStatus(row?.economic_status);
  const reasons: string[] = [];
  if (status === 'fail') {
    if ((row?.net_expectancy_r ?? 0) <= MIN_INTRADAY_EXPECTANCY_R) {
      reasons.push(`Net E ≤ ${MIN_INTRADAY_EXPECTANCY_R}R`);
    }
    if ((row?.profit_factor ?? 0) < MIN_INTRADAY_PROFIT_FACTOR) {
      reasons.push(`PF < ${MIN_INTRADAY_PROFIT_FACTOR}`);
    }
    if ((row?.trades ?? 0) < MIN_INTRADAY_TRADES_PROVEN) {
      reasons.push(`Sample < ${MIN_INTRADAY_TRADES_PROVEN} trades`);
    }
  }
  if (status === 'unproven') reasons.push(`BT sample < ${MIN_INTRADAY_TRADES_PROVEN} closed trades`);

  return {
    id,
    label,
    book,
    status,
    paper_only: status !== 'pass',
    net_expectancy_r: row?.net_expectancy_r ?? null,
    profit_factor: row?.profit_factor ?? null,
    trades: row?.trades ?? 0,
    period_days: 60,
    preset_id: presetId,
    instrument_id: instrumentId,
    interval,
    detail:
      row && row.trades > 0
        ? `60d BT · n=${row.trades} · net E ${row.net_expectancy_r ?? '—'}R · PF ${row.profit_factor ?? '—'}`
        : 'Insufficient 60d backtest data',
    reasons: reasons.length ? reasons : undefined,
  };
}

async function swingAutoHcGate(): Promise<EconomicGateBook> {
  const snapshot = await getSwingAutoSnapshotDurable();
  const hits = Array.isArray((snapshot?.scan as Record<string, unknown> | undefined)?.hits)
    ? ((snapshot!.scan as Record<string, unknown>).hits as Record<string, unknown>[])
    : [];

  const hcHits = hits.filter((h) => h.high_conviction === true);
  let hcEconPass = 0;
  let hcWithTruth = 0;

  for (const hit of hcHits) {
    const truth = hit.backtest_truth as Record<string, unknown> | undefined;
    if (!truth || typeof truth !== 'object') continue;
    hcWithTruth++;
    if (economicEdgeGateStatus(truth as never) === 'pass') hcEconPass++;
  }

  let status: GateStatus = 'missing';
  if (hcHits.length === 0) {
    status = 'unproven';
  } else if (hcWithTruth === 0) {
    status = 'unproven';
  } else if (hcEconPass === hcWithTruth) {
    status = 'pass';
  } else {
    status = 'fail';
  }

  const edgeStatuses = hcHits
    .map((h) => economicEdgeGateStatus((h.backtest_truth as never) ?? null))
    .filter((s): s is EconomicEdgeStatus => s !== 'missing');

  if (edgeStatuses.length === 0 && hcHits.length > 0) status = 'unproven';

  return {
    id: 'swing_auto_hc',
    label: 'Swing Auto · High Conviction',
    book: 'swing_auto_hc',
    status,
    paper_only: true,
    period_days: 1095,
    hc_hits: hcHits.length,
    hc_econ_pass: hcEconPass,
    detail:
      hcHits.length === 0
        ? 'No HC hits in current scan — per-symbol 3y BT edge required for tier'
        : `${hcEconPass}/${hcWithTruth || hcHits.length} HC hits with proven 3y economic edge`,
    reasons:
      status === 'fail'
        ? ['Some HC hits lack proven 3y BT edge (expectancy → PF → compound → DD)']
        : status === 'unproven'
          ? ['Insufficient backtest truth on current HC scan']
          : undefined,
  };
}

async function computeEconomicGates(): Promise<EconomicGateBook[]> {
  const [niftyStratzy, bankStratzy, swingHc] = await Promise.all([
    intradayPresetGate('nifty50', 'ma20_stratzy', '15m'),
    intradayPresetGate('banknifty', 'ma20_stratzy', '15m'),
    swingAutoHcGate(),
  ]);

  return [
    bookFromIntradayRow(
      'intraday_stratzy_nifty_15m',
      'intraday_stratzy',
      'Stratzy · Nifty 50 · 15m',
      'nifty50',
      'ma20_stratzy',
      '15m',
      niftyStratzy,
    ),
    bookFromIntradayRow(
      'intraday_stratzy_banknifty_15m',
      'intraday_stratzy',
      'Stratzy · Bank Nifty · 15m',
      'banknifty',
      'ma20_stratzy',
      '15m',
      bankStratzy,
    ),
    swingHc,
  ];
}

export async function getEconomicGates(refresh = false): Promise<EconomicGatesResponse> {
  if (!refresh) {
    const cached = await cacheGetJson<EconomicGatesResponse>(GATE_CACHE_KEY);
    if (cached?.books?.length) {
      return { ...cached, cached: true };
    }
  }

  const books = await computeEconomicGates();
  const response: EconomicGatesResponse = {
    ok: true,
    as_of: new Date().toISOString(),
    cached: false,
    books,
    disclaimer:
      'Economic gates use 60d intraday BT (Stratzy) or per-symbol 3y swing BT. Fail = paper only until edge is proven.',
  };

  await cacheSetJson(GATE_CACHE_KEY, response, GATE_CACHE_TTL_SEC);
  return response;
}
