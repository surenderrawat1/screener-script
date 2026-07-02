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
    mwPatterns: ['MW-NIFTY-250-', 'MW-NIFTYLARGEMIDCAP250-'],
  },
  nifty500: {
    label: 'Nifty 500',
    csv: 'ind_nifty500list.csv',
    mwPatterns: ['MW-NIFTY-500-', 'MW-NIFTY500-', 'MW-NIFTY-TOTAL-MKT-'],
  },
  smallcap250: {
    label: 'Nifty Smallcap 250',
    csv: 'ind_niftysmallcap250list.csv',
    mwPatterns: ['MW-NIFTY-SMALLCAP-250-', 'MW-NIFTYSMALLCAP250-'],
  },
};

export const STALE_INDEX_DAYS = 120;

export function guessUniverseFromFilename(filename: string): string | null {
  const name = filename.toUpperCase();
  if (/NIFTY[-_]?50(?:[^0-9]|$)/.test(name) || name.includes('NIFTY50LIST')) return 'nifty50';
  if (/NIFTY[-_]?100(?:[^0-9]|$)/.test(name) || name.includes('NIFTY100LIST')) return 'nifty100';
  if (/LARGEMIDCAP250|NIFTY[-_]?250/.test(name)) return 'nifty250';
  if (/NIFTY[-_]?500(?:[^0-9]|$)/.test(name) || name.includes('NIFTY500LIST')) return 'nifty500';
  if (/TOTAL-MKT|TOTALMARKET/.test(name)) return 'nifty500';
  if (/SMALLCAP[-_]?250|SMALLCAP250/.test(name)) return 'smallcap250';
  return null;
}

export function indexAgeDays(importedAt: string | Date | null | undefined): number | null {
  if (!importedAt) return null;
  const ts = importedAt instanceof Date ? importedAt.getTime() : Date.parse(String(importedAt));
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}
