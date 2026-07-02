import { prisma } from '@sv/db';
import {
  getIndexSyncStatus,
  syncAllIndicesFromDirectory,
  syncIndexFromUpload,
} from '@sv/data-adapters';
import { resolve } from 'node:path';

export function parseCsvRows(content: string): string[][] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const row: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    row.push(cur.trim());
    return row;
  });
}

export function parseNseSymbols(csv: string): string[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.toLowerCase());
  let col = header.indexOf('symbol');
  if (col < 0) col = header.indexOf('ticker');
  if (col < 0) col = 0;

  const start = header.some((h) => ['symbol', 'ticker', 'name'].includes(h)) ? 1 : 0;
  const symbols = new Set<string>();

  for (let i = start; i < rows.length; i++) {
    const sym = (rows[i][col] ?? '').toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
    if (sym.length >= 2 && sym.length <= 20) symbols.add(sym);
  }

  return [...symbols];
}

export interface HoldingRow {
  symbol: string;
  holdingPct: number;
  asOf: Date | null;
}

export function parsePromoterHoldingCsv(csv: string): HoldingRow[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.toLowerCase());
  const symIdx = header.indexOf('symbol');
  let pctIdx = header.indexOf('promoter_holding_pct');
  if (pctIdx < 0) pctIdx = header.indexOf('promoter_holding');
  if (pctIdx < 0) pctIdx = header.indexOf('holding');
  if (pctIdx < 0) pctIdx = header.indexOf('pct');
  const asOfIdx = header.indexOf('as_of');

  if (symIdx < 0 || pctIdx < 0) return [];

  const out: HoldingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const symbol = (rows[i][symIdx] ?? '').toUpperCase().replace(/\.(NS|BO)$/, '');
    const pct = parseFloat((rows[i][pctIdx] ?? '').replace(/[^0-9.-]/g, ''));
    if (!symbol || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    const asOfRaw = asOfIdx >= 0 ? rows[i][asOfIdx] : '';
    const asOf = asOfRaw ? new Date(asOfRaw) : null;
    out.push({ symbol, holdingPct: Math.round(pct * 100) / 100, asOf });
  }
  return out;
}

export async function importNseEquityCsv(csv: string) {
  const symbols = parseNseSymbols(csv);
  if (symbols.length === 0) {
    return { success: false, imported: 0, error: 'No valid NSE symbols found' };
  }

  await prisma.nseEquity.deleteMany();
  await prisma.nseEquity.createMany({
    data: symbols.map((symbol) => ({ symbol })),
    skipDuplicates: true,
  });

  const universe = await prisma.universe.findUnique({ where: { key: 'total_nse' } });
  if (universe) {
    await prisma.universeSymbol.deleteMany({ where: { universeId: universe.id } });
    await prisma.universeSymbol.createMany({
      data: symbols.map((symbol) => ({ universeId: universe.id, symbol })),
      skipDuplicates: true,
    });
  }

  return { success: true, imported: symbols.length };
}

export async function importPromoterHoldingCsv(csv: string) {
  const rows = parsePromoterHoldingCsv(csv);
  if (rows.length === 0) {
    return { success: false, imported: 0, error: 'No valid holding rows' };
  }

  for (const row of rows) {
    await prisma.promoterHolding.upsert({
      where: { symbol: row.symbol },
      create: {
        symbol: row.symbol,
        holdingPct: row.holdingPct,
        asOf: row.asOf ?? new Date(),
        source: 'upload',
      },
      update: {
        holdingPct: row.holdingPct,
        asOf: row.asOf ?? new Date(),
        source: 'upload',
      },
    });
  }

  return { success: true, imported: rows.length };
}

export async function getAdminStats() {
  const [nseCount, holdingCount, universes] = await Promise.all([
    prisma.nseEquity.count(),
    prisma.promoterHolding.count(),
    prisma.universe.findMany({ include: { _count: { select: { symbols: true } } } }),
  ]);

  return {
    nse_equity_count: nseCount,
    promoter_holding_count: holdingCount,
    universes: universes.map((u) => ({
      key: u.key,
      name: u.name,
      symbolCount: u._count.symbols,
    })),
  };
}

function defaultIndicesDir() {
  return (
    process.env.INDICES_DIR ??
    resolve(process.cwd(), '../stock-verifier/data/indices')
  );
}

export async function getIndexStatus() {
  return getIndexSyncStatus();
}

export async function syncIndicesFromDisk(keys?: string[]) {
  const dir = defaultIndicesDir();
  const results = await syncAllIndicesFromDirectory(dir, keys);
  const ok = results.filter((r) => r.ok);
  return {
    success: ok.length > 0,
    indicesDir: dir,
    results,
    synced: ok.length,
    total: results.length,
  };
}

export async function importIndexCsv(filename: string, csv: string) {
  const result = await syncIndexFromUpload(filename, csv);
  if (!result.ok) {
    return { success: false, error: result.error ?? 'Index sync failed', result };
  }
  return { success: true, ...result };
}
