import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@sv/db', () => ({
  prisma: {
    job: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  JobStatus: { pending: 'pending', running: 'running', done: 'done', failed: 'failed' },
  JobType: { daily_close: 'daily_close' },
}));

vi.mock('@sv/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sv/shared')>();
  return {
    ...actual,
    getSchedules: vi.fn(() => ({
      daily_sync: {
        enabled: true,
        cron: '0 6 * * *',
        timezone: 'Asia/Kolkata',
        skip_if_completed_today: true,
        steps: [],
      },
    })),
    getDataPolicy: vi.fn(() => ({
      prefetch: { enabled: false, universes: [], include_open_positions: false, max_symbols_per_batch: 50, delay_ms_between_batches: 0 },
    })),
    isDailyCronDue: vi.fn(() => false),
    dateKeyInTimezone: vi.fn(() => '2026-07-02'),
  };
});

import { prisma } from '@sv/db';
import { isDailyCronDue } from '@sv/shared';
import { hasCompletedDailySyncToday, tickDailySync } from './daily-sync.js';

describe('daily-sync scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hasCompletedDailySyncToday returns true when job finished today', async () => {
    vi.mocked(prisma.job.findFirst).mockResolvedValue({
      finishedAt: new Date(),
    } as never);
    await expect(hasCompletedDailySyncToday('Asia/Kolkata')).resolves.toBe(true);
  });

  it('tickDailySync skips when cron not due', async () => {
    vi.mocked(isDailyCronDue).mockReturnValue(false);
    await expect(tickDailySync()).resolves.toBeNull();
  });
});
