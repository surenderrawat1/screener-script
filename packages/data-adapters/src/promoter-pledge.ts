import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@sv/db';

export interface PromoterPledgeRow {
  pct: number;
  as_of: string;
  source: string;
}

let csvIndex: Map<string, PromoterPledgeRow> | null = null;

function candidatePledgeDirs(): string[] {
  const envDir = process.env.SV_PLEDGE_DATA_DIR?.trim();
  const cwd = process.cwd();
  return [
    ...(envDir ? [envDir] : []),
    resolve(cwd, 'data/pledge'),
    resolve(cwd, '../stock-verifier/data/pledge'),
    resolve(cwd, '../../stock-verifier/data/pledge'),
    resolve(cwd, '../../../stock-verifier/data/pledge'),
  ];
}

function pledgeDataDir(): string | null {
  for (const dir of candidatePledgeDirs()) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

export function parsePct(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

export function normalizePledgeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '').split('.')[0] ?? '';
}

function loadCsvIndex(): Map<string, PromoterPledgeRow> {
  if (csvIndex) return csvIndex;
  csvIndex = new Map();
  const dir = pledgeDataDir();
  if (!dir) return csvIndex;

  const csvPath = resolve(dir, 'pledge.csv');
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
    const sym = normalizePledgeSymbol(cols[symIdx] ?? '');
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

/** File/JSON overlay from PHP-compatible data/pledge (no DB). */
export function getPromoterPledgeFromFiles(symbol: string): PromoterPledgeRow | null {
  const sym = normalizePledgeSymbol(symbol);
  if (!sym) return null;

  const dir = pledgeDataDir();
  if (dir) {
    const jsonPath = resolve(dir, `${sym}.json`);
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
  }

  return loadCsvIndex().get(sym) ?? null;
}

/** Synchronous file lookup — kept for PHP-parity helpers / tests. */
export function getPromoterPledge(symbol: string): PromoterPledgeRow | null {
  return getPromoterPledgeFromFiles(symbol);
}

/** DB upload warehouse first, then file/CSV overlay. */
export async function resolvePromoterPledge(symbol: string): Promise<PromoterPledgeRow | null> {
  const sym = normalizePledgeSymbol(symbol);
  if (!sym) return null;

  try {
    const row = await prisma.promoterPledge.findUnique({ where: { symbol: sym } });
    if (row) {
      return {
        pct: row.pledgePct,
        as_of: row.asOf.toISOString().slice(0, 10),
        source: row.source || 'upload',
      };
    }
  } catch {
    /* DB optional in tests / early boot */
  }

  return getPromoterPledgeFromFiles(sym);
}

export async function promoterPledgeSummary(): Promise<{ count: number; as_of: string }> {
  try {
    const [count, latest] = await Promise.all([
      prisma.promoterPledge.count(),
      prisma.promoterPledge.findFirst({ orderBy: { asOf: 'desc' }, select: { asOf: true } }),
    ]);
    if (count > 0) {
      return {
        count,
        as_of: latest?.asOf ? latest.asOf.toISOString().slice(0, 10) : '',
      };
    }
  } catch {
    /* fall through to files */
  }

  const index = loadCsvIndex();
  let asOf = '';
  for (const row of index.values()) {
    if (row.as_of && (!asOf || row.as_of > asOf)) asOf = row.as_of;
  }
  return { count: index.size, as_of: asOf };
}

/** Test helper */
export function resetPromoterPledgeCache(): void {
  csvIndex = null;
}
