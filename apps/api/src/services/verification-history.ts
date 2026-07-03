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
      const result = run.result as Record<string, unknown>;
      if (run.mode === 'full') {
        const r = result as {
          scorecard?: { total?: number };
          verdict?: { action?: string };
          metrics?: { margin_of_safety?: number };
          investment_ready?: { ready?: boolean };
        };
        return {
          id: run.id,
          symbol: run.symbol,
          mode: run.mode,
          createdAt: run.createdAt.toISOString(),
          mos: r.metrics?.margin_of_safety ?? null,
          recommendation: r.verdict?.action ?? '',
          quality_score: r.scorecard?.total ?? 0,
          investment_ready: r.investment_ready?.ready ?? false,
        };
      }
      const cfa = result as {
        analysis?: { mos?: number | null; recommendation?: string; quality_score?: number };
      };
      return {
        id: run.id,
        symbol: run.symbol,
        mode: run.mode,
        createdAt: run.createdAt.toISOString(),
        mos: cfa.analysis?.mos ?? null,
        recommendation: cfa.analysis?.recommendation ?? '',
        quality_score: cfa.analysis?.quality_score ?? 0,
        investment_ready: false,
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
