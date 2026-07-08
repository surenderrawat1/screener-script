import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@sv/db';
import { cacheKey, cacheSetJson } from '@sv/cache';
import {
  CACHE_PREFIX,
  CACHE_TTL,
  INDEX_DEFINITIONS,
  guessUniverseFromFilename,
  indexAgeDays,
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
  if (!INDEX_DEFINITIONS[indexKey]) {
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

  await cacheSetJson(cacheKey(CACHE_PREFIX.INDEX, indexKey), meta, CACHE_TTL.index_symbols);
  await cacheSetJson(cacheKey(CACHE_PREFIX.UNIVERSE, indexKey), unique, CACHE_TTL.universe);

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
  const def = INDEX_DEFINITIONS[indexKey];
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
  const targetKeys = keys ?? Object.keys(INDEX_DEFINITIONS);
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

export async function syncIndexFromUpload(filename: string, csv: string): Promise<IndexSyncResult> {
  const guessed = guessUniverseFromFilename(filename);
  if (!guessed) {
    return {
      ok: false,
      indexKey: '',
      count: 0,
      added: [],
      removed: [],
      sourceFile: filename,
      error: 'Could not detect index from filename',
    };
  }
  const symbols = parseIndexCsvContent(csv);
  return syncIndexUniverse(guessed, symbols, filename);
}

export async function getIndexSyncStatus() {
  const rows = await prisma.indexConstituent.groupBy({
    by: ['indexKey'],
    where: { effectiveTo: null },
    _count: { symbol: true },
    _max: { effectiveFrom: true },
  });

  const byKey = new Map(rows.map((r) => [r.indexKey, r]));

  return Object.entries(INDEX_DEFINITIONS).map(([key, def]) => {
    const row = byKey.get(key);
    const importedAt = row?._max.effectiveFrom ?? null;
    const ageDays = indexAgeDays(importedAt);
    return {
      key,
      label: def.label,
      count: row?._count.symbol ?? 0,
      importedAt: importedAt?.toISOString() ?? null,
      ageDays,
      stale: ageDays !== null && ageDays > 120,
    };
  });
}
