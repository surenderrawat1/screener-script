import { normalizeSectorKey } from './cfa-valuation-engine.js';
import type { DataQualityGate, DataQualityResult } from './verification/types.js';

const CYCLICAL_SECTORS = ['metal', 'cement', 'oil_gas', 'infra', 'telecom'];

function gate(id: string, label: string, pass: boolean, note: string): DataQualityGate {
  return { id, label, pass, note, manual: false };
}

export interface DataQualityOptions {
  require_graham_credible?: boolean;
  cache_stale_days?: number;
  sectorHints?: Record<string, string>;
}

export function evaluateDataQuality(
  stock: Record<string, unknown>,
  cacheMeta?: { created_at?: number; expires_at?: number } | null,
  options: DataQualityOptions = {},
): DataQualityResult {
  const staleDays = Number(options.cache_stale_days ?? 7);
  const requireGraham = Boolean(options.require_graham_credible);
  const sectorHints = options.sectorHints ?? {};

  const symbol = String(stock.symbol ?? '')
    .trim()
    .split('.')[0]
    ?.toUpperCase() ?? '';

  let sectorKey = String(stock.sector_key ?? '');
  if (sectorKey === '') {
    sectorKey = normalizeSectorKey(String(stock.sector ?? stock.sector_label ?? 'general'));
  }

  const flags = Array.isArray(stock.valuation_flags) ? (stock.valuation_flags as string[]) : [];

  const gates: DataQualityGate[] = [];

  if (!cacheMeta || (cacheMeta.created_at ?? 0) <= 0) {
    gates.push(
      gate('D1', `Cache freshness (≤ ${staleDays} days)`, false, 'No cache record — refetch via verify or cache.php'),
    );
  } else {
    const ageDays = Math.floor((Date.now() / 1000 - Number(cacheMeta.created_at)) / 86400);
    gates.push(
      gate(
        'D1',
        `Cache freshness (≤ ${staleDays} days)`,
        ageDays <= staleDays,
        ageDays <= staleDays
          ? `Cached ${ageDays} day(s) ago`
          : `Stale — ${ageDays} days old; refetch before decision`,
      ),
    );
  }

  const hasHint = symbol !== '' && Object.prototype.hasOwnProperty.call(sectorHints, symbol);
  const sectorOk = (sectorKey !== '' && sectorKey !== 'general') || hasHint;
  gates.push(
    gate(
      'D2',
      'Sector routing',
      sectorOk,
      sectorOk
        ? `sector_key=${sectorKey}${hasHint ? ' (hint)' : ''}`
        : 'Sector is general — confirm business model or add nse_sector_hints',
    ),
  );

  const fcfProxy = flags.includes('dcf_fcf_proxy');
  gates.push(
    gate(
      'D3',
      'FCF not proxied',
      !fcfProxy,
      fcfProxy ? 'DCF uses EPS×0.72 proxy — confirm AR FCF' : 'Reported or direct FCF path',
    ),
  );

  const ebitdaEst = flags.includes('ebitda_estimated');
  const cyclical = CYCLICAL_SECTORS.includes(sectorKey);
  const d4Pass = !ebitdaEst || !cyclical;
  gates.push(
    gate(
      'D4',
      'EBITDA confirmed (cyclicals)',
      d4Pass,
      ebitdaEst && cyclical
        ? 'EBITDA estimated from margin — confirm AR for cyclical'
        : ebitdaEst
          ? 'EBITDA estimated (non-cyclical OK)'
          : 'EBITDA direct or N/A',
    ),
  );

  const altmanSkip = Boolean(stock.altman_skip);
  const zSource = String(stock.z_score_source ?? 'missing');
  const zOk = altmanSkip || ['reported', 'computed', 'skipped'].includes(zSource);
  gates.push(
    gate(
      'D5',
      'Altman Z reliable',
      zOk,
      altmanSkip ? 'Skipped (financial sector)' : zOk ? `Source: ${zSource}` : `Source: ${zSource} — re-enter in Full Verify`,
    ),
  );

  const grahamCred = Boolean(stock.graham_credible);
  const d6Pass = !requireGraham || grahamCred;
  gates.push(
    gate(
      'D6',
      'Graham credible (if used)',
      d6Pass,
      requireGraham
        ? grahamCred
          ? 'Graham credible for preset'
          : 'Preset requires credible Graham — N/A for this name'
        : grahamCred
          ? 'Graham credible'
          : 'Graham display-only (OK unless deep_value preset)',
    ),
  );

  const cliCmd =
    symbol !== ''
      ? `php validate-logic.php --live ${symbol} --verbose`
      : 'php validate-logic.php --live SYMBOL --verbose';

  gates.push({
    id: 'D7',
    label: 'Live MOS parity',
    pass: null,
    note:
      symbol !== ''
        ? 'Run parity check — screener IV/MOS vs Full Verify (±2% IV, ±0.2 pp MOS)'
        : 'Run parity check after symbol known',
    manual: true,
    cli: cliCmd,
  });

  const autoGates = gates.filter((g) => !g.manual);
  const passCount = autoGates.filter((g) => g.pass === true).length;

  return {
    passed: passCount === autoGates.length,
    pass_count: passCount,
    auto_count: autoGates.length,
    total_count: gates.length,
    gates,
  };
}
