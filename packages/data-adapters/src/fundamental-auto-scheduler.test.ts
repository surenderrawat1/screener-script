import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSchedules = vi.fn();
const mockShouldStart = vi.fn();
const mockRunScan = vi.fn();
const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();

vi.mock('@sv/shared', () => ({
  getSchedules: () => mockGetSchedules(),
}));

vi.mock('./fundamental-auto-scan.js', () => ({
  LTG_AUTO_SCAN_LOCK_KEY: 'sv:ltg:auto:SCAN:LOCK',
  shouldStartLtgAutoScan: (...args: unknown[]) => mockShouldStart(...args),
  runFundamentalAutoScan: (...args: unknown[]) => mockRunScan(...args),
  getFundamentalAutoState: vi.fn(),
}));

vi.mock('@sv/cache', () => ({
  acquireCacheLock: (...args: unknown[]) => mockAcquireLock(...args),
  releaseCacheLock: (...args: unknown[]) => mockReleaseLock(...args),
}));

describe('tickFundamentalAutoScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSchedules.mockReturnValue({
      intraday: {
        ltg_auto_scan: {
          enabled: true,
          interval_sec: 900,
          universe: 'nifty250',
          max_scan: 250,
        },
      },
    });
    mockAcquireLock.mockResolvedValue('lock-token');
    mockReleaseLock.mockResolvedValue(undefined);
  });

  it('returns null when schedule disabled', async () => {
    mockGetSchedules.mockReturnValue({
      intraday: { ltg_auto_scan: { enabled: false } },
    });
    const { tickFundamentalAutoScan } = await import('./fundamental-auto-scheduler.js');
    await expect(tickFundamentalAutoScan()).resolves.toBeNull();
  });

  it('returns null when scan not due', async () => {
    mockShouldStart.mockResolvedValue(false);
    const { tickFundamentalAutoScan } = await import('./fundamental-auto-scheduler.js');
    await expect(tickFundamentalAutoScan()).resolves.toBeNull();
    expect(mockRunScan).not.toHaveBeenCalled();
  });

  it('returns null when lock held', async () => {
    mockShouldStart.mockResolvedValue(true);
    mockAcquireLock.mockResolvedValue(null);
    const { tickFundamentalAutoScan } = await import('./fundamental-auto-scheduler.js');
    await expect(tickFundamentalAutoScan()).resolves.toBeNull();
    expect(mockRunScan).not.toHaveBeenCalled();
  });

  it('runs scan when due and lock acquired', async () => {
    mockShouldStart.mockResolvedValue(true);
    mockRunScan.mockResolvedValue({
      ok: true,
      result: {
        ok: true,
        scanned: 250,
        buy_eligible: 12,
        duration_ms: 1200,
        snapshot: { available: true, saved_at: '2026-08-14T00:00:00.000Z' },
      },
    });

    const { tickFundamentalAutoScan } = await import('./fundamental-auto-scheduler.js');
    const result = await tickFundamentalAutoScan();

    expect(result).toMatchObject({
      scanned: 250,
      buy_eligible: 12,
      universe: 'nifty250',
      max_scan: 250,
    });
    expect(mockRunScan).toHaveBeenCalledWith({
      universe: 'nifty250',
      maxScan: 250,
      refresh: false,
      lockToken: 'lock-token',
    });
    expect(mockReleaseLock).toHaveBeenCalled();
  });
});
