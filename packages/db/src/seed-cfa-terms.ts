import { prisma } from './index.js';
import { CFA_TERM_DEFAULTS } from './cfa-terms-defaults.js';

/** Insert default CFA glossary terms (skip existing keys). */
export async function seedCfaTerms(force = false): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const term of CFA_TERM_DEFAULTS) {
    const exists = await prisma.cfaTerm.findUnique({ where: { key: term.key } });
    if (exists && !force) {
      skipped++;
      continue;
    }
    await prisma.cfaTerm.upsert({
      where: { key: term.key },
      create: {
        key: term.key,
        category: term.category,
        title: term.title,
        definition: term.definition,
        formula: term.formula ?? null,
        example: term.example ?? null,
        phaseRefs: term.phaseRefs ?? [],
        relatedKeys: term.relatedKeys ?? [],
        sortOrder: term.sortOrder ?? 0,
        isActive: true,
      },
      update: force
        ? {
            category: term.category,
            title: term.title,
            definition: term.definition,
            formula: term.formula ?? null,
            example: term.example ?? null,
            phaseRefs: term.phaseRefs ?? [],
            relatedKeys: term.relatedKeys ?? [],
            sortOrder: term.sortOrder ?? 0,
          }
        : {},
    });
    if (!exists || force) inserted++;
    else skipped++;
  }

  return { inserted, skipped };
}
