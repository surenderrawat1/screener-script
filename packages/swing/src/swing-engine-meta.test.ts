import { describe, expect, it } from 'vitest';
import { assessScanEligibility } from './scanner.js';
import { buildSwingEngineMeta } from './swing-engine-meta.js';
import { exitRuleDefinitions } from './evaluate-exit.js';

describe('swing-engine-meta', () => {
  it('builds meta aligned with exit rule definitions', () => {
    const meta = buildSwingEngineMeta();
    expect(meta.exit_rules).toEqual(exitRuleDefinitions());
    expect(meta.exit_rules).toHaveLength(9);
    expect(meta.score_categories).toHaveLength(6);
    expect(meta.min_r_multiple).toBe(3);
    expect(meta.min_net_edge_pct).toBe(4);
  });

  it('exit rule X4 text matches partial target fraction', () => {
    expect(exitRuleDefinitions()[3]).toContain('85% of target');
    expect(exitRuleDefinitions()[3]).not.toContain('40%');
  });
});

describe('assessScanEligibility', () => {
  const baseEntry = {
    discovery_verdict: 'ENTER',
    strict_verdict: 'WATCH',
    rules: [{ id: 'E1', passed: true }],
    rules_passed: 7,
    price_action: { broke_swing_high: false },
    dynamic: {},
    gc9: { gc9_entry: true },
  };
  const ta = { ta_pct_52w: 50, ta_52w_chart_zone: 'mid', ta_volume_ratio: 1.2 };

  it('passes with default SETUP_PLUS filters', () => {
    const r = assessScanEligibility(baseEntry, ta, 100);
    expect(r.passes).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it('fails min verdict ENTER when strict is WATCH', () => {
    const r = assessScanEligibility(baseEntry, ta, 100, { min_verdict: 'ENTER' });
    expect(r.passes).toBe(false);
    expect(r.failed).toContain('Min verdict (ENTER)');
  });
});
