import { describe, expect, it } from 'vitest';
import { MARKET_CLOSE_MIN, MARKET_OPEN_MIN, NSE_PHASE, nseSession } from './nse-session.js';

function istDate(iso: string): Date {
  return new Date(iso);
}

describe('nseSession', () => {
  it('reports weekend on Saturday IST', () => {
    const s = nseSession(istDate('2026-07-04T04:00:00Z')); // Sat 09:30 IST
    expect(s.phase).toBe(NSE_PHASE.WEEKEND);
    expect(s.live_quotes).toBe(false);
  });

  it('reports pre-market before 09:15 IST', () => {
    const s = nseSession(istDate('2026-07-06T03:00:00Z')); // Mon 08:30 IST
    expect(s.phase).toBe(NSE_PHASE.PRE);
    expect(s.label).toBe('Pre-market');
  });

  it('reports open during cash session', () => {
    const s = nseSession(istDate('2026-07-06T05:00:00Z')); // Mon 10:30 IST
    expect(s.phase).toBe(NSE_PHASE.OPEN);
    expect(s.live_quotes).toBe(true);
  });

  it('reports closed after 15:30 IST', () => {
    const s = nseSession(istDate('2026-07-06T11:00:00Z')); // Mon 16:30 IST
    expect(s.phase).toBe(NSE_PHASE.POST);
  });

  it('uses standard NSE session boundaries', () => {
    expect(MARKET_OPEN_MIN).toBe(9 * 60 + 15);
    expect(MARKET_CLOSE_MIN).toBe(15 * 60 + 30);
  });
});
