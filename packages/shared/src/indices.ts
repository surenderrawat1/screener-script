export const INDEX_DEFINITIONS: Record<string, { label: string; csv: string; mwPatterns: string[] }> = {
  nifty50: {
    label: 'Nifty 50',
    csv: 'ind_nifty50list.csv',
    mwPatterns: ['MW-NIFTY-50-', 'MW-NIFTY50-'],
  },
  nifty100: {
    label: 'Nifty 100',
    csv: 'ind_nifty100list.csv',
    mwPatterns: ['MW-NIFTY-100-', 'MW-NIFTY100-'],
  },
  nifty250: {
    label: 'Nifty LargeMidcap 250',
    csv: 'ind_niftylargemidcap250list.csv',
    mwPatterns: ['MW-NIFTY-LARGEMIDCAP-', 'MW-NIFTY-250-', 'MW-NIFTYLARGEMIDCAP250-'],
  },
  nifty500: {
    label: 'Nifty 500',
    csv: 'ind_nifty500list.csv',
    mwPatterns: ['MW-NIFTY-500-', 'MW-NIFTY500-'],
  },
  smallcap250: {
    label: 'Nifty Smallcap 250',
    csv: 'ind_niftysmallcap250list.csv',
    mwPatterns: ['MW-NIFTY-SMALLCAP-250-', 'MW-NIFTYSMALLCAP250-'],
  },
};

export const STALE_INDEX_DAYS = 120;

/** Reject wrong index CSVs (e.g. Total Market ~750 uploaded as Nifty 500). */
export const INDEX_SYMBOL_BOUNDS: Record<string, { min: number; max: number }> = {
  nifty50: { min: 45, max: 55 },
  nifty100: { min: 90, max: 110 },
  nifty250: { min: 230, max: 270 },
  nifty500: { min: 480, max: 520 },
  smallcap250: { min: 230, max: 270 },
};

export function validateIndexSymbolCount(indexKey: string, count: number): string | null {
  const bounds = INDEX_SYMBOL_BOUNDS[indexKey];
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

  for (const [key, def] of Object.entries(INDEX_DEFINITIONS)) {
    if (name === def.csv.toUpperCase()) return key;
  }

  const patterns = Object.entries(INDEX_DEFINITIONS).flatMap(([key, def]) =>
    def.mwPatterns.map((pattern) => ({ key, pattern: pattern.toUpperCase() })),
  );
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);
  for (const { key, pattern } of patterns) {
    if (name.includes(pattern)) return key;
  }

  if (name.includes('NIFTY50LIST')) return 'nifty50';
  if (name.includes('NIFTY100LIST')) return 'nifty100';
  if (name.includes('NIFTY500LIST')) return 'nifty500';
  if (/LARGEMIDCAP|NIFTYLARGEMIDCAP/.test(name)) return 'nifty250';
  if (/SMALLCAP/.test(name)) return 'smallcap250';

  return null;
}

export function indexAgeDays(importedAt: string | Date | null | undefined): number | null {
  if (!importedAt) return null;
  const ts = importedAt instanceof Date ? importedAt.getTime() : Date.parse(String(importedAt));
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}
