import { prisma } from '@sv/db';

export async function listVerificationHistory(userId: string | undefined, limit = 50) {
  const runs = await prisma.verificationRun.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    select: {
      id: true,
      symbol: true,
      mode: true,
      createdAt: true,
      result: true,
    },
  });

  return {
    runs: runs.map((run) => {
      const result = run.result as {
        analysis?: { mos?: number | null; recommendation?: string; quality_score?: number };
      };
      return {
        id: run.id,
        symbol: run.symbol,
        mode: run.mode,
        createdAt: run.createdAt.toISOString(),
        mos: result.analysis?.mos ?? null,
        recommendation: result.analysis?.recommendation ?? '',
        quality_score: result.analysis?.quality_score ?? 0,
      };
    }),
  };
}

export async function getVerificationRun(id: string, userId?: string) {
  const run = await prisma.verificationRun.findFirst({
    where: userId ? { id, userId } : { id },
  });
  return run;
}
