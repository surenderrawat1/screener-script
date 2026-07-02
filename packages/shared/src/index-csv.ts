const SYMBOL_RE = /^[A-Z][A-Z0-9.&-]{0,19}$/;

export function isValidIndexSymbol(sym: string): boolean {
  return SYMBOL_RE.test(sym) && sym !== 'SYMBOL';
}

export function stripBom(csv: string): string {
  return csv.replace(/^\uFEFF/, '');
}

function parseCsvRows(csv: string): string[][] {
  const lines = stripBom(csv).split(/\r?\n/).filter((l) => l.trim());
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

function looksLikeMarketWatchCsv(csv: string): boolean {
  return csv.includes('LTP') && /^"[A-Z][A-Z0-9.&-]+","[\d.]/m.test(csv);
}

function parseMarketWatchCsv(csv: string): string[] {
  const matches = csv.matchAll(/^"([A-Z][A-Z0-9.&-]+)","[\d.]/gm);
  const symbols = new Set<string>();
  for (const m of matches) {
    const sym = m[1]?.toUpperCase().trim();
    if (sym && isValidIndexSymbol(sym)) symbols.add(sym);
  }
  return [...symbols];
}

function detectSymbolColumn(header: string[]): { index: number; hasHeader: boolean } {
  const normalized = header.map((h) => h.toLowerCase().replace(/\s+/g, ''));
  const idx = normalized.findIndex((h) =>
    ['symbol', 'ticker', 'scrip', 'securitysymbol'].some((k) => h.includes(k)),
  );
  if (idx >= 0) return { index: idx, hasHeader: true };
  return { index: 0, hasHeader: header.some((h) => /symbol|ticker/i.test(h)) };
}

export function parseIndexCsvContent(csv: string): string[] {
  const body = stripBom(csv);
  if (!body.trim()) return [];

  if (looksLikeMarketWatchCsv(body)) {
    return parseMarketWatchCsv(body);
  }

  const rows = parseCsvRows(body);
  if (rows.length === 0) return [];

  const { index, hasHeader } = detectSymbolColumn(rows[0] ?? []);
  const start = hasHeader ? 1 : 0;
  const symbols = new Set<string>();

  for (let i = start; i < rows.length; i++) {
    const sym = (rows[i]?.[index] ?? '').toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
    if (isValidIndexSymbol(sym)) symbols.add(sym);
  }

  return [...symbols];
}
