import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAST_ENTRY_MIN,
  TIME_STOP_IST,
  TIME_STOP_MIN,
  entryWindow,
  formatMinutes,
} from './session-clock.js';

describe('session-clock', () => {
  it('uses 14:30 IST hard time stop', () => {
    expect(TIME_STOP_MIN).toBe(14 * 60 + 30);
    expect(TIME_STOP_IST).toBe('14:30');
  });

  it('closes entry window before time stop', () => {
    expect(DEFAULT_LAST_ENTRY_MIN).toBeLessThan(TIME_STOP_MIN);
    const late = entryWindow(14 * 60 + 15, {});
    expect(late.open).toBe(false);
  });

  it('formats minutes as HH:MM', () => {
    expect(formatMinutes(14 * 60 + 30)).toBe('14:30');
  });
});
