import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildAppConfig,
  getCacheTtl,
  getDailySyncCron,
  getDataPolicy,
  initAppConfig,
  reloadAppConfig,
} from './config.js';
import { resolveConfigRoot } from './config-loader.js';
import { CACHE_TTL } from './constants.js';

const REPO_CONFIG = resolve(
  import.meta.dirname,
  '../../../config',
);

describe('config loader', () => {
  const prevRoot = process.env.SV_CONFIG_ROOT;

  beforeEach(() => {
    process.env.SV_CONFIG_ROOT = REPO_CONFIG;
    reloadAppConfig();
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.SV_CONFIG_ROOT;
    else process.env.SV_CONFIG_ROOT = prevRoot;
    reloadAppConfig();
  });

  it('finds repo config directory', () => {
    expect(existsSync(join(REPO_CONFIG, 'data-policy.yaml'))).toBe(true);
    expect(resolveConfigRoot()).toBe(REPO_CONFIG);
  });

  it('loads data-policy.yaml cache TTLs', () => {
    const policy = buildAppConfig(REPO_CONFIG).dataPolicy;
    expect(policy.timezone).toBe('Asia/Kolkata');
    expect(policy.cache_ttl.stock).toBe(604800);
    expect(policy.cache_ttl.screener_row).toBe(86400);
  });

  it('loads schedules.yaml daily sync at 6 AM IST', () => {
    const schedules = buildAppConfig(REPO_CONFIG).schedules;
    expect(schedules.daily_sync.cron).toBe('0 6 * * *');
    expect(schedules.daily_sync.timezone).toBe('Asia/Kolkata');
    expect(getDailySyncCron()).toBe('0 6 * * *');
  });

  it('maps yaml TTL keys to runtime CACHE_TTL shape', () => {
    const ttl = getCacheTtl();
    expect(ttl.stock).toBe(604800);
    expect(ttl.screener_row).toBe(86400);
    expect(ttl.index_symbols).toBe(2592000);
    expect(ttl.job_progress).toBe(CACHE_TTL.job_progress);
  });

  it('merges settings overrides over file config', () => {
    reloadAppConfig({
      dataPolicy: {
        cache_ttl: { stock: 3600 },
      },
    });
    expect(getDataPolicy().cache_ttl.stock).toBe(3600);
    expect(getCacheTtl().stock).toBe(3600);
  });

  it('initAppConfig returns cached singleton', async () => {
    const a = await initAppConfig();
    const b = getDataPolicy();
    expect(a.dataPolicy.timezone).toBe(b.timezone);
  });
});
