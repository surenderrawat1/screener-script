import { describe, expect, it } from 'vitest';
import {
  SWING_AUTO_ARCHIVE_MAX_AGE_HOURS,
  SWING_AUTO_ARCHIVE_MAX_ROWS,
} from './auto-swing-scan.js';

describe('swing auto snapshot ops (Phase C)', () => {
  it('retains 48h and newest 100 archive rows', () => {
    expect(SWING_AUTO_ARCHIVE_MAX_AGE_HOURS).toBe(48);
    expect(SWING_AUTO_ARCHIVE_MAX_ROWS).toBe(100);
  });
});
