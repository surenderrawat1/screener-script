import { describe, expect, it } from 'vitest';
import {
  conservativeSwingScanHref,
  enrichTradingPreset,
  etfRotationScanHref,
  getTradingPreset,
  intradaySessionFilterId,
  intradayRadarHref,
  isValidTradingPresetId,
  normalizeTradingPresetId,
  PRESET_CONSERVATIVE_SWING,
  PRESET_ETF_ROTATION,
  PRESET_GUIDE_TIPS,
  SWING_TIER_A_UNIVERSE_ID,
  tradingPresetIds,
  tradingPresetReadiness,
} from './trading-presets.js';

describe('tradingPresetIds', () => {
  it('lists three system presets', () => {
    expect(tradingPresetIds()).toHaveLength(3);
  });
});

describe('normalizeTradingPresetId', () => {
  it('maps swing alias to conservative', () => {
    expect(normalizeTradingPresetId('swing')).toBe(PRESET_CONSERVATIVE_SWING);
  });

  it('maps etf alias to rotation', () => {
    expect(normalizeTradingPresetId('etf')).toBe(PRESET_ETF_ROTATION);
  });
});

describe('conservative swing preset', () => {
  it('uses ENTER + gc9 + tier-a universe', () => {
    const preset = getTradingPreset(PRESET_CONSERVATIVE_SWING);
    expect(preset?.scan_params?.min_verdict).toBe('ENTER');
    expect(preset?.scan_params?.gc9_only).toBe(true);
    expect(preset?.scan_params?.universe).toBe(SWING_TIER_A_UNIVERSE_ID);
  });

  it('builds autorun deep link', () => {
    const href = conservativeSwingScanHref(true);
    expect(href).toContain('preset=conservative_swing');
    expect(href).toContain('autorun=1');
  });
});

describe('etf rotation preset', () => {
  it('uses rotation ETF universe and SETUP+', () => {
    const preset = getTradingPreset(PRESET_ETF_ROTATION);
    expect(preset?.scan_params?.universe).toBe('swing_etf_rotation');
    expect(preset?.scan_params?.min_verdict).toBe('SETUP_PLUS');
  });

  it('builds swing scan deep link', () => {
    expect(etfRotationScanHref(true)).toContain('preset=etf_rotation');
  });
});

describe('intraday session preset', () => {
  it('links 5m radar', () => {
    expect(intradayRadarHref('5m')).toContain('interval=5m');
    expect(intradayRadarHref('5m')).toContain('preset=intraday_session');
  });
});

describe('isValidTradingPresetId', () => {
  it('accepts normalized aliases', () => {
    expect(isValidTradingPresetId('scalp')).toBe(true);
    expect(isValidTradingPresetId('unknown')).toBe(false);
  });
});

describe('tradingPresetReadiness', () => {
  it('marks all three system presets ready', () => {
    for (const id of tradingPresetIds()) {
      const preset = getTradingPreset(id);
      expect(preset).not.toBeNull();
      expect(tradingPresetReadiness(preset!).ready).toBe(true);
    }
  });

  it('enriches preset with ready flag', () => {
    const preset = getTradingPreset(PRESET_CONSERVATIVE_SWING);
    expect(enrichTradingPreset(preset!).ready).toBe(true);
  });
});

describe('conservative swing links', () => {
  it('includes strict ENTER tier on Swing Auto link', () => {
    const preset = getTradingPreset(PRESET_CONSERVATIVE_SWING);
    const autoLink = preset?.links.find((l) => l.label.includes('Swing Auto'));
    expect(autoLink?.href).toContain('tier=strict_enter');
  });
});

describe('intradaySessionFilterId', () => {
  it('maps 5m to trend scalp and 15m to CFA precision', () => {
    expect(intradaySessionFilterId('5m')).toBe('trend_scalp_5m');
    expect(intradaySessionFilterId('15m')).toBe('cfa_precision');
  });
});

describe('PRESET_GUIDE_TIPS', () => {
  it('ships accuracy tips for hub banner', () => {
    expect(PRESET_GUIDE_TIPS.length).toBeGreaterThanOrEqual(3);
  });
});
