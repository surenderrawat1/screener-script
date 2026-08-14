import { describe, expect, it } from 'vitest';
import { strategyProgressLabel, type StrategyRunProgress } from './strategy-runner.js';

describe('strategy-runner progress labels', () => {
  it('labels hybrid screener stage', () => {
    const p: StrategyRunProgress = {
      phase: 'screener',
      processed: 10,
      total: 100,
      passed: 2,
    };
    expect(strategyProgressLabel(p)).toBe('Stage 1 · CFA screener');
  });

  it('labels hybrid swing stage', () => {
    expect(
      strategyProgressLabel({
        phase: 'swing',
        processed: 5,
        total: 20,
        passed: 3,
        stage_label: 'Stage 2 · swing (20 passers)',
      }),
    ).toBe('Stage 2 · swing (20 passers)');
  });

  it('labels done', () => {
    expect(strategyProgressLabel({ phase: 'done', processed: 1, total: 1, passed: 1 })).toBe('Done');
  });
});
