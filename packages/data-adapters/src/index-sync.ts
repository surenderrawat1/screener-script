import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@sv/db';
import { cacheKey, cacheSetJson } from '@sv/cache';
import {
  CACHE_PREFIX,
  getCacheTtl,
  getDataPolicy,
  getIndexDefinition,
  getIndexDefinitions,
  guessUniverseFromFilename,
  indexAgeDays,
  listIndexKeys,
  parseIndexCsvContent,
  validateIndexSymbolCount,
} from '@sv/shared';

export type IndexSyncResult = {
  ok: boolean;
  indexKey: string;
  count: number;
  added: string[];
  removed: string[];
  sourceFile: string;
  error?: string;
};

export async function syncIndexUniverse(
  indexKey: string,
  symbols: string[],
  sourceFile: string,
): Promise<IndexSyncResult> {
  const def = getIndexDefinition(indexKey);
  if (!def) {
    return { ok: false, indexKey, count: 0, added: [], removed: [], sourceFile, error: 'Unknown index' };
  }
  if (symbols.length === 0) {
    return { ok: false, indexKey, count: 0, added: [], removed: [], sourceFile, error: 'No symbols parsed' };
  }

  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].sort();
  const boundsError = validateIndexSymbolCount(indexKey, unique.length);
  if (boundsError) {
    return { ok: false, indexKey, count: unique.length, added: [], removed: [], sourceFile, error: boundsError };
  }
  const now = new Date();

  const previous = await prisma.indexConstituent.findMany({
    where: { indexKey, effectiveTo: null },
    select: { symbol: true },
  });
  const prevSet = new Set(previous.map((r) => r.symbol));
  const nextSet = new Set(unique);
  const added = unique.filter((s) => !prevSet.has(s));
  const removed = [...prevSet].filter((s) => !nextSet.has(s));

  await prisma.$transaction(async (tx) => {
    await tx.universe.upsert({
      where: { key: indexKey },
      create: { key: indexKey, name: def.label, type: 'builtin' },
      update: { name: def.label },
    });

    if (removed.length > 0) {
      await tx.indexConstituent.updateMany({
        where: { indexKey, symbol: { in: removed }, effectiveTo: null },
        data: { effectiveTo: now },
      });
    }

    if (added.length > 0) {
      await tx.indexConstituent.createMany({
        data: added.map((symbol) => ({ indexKey, symbol, effectiveFrom: now })),
      });
    }

    const universe = await tx.universe.findUnique({ where: { key: indexKey } });
    if (universe) {
      await tx.universeSymbol.deleteMany({ where: { universeId: universe.id } });
      await tx.universeSymbol.createMany({
        data: unique.map((symbol) => ({ universeId: universe.id, symbol })),
      });
    }
  });

  const meta = {
    indexKey,
    count: unique.length,
    sourceFile,
    importedAt: now.toISOString(),
    added: added.length,
    removed: removed.length,
  };

  const ttl = getCacheTtl();
  await cacheSetJson(cacheKey(CACHE_PREFIX.INDEX, indexKey), meta, ttl.index_symbols);
  await cacheSetJson(cacheKey(CACHE_PREFIX.UNIVERSE, indexKey), unique, ttl.universe);

  return {
    ok: true,
    indexKey,
    count: unique.length,
    added,
    removed,
    sourceFile,
  };
}

export async function syncIndexFromCsvFile(indexKey: string, filePath: string): Promise<IndexSyncResult> {
  const body = readFileSync(filePath, 'utf8');
  const symbols = parseIndexCsvContent(body);
  return syncIndexUniverse(indexKey, symbols, filePath);
}

export function resolveIndexCsvPath(indicesDir: string, indexKey: string): string | null {
  const def = getIndexDefinition(indexKey);
  if (!def) return null;

  const candidates: { path: string; mtime: number }[] = [];
  const canonical = join(indicesDir, def.csv);
  try {
    if (statSync(canonical).isFile()) {
      candidates.push({ path: canonical, mtime: statSync(canonical).mtimeMs });
    }
  } catch {
    /* missing */
  }

  let files: string[] = [];
  try {
    files = readdirSync(indicesDir);
  } catch {
    return candidates[0]?.path ?? null;
  }

  for (const file of files) {
    if (!file.toLowerCase().endsWith('.csv')) continue;
    const upper = file.toUpperCase();
    const matchesMw = def.mwPatterns.some((p) => upper.includes(p.toUpperCase()));
    const matchesCanonical = file === def.csv;
    if (!matchesMw && !matchesCanonical) continue;
    const full = join(indicesDir, file);
    try {
      candidates.push({ path: full, mtime: statSync(full).mtimeMs });
    } catch {
      /* skip */
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

export async function syncAllIndicesFromDirectory(indicesDir: string, keys?: string[]) {
  const targetKeys = keys?.length ? keys : listIndexKeys();
  const results: IndexSyncResult[] = [];

  for (const indexKey of targetKeys) {
    const path = resolveIndexCsvPath(indicesDir, indexKey);
    if (!path) {
      results.push({
        ok: false,
        indexKey,
        count: 0,
        added: [],
        removed: [],
        sourceFile: '',
        error: 'No CSV found',
      });
      continue;
    }
    results.push(await syncIndexFromCsvFile(indexKey, path));
  }

  return results;
}

export async function syncIndexFromUpload(
  filename: string,
  csv: string,
  indexKeyOverride?: string,
): Promise<IndexSyncResult> {
  const guessed = indexKeyOverride?.trim() || guessUniverseFromFilename(filename);
  if (!guessed) {
    return {
      ok: false,
      indexKey: '',
      count: 0,
      added: [],
      removed: [],
      sourceFile: filename,
      error: 'Could not detect index from filename — pick an index key or add a registry entry',
    };
  }
  if (!getIndexDefinition(guessed)) {
    return {
      ok: false,
      indexKey: guessed,
      count: 0,
      added: [],
      removed: [],
      sourceFile: filename,
      error: `Unknown index key "${guessed}" — add it in Admin index registry first`,
    };
  }
  const symbols = parseIndexCsvContent(csv);
  return syncIndexUniverse(guessed, symbols, filename);
}

export async function getIndexSyncStatus() {
  const definitions = getIndexDefinitions();
  const rows = await prisma.indexConstituent.groupBy({
    by: ['indexKey'],
    where: { effectiveTo: null },
    _count: { symbol: true },
    _max: { effectiveFrom: true },
  });

  const byKey = new Map(rows.map((r) => [r.indexKey, r]));
  const keys = new Set([...Object.keys(definitions), ...byKey.keys()]);
  const staleDays = getDataPolicy().staleness?.index_max_age_days ?? 90;

  return [...keys].sort().map((key) => {
    const def = definitions[key];
    const row = byKey.get(key);
    const importedAt = row?._max.effectiveFrom ?? null;
    const ageDays = indexAgeDays(importedAt);
    return {
      key,
      label: def?.label ?? key,
      csv: def?.csv ?? null,
      mwPatterns: def?.mwPatterns ?? [],
      bounds: def?.bounds ?? null,
      registered: Boolean(def),
      count: row?._count.symbol ?? 0,
      importedAt: importedAt?.toISOString() ?? null,
      ageDays,
      stale: ageDays !== null && ageDays > staleDays,
    };
  });
}
