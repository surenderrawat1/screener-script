import { prisma } from '@sv/db';
import type { CfaTermDto, CfaTermUpsertInput } from '@sv/shared';

function toDto(row: {
  key: string;
  category: string;
  title: string;
  definition: string;
  formula: string | null;
  example: string | null;
  phaseRefs: string[];
  relatedKeys: string[];
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
}): CfaTermDto {
  return {
    key: row.key,
    category: row.category,
    title: row.title,
    definition: row.definition,
    formula: row.formula,
    example: row.example,
    phase_refs: row.phaseRefs,
    related_keys: row.relatedKeys,
    sort_order: row.sortOrder,
    is_active: row.isActive,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listCfaTerms(options: {
  category?: string;
  activeOnly?: boolean;
  includeInactive?: boolean;
} = {}): Promise<CfaTermDto[]> {
  const rows = await prisma.cfaTerm.findMany({
    where: {
      ...(options.category ? { category: options.category } : {}),
      ...(!options.includeInactive && options.activeOnly !== false ? { isActive: true } : {}),
    },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
  });
  return rows.map(toDto);
}

export async function getCfaTerm(key: string): Promise<CfaTermDto | null> {
  const row = await prisma.cfaTerm.findUnique({ where: { key } });
  return row ? toDto(row) : null;
}

export async function upsertCfaTerm(input: CfaTermUpsertInput, userId?: string): Promise<CfaTermDto> {
  const row = await prisma.cfaTerm.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      category: input.category,
      title: input.title,
      definition: input.definition,
      formula: input.formula ?? null,
      example: input.example ?? null,
      phaseRefs: input.phaseRefs ?? [],
      relatedKeys: input.relatedKeys ?? [],
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      updatedBy: userId,
    },
    update: {
      category: input.category,
      title: input.title,
      definition: input.definition,
      formula: input.formula ?? null,
      example: input.example ?? null,
      phaseRefs: input.phaseRefs ?? [],
      relatedKeys: input.relatedKeys ?? [],
      sortOrder: input.sortOrder ?? 0,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedBy: userId,
    },
  });
  return toDto(row);
}

export async function deleteCfaTerm(key: string): Promise<boolean> {
  const row = await prisma.cfaTerm.findUnique({ where: { key } });
  if (!row) return false;
  await prisma.cfaTerm.delete({ where: { key } });
  return true;
}

export async function reseedCfaTerms(userId?: string): Promise<{ inserted: number; skipped: number }> {
  const { seedCfaTerms } = await import('@sv/db');
  const result = await seedCfaTerms(true);
  if (userId) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'cfa_terms_reseed',
        resource: 'cfa_terms',
        meta: result,
      },
    });
  }
  return result;
}

export function cfaTermCategories(terms: CfaTermDto[]): string[] {
  return [...new Set(terms.map((t) => t.category))].sort();
}
