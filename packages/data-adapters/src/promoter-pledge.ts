import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PromoterPledgeRow {
  pct: number;
  as_of: string;
  source: string;
}

let csvIndex: Map<string, PromoterPledgeRow> | null = null;

function pledgeDataDir(): string {
  return resolve(process.cwd(), '../stock-verifier/data/pledge');
}

function parsePct(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function loadCsvIndex(): Map<string, PromoterPledgeRow> {
  if (csvIndex) return csvIndex;
  csvIndex = new Map();
  const csvPath = resolve(pledgeDataDir(), 'pledge.csv');
  if (!existsSync(csvPath)) return csvIndex;

  const text = readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return csvIndex;

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const symIdx = header.indexOf('symbol');
  let pctIdx = header.indexOf('promoter_pledge_pct');
  if (pctIdx < 0) pctIdx = header.indexOf('pledge_pct');
  if (pctIdx < 0) pctIdx = header.indexOf('pct');
  const asOfIdx = header.indexOf('as_of');
  if (symIdx < 0 || pctIdx < 0) return csvIndex;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const sym = (cols[symIdx] ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    const pct = parsePct(cols[pctIdx]);
    if (!sym || pct === null) continue;
    csvIndex.set(sym, {
      pct,
      as_of: asOfIdx >= 0 ? String(cols[asOfIdx] ?? '').trim() : '',
      source: 'csv',
    });
  }
  return csvIndex;
}

export function getPromoterPledge(symbol: string): PromoterPledgeRow | null {
  const sym = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '').split('.')[0] ?? '';
  if (!sym) return null;

  const jsonPath = resolve(pledgeDataDir(), `${sym}.json`);
  if (existsSync(jsonPath)) {
    try {
      const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
      const pct = parsePct(json.promoter_pledge_pct ?? json.pct);
      if (pct !== null) {
        return {
          pct,
          as_of: String(json.as_of ?? '').trim(),
          source: 'json',
        };
      }
    } catch {
      /* fall through */
    }
  }

  return loadCsvIndex().get(sym) ?? null;
}

/** Test helper */
export function resetPromoterPledgeCache(): void {
  csvIndex = null;
}
