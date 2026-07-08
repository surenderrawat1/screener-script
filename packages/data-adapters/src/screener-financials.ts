function cleanHtmlText(html: string): string {
  let text = html.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return text.replace(/\s+/g, ' ').trim();
}

export function parseSectionTable(
  html: string,
  sectionId: string,
): { periods: string[]; rows: Record<string, Record<string, number | null>> } {
  const pattern = new RegExp(`<section[^>]*\\bid="${sectionId}"[^>]*>(.*?)<\\/section>`, 'si');
  const m = html.match(pattern);
  if (!m) return { periods: [], rows: {} };

  const section = m[1];
  const table = section.match(/<thead>\s*<tr>(.*?)<\/tr>\s*<\/thead>\s*<tbody>(.*?)<\/tbody>/si);
  if (!table) return { periods: [], rows: {} };

  const periods: string[] = [];
  const headerRe = /<th[^>]*>(.*?)<\/th>/gis;
  let hm: RegExpExecArray | null;
  let headerIdx = 0;
  while ((hm = headerRe.exec(table[1])) !== null) {
    if (headerIdx++ === 0) continue;
    const label = cleanHtmlText(hm[1]);
    if (label) periods.push(label);
  }

  const rows: Record<string, Record<string, number | null>> = {};
  const trRe = /<tr[^>]*>(.*?)<\/tr>/gis;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(table[2])) !== null) {
    const rowHtml = tr[1];
    const cells = [...rowHtml.matchAll(/<td[^>]*>(.*?)<\/td>/gis)].map((c) => cleanHtmlText(c[1]));
    const label = cells[0]?.replace(/\s*\+$/, '').trim() ?? '';
    if (!label) continue;

    const values = cells.slice(1);
    const row: Record<string, number | null> = {};
    for (let i = 0; i < periods.length; i++) {
      const raw = values[i]?.trim().replace(/,/g, '') ?? '';
      if (raw === '' || raw === '-') row[periods[i]] = null;
      else if (/^-?\d+(\.\d+)?%$/.test(raw)) row[periods[i]] = parseFloat(raw);
      else if (/^-?\d+(\.\d+)?$/.test(raw)) row[periods[i]] = parseFloat(raw);
      else row[periods[i]] = null;
    }
    rows[label] = row;
  }

  return { periods, rows };
}
