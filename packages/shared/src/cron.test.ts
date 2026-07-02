import { describe, expect, it } from 'vitest';
import { dateKeyInTimezone, isDailyCronDue, parseDailyCron } from './cron.js';

describe('cron', () => {
  it('parses daily cron', () => {
    expect(parseDailyCron('0 6 * * *')).toEqual({ minute: 0, hour: 6 });
    expect(parseDailyCron('30 14 * * *')).toEqual({ minute: 30, hour: 14 });
    expect(parseDailyCron('bad')).toBeNull();
  });

  it('detects 06:00 IST window', () => {
    // 2026-07-02 00:30 UTC = 06:00 IST
    const atSix = new Date('2026-07-02T00:30:00.000Z');
    expect(isDailyCronDue('0 6 * * *', 'Asia/Kolkata', atSix)).toBe(true);

    const atSeven = new Date('2026-07-02T01:30:00.000Z');
    expect(isDailyCronDue('0 6 * * *', 'Asia/Kolkata', atSeven)).toBe(false);
  });

  it('formats date key in timezone', () => {
    const key = dateKeyInTimezone('Asia/Kolkata', new Date('2026-07-02T00:30:00.000Z'));
    expect(key).toMatch(/2026/);
  });
});
