/**
 * Import PHP JSON stores into PostgreSQL.
 *
 * Usage:
 *   pnpm migrate:php -- --user admin@example.com
 *   pnpm migrate:php -- --user admin@example.com --watchlist ../stock-verifier/data/watchlist.json
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/index.js';

const DEFAULT_PHP_DATA = resolve(import.meta.dirname, '../../../../stock-verifier/data');

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function normalizeTicker(candidate: string): string | null {
  const s = candidate.trim().toUpperCase().replace(/\.(NS|BO)$/, '').split('.')[0] ?? '';
  if (/^[A-Z][A-Z0-9.&-]{1,19}$/.test(s)) return s;
  return null;
}

async function resolveSymbol(key: string, entry: Record<string, unknown>): Promise<string> {
  for (const field of [entry.symbol, entry.stock_name, key]) {
    const ticker = normalizeTicker(String(field ?? ''));
    if (ticker) return ticker;
  }

  const name = String(entry.stock_name ?? entry.symbol ?? key).toLowerCase();
  const nseRows = await prisma.nseEquity.findMany({
    where: { name: { not: null } },
    select: { symbol: true, name: true },
    take: 5000,
  });
  for (const row of nseRows) {
    const n = (row.name ?? '').toLowerCase();
    if (n && (n.includes(name) || name.includes(n))) return row.symbol;
  }

  return key.slice(0, 32).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

async function importWatchlist(userId: string, filePath: string) {
  if (!existsSync(filePath)) {
    console.log(`Skip watchlist — not found: ${filePath}`);
    return 0;
  }

  const json = JSON.parse(readFileSync(filePath, 'utf8')) as {
    entries?: Record<string, Record<string, unknown>>;
  };

  let watchlist = await prisma.watchlist.findFirst({ where: { userId, name: 'Main' } });
  if (!watchlist) {
    watchlist = await prisma.watchlist.create({ data: { userId, name: 'Main' } });
  }

  let count = 0;
  for (const [key, entry] of Object.entries(json.entries ?? {})) {
    const symbol = await resolveSymbol(key, entry);
    await prisma.watchlistItem.upsert({
      where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol } },
      create: {
        watchlistId: watchlist.id,
        symbol,
        meta: { ...entry, php_key: key },
      },
      update: {
        meta: { ...entry, php_key: key },
      },
    });
    count += 1;
  }

  console.log(`Watchlist: imported ${count} entries`);
  return count;
}

async function importSwingPositions(userId: string, filePath: string) {
  if (!existsSync(filePath)) {
    console.log(`Skip swing positions — not found: ${filePath}`);
    return 0;
  }

  const json = JSON.parse(readFileSync(filePath, 'utf8')) as {
    positions?: Record<string, unknown>[];
  };

  let count = 0;
  for (const raw of json.positions ?? []) {
    const pos = raw as Record<string, unknown>;
    const id = String(pos.id ?? '').replace(/[^a-f0-9]/gi, '').slice(0, 32);
    const symbol = normalizeTicker(String(pos.symbol ?? ''));
    const entryPrice = Number(pos.entry_price ?? 0);
    const entryDate = String(pos.entry_date ?? '').slice(0, 10);
    if (!id || !symbol || entryPrice <= 0 || !entryDate) continue;

    await prisma.swingPosition.upsert({
      where: { id },
      create: {
        id,
        userId,
        symbol,
        status: pos.status === 'closed' ? 'closed' : 'open',
        entryPrice,
        entryDate: new Date(entryDate),
        shares: Number(pos.shares ?? 0) || null,
        stopLoss: pos.stop_loss != null ? Number(pos.stop_loss) : null,
        profitTarget: pos.profit_target != null ? Number(pos.profit_target) : null,
        notes: String(pos.notes ?? '') || null,
        highestSinceEntry: pos.highest_since_entry != null ? Number(pos.highest_since_entry) : null,
        trailedStopLoss: pos.trailed_stop_loss != null ? Number(pos.trailed_stop_loss) : null,
        closedAt: pos.closed_at ? new Date(String(pos.closed_at)) : null,
        closedPrice: pos.closed_price != null ? Number(pos.closed_price) : null,
        closedReason: String(pos.closed_reason ?? '') || null,
        source: String(pos.source ?? 'php_import') || null,
        createdAt: pos.created_at ? new Date(String(pos.created_at)) : undefined,
        updatedAt: pos.updated_at ? new Date(String(pos.updated_at)) : undefined,
      },
      update: {
        userId,
        symbol,
        status: pos.status === 'closed' ? 'closed' : 'open',
        entryPrice,
        entryDate: new Date(entryDate),
        shares: Number(pos.shares ?? 0) || null,
        stopLoss: pos.stop_loss != null ? Number(pos.stop_loss) : null,
        profitTarget: pos.profit_target != null ? Number(pos.profit_target) : null,
        notes: String(pos.notes ?? '') || null,
        highestSinceEntry: pos.highest_since_entry != null ? Number(pos.highest_since_entry) : null,
        trailedStopLoss: pos.trailed_stop_loss != null ? Number(pos.trailed_stop_loss) : null,
        closedAt: pos.closed_at ? new Date(String(pos.closed_at)) : null,
        closedPrice: pos.closed_price != null ? Number(pos.closed_price) : null,
        closedReason: String(pos.closed_reason ?? '') || null,
        source: String(pos.source ?? 'php_import') || null,
      },
    });
    count += 1;
  }

  console.log(`Swing positions: imported ${count} rows`);
  return count;
}

async function main() {
  const email = argValue('--user') ?? process.env.MIGRATE_USER_EMAIL ?? 'admin@example.com';
  const dataDir = argValue('--data-dir') ?? DEFAULT_PHP_DATA;
  const watchlistPath = argValue('--watchlist') ?? resolve(dataDir, 'watchlist.json');
  const positionsPath = argValue('--positions') ?? resolve(dataDir, 'swing_positions.json');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  console.log(`Migrating PHP data for ${email} (${user.id})`);
  await importWatchlist(user.id, watchlistPath);
  await importSwingPositions(user.id, positionsPath);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
