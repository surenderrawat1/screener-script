import { describe, expect, it } from 'vitest';
import {
  buildAppConfig,
  getAlertsConfig,
  getIndicesConfig,
  getStrategyDailyProofConfig,
  reloadAppConfig,
} from './config.js';
import { getIndexDefinitions, guessUniverseFromFilename } from './indices.js';

describe('alerts + strategy-daily-proof config files', () => {
  it('loads alerts.yaml and strategy-daily-proof.yaml into app config', () => {
    const cfg = buildAppConfig();
    expect(cfg.alerts.version).toBe(1);
    expect(cfg.alerts.evening_gtt?.tiers).toContain('high_conviction');
    expect(cfg.alerts.evening_gtt?.max_orders).toBeGreaterThan(0);
    expect(cfg.strategyDailyProof.strategies?.length).toBeGreaterThan(0);
    expect(cfg.schedules.intraday.evening_gtt?.tiers).toContain('strict_enter');
    expect(cfg.schedules.intraday.strategy_daily_proof?.strategies).toContain('swing_ma20_stratzy');
  });

  it('exposes getters after reload', () => {
    reloadAppConfig();
    expect(getAlertsConfig().email?.evening_gtt).not.toBe(false);
    expect(getAlertsConfig().email?.pattern_alerts).not.toBe(false);
    expect(getAlertsConfig().whatsapp?.pattern_alerts).not.toBe(false);
    expect(getStrategyDailyProofConfig().max_scan).toBeGreaterThan(0);
  });
});

describe('indices.yaml registry', () => {
  it('loads dynamic index definitions including nifty200', () => {
    reloadAppConfig();
    const cfg = getIndicesConfig();
    expect(cfg.definitions.nifty50?.csv).toContain('nifty50');
    expect(cfg.definitions.nifty200?.label).toMatch(/200/i);
    expect(Object.keys(getIndexDefinitions()).length).toBeGreaterThanOrEqual(6);
    expect(guessUniverseFromFilename('MW-NIFTY-200-01-Jan-2026.csv')).toBe('nifty200');
  });
});
