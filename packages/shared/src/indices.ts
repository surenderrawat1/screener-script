export interface IndexDefinition {
  label: string;
  csv: string;
  /** MW-NIFTY filename substrings (matched case-insensitively). */
  mwPatterns: string[];
  /** Optional symbol-count sanity bounds for upload/sync. */
  bounds?: { min: number; max: number };
}

export interface IndicesFileConfig {
  version: number;
  definitions: Record<string, IndexDefinition>;
}

/** Built-in defaults — also used when config is not loaded yet. */
export const DEFAULT_INDEX_DEFINITIONS: Record<string, IndexDefinition> = {
  nifty50: {
    label: 'Nifty 50',
    csv: 'ind_nifty50list.csv',
    mwPatterns: ['MW-NIFTY-50-', 'MW-NIFTY50-'],
    bounds: { min: 45, max: 55 },
  },
  nifty100: {
    label: 'Nifty 100',
    csv: 'ind_nifty100list.csv',
    mwPatterns: ['MW-NIFTY-100-', 'MW-NIFTY100-'],
    bounds: { min: 90, max: 110 },
  },
  nifty200: {
    label: 'Nifty 200',
    csv: 'ind_nifty200list.csv',
    mwPatterns: ['MW-NIFTY-200-', 'MW-NIFTY200-'],
    bounds: { min: 180, max: 220 },
  },
  nifty250: {
    label: 'Nifty LargeMidcap 250',
    csv: 'ind_niftylargemidcap250list.csv',
    mwPatterns: ['MW-NIFTY-LARGEMIDCAP-', 'MW-NIFTY-250-', 'MW-NIFTYLARGEMIDCAP250-'],
    bounds: { min: 230, max: 270 },
  },
  nifty500: {
    label: 'Nifty 500',
    csv: 'ind_nifty500list.csv',
    mwPatterns: ['MW-NIFTY-500-', 'MW-NIFTY500-'],
    bounds: { min: 480, max: 520 },
  },
  smallcap250: {
    label: 'Nifty Smallcap 250',
    csv: 'ind_niftysmallcap250list.csv',
    mwPatterns: ['MW-NIFTY-SMALLCAP-250-', 'MW-NIFTYSMALLCAP250-'],
    bounds: { min: 230, max: 270 },
  },
};

export const STALE_INDEX_DAYS = 120;

/** @deprecated Prefer getIndexDefinitions() — alias kept for older imports. */
export const INDEX_DEFINITIONS = DEFAULT_INDEX_DEFINITIONS;

/** @deprecated Prefer getIndexDefinition(key)?.bounds */
export const INDEX_SYMBOL_BOUNDS: Record<string, { min: number; max: number }> = Object.fromEntries(
  Object.entries(DEFAULT_INDEX_DEFINITIONS)
    .filter(([, d]) => d.bounds)
    .map(([k, d]) => [k, d.bounds!]),
);

type IndexDefinitionsGetter = () => Record<string, IndexDefinition>;
let indexDefinitionsGetter: IndexDefinitionsGetter | null = null;

/** Wired by config.ts after AppConfig load (avoids circular import). */
export function bindIndexDefinitionsGetter(getter: IndexDefinitionsGetter): void {
  indexDefinitionsGetter = getter;
}

export function getIndexDefinitions(): Record<string, IndexDefinition> {
  const defs = indexDefinitionsGetter?.();
  if (defs && Object.keys(defs).length > 0) return defs;
  return DEFAULT_INDEX_DEFINITIONS;
}

export function getIndexDefinition(indexKey: string): IndexDefinition | null {
  return getIndexDefinitions()[indexKey] ?? null;
}

export function listIndexKeys(): string[] {
  return Object.keys(getIndexDefinitions());
}

export function validateIndexSymbolCount(indexKey: string, count: number): string | null {
  const bounds = getIndexDefinition(indexKey)?.bounds;
  if (!bounds) return null;
  if (count >= bounds.min && count <= bounds.max) return null;
  if (indexKey === 'nifty500' && count > bounds.max) {
    return `Parsed ${count} symbols for Nifty 500 (expected ${bounds.min}–${bounds.max}). Did you upload Total Market (MW-NIFTY-TOTAL-MKT) instead of MW-NIFTY-500?`;
  }
  return `Parsed ${count} symbols for ${indexKey} (expected ${bounds.min}–${bounds.max}). Check the CSV file.`;
}

export function guessUniverseFromFilename(filename: string): string | null {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const name = base.toUpperCase();
  const definitions = getIndexDefinitions();

  for (const [key, def] of Object.entries(definitions)) {
    if (name === def.csv.toUpperCase()) return key;
  }

  const patterns = Object.entries(definitions).flatMap(([key, def]) =>
    def.mwPatterns.map((pattern) => ({ key, pattern: pattern.toUpperCase() })),
  );
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);
  for (const { key, pattern } of patterns) {
    if (name.includes(pattern)) return key;
  }

  // Legacy fallbacks for older filenames when registry is customized
  if (name.includes('NIFTY50LIST')) return definitions.nifty50 ? 'nifty50' : null;
  if (name.includes('NIFTY100LIST')) return definitions.nifty100 ? 'nifty100' : null;
  if (name.includes('NIFTY200LIST')) return definitions.nifty200 ? 'nifty200' : null;
  if (name.includes('NIFTY500LIST')) return definitions.nifty500 ? 'nifty500' : null;
  if (/LARGEMIDCAP|NIFTYLARGEMIDCAP/.test(name)) return definitions.nifty250 ? 'nifty250' : null;
  if (/SMALLCAP/.test(name)) return definitions.smallcap250 ? 'smallcap250' : null;

  return null;
}

export function indexAgeDays(importedAt: string | Date | null | undefined): number | null {
  if (!importedAt) return null;
  const ts = importedAt instanceof Date ? importedAt.getTime() : Date.parse(String(importedAt));
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

/** Normalize YAML / Admin payload into IndexDefinition map. */
export function normalizeIndexDefinitions(
  raw: Record<string, unknown> | null | undefined,
): Record<string, IndexDefinition> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, IndexDefinition> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const label = String(row.label ?? key).trim();
    const csv = String(row.csv ?? '').trim();
    const mwRaw = row.mwPatterns ?? row.mw_patterns;
    const mwPatterns = Array.isArray(mwRaw)
      ? mwRaw.map((p) => String(p).trim()).filter(Boolean)
      : [];
    const boundsRaw = row.bounds;
    let bounds: { min: number; max: number } | undefined;
    if (boundsRaw && typeof boundsRaw === 'object') {
      const b = boundsRaw as Record<string, unknown>;
      const min = Number(b.min);
      const max = Number(b.max);
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
        bounds = { min, max };
      }
    }
    if (!label || !csv) continue;
    out[key] = { label, csv, mwPatterns, ...(bounds ? { bounds } : {}) };
  }
  return out;
}
