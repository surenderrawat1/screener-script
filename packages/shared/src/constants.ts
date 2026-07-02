export const ROLES = {
  ADMIN: 'admin',
  ANALYST: 'analyst',
  VIEWER: 'viewer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  VIEW: 'view_app',
  RUN_SCREENER: 'run_screener',
  RUN_PARITY: 'run_parity',
  REFRESH_DATA: 'refresh_data',
  MANAGE_CACHE: 'manage_cache',
  MANAGE_UNIVERSES: 'manage_universes',
  MANAGE_USERS: 'manage_users',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.ANALYST]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.RUN_SCREENER,
    PERMISSIONS.RUN_PARITY,
    PERMISSIONS.REFRESH_DATA,
  ],
  [ROLES.VIEWER]: [PERMISSIONS.VIEW],
};

export const JOB_TYPES = {
  SCREENER: 'screener',
  VERIFY_BATCH: 'verify_batch',
  SWING_SCAN: 'swing_scan',
  INDEX_SYNC: 'index_sync',
  DAILY_CLOSE: 'daily_close',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** Redis key prefixes — maps from PHP DataCache::SOURCE_TTL */
export const CACHE_PREFIX = {
  STOCK: 'sv:stock',
  VERIFY: 'sv:verify',
  YAHOO: 'sv:yahoo',
  SCREENER_ROW: 'sv:screener:row',
  SCREENER_TABLE: 'sv:screener:table',
  TA: 'sv:ta',
  UNIVERSE: 'sv:universe',
  INDEX: 'sv:index',
  ALIAS: 'sv:alias',
  RATELIMIT: 'sv:ratelimit',
  JOB_PROGRESS: 'sv:job:progress',
  WORKER_HEARTBEAT: 'sv:worker:heartbeat',
  SWING_AUTO: 'sv:swing:auto',
} as const;

export const CACHE_TTL = {
  universe: 86400,
  index_symbols: 2592000,
  screener_table: 86400,
  screener_row: 3600,
  ta: 86400,
  stock: 604800,
  verify: 604800,
  yahoo: 604800,
  job_progress: 3600,
  intraday: 120,
  swing_auto_snapshot: 7200,
} as const;

export const BUILTIN_UNIVERSES = [
  { key: 'nifty50', name: 'Nifty 50' },
  { key: 'nifty100', name: 'Nifty 100' },
  { key: 'nifty200', name: 'Nifty 200' },
  { key: 'nifty500', name: 'Nifty 500' },
  { key: 'nifty250', name: 'Nifty Midcap 250' },
  { key: 'smallcap250', name: 'Nifty Smallcap 250' },
  { key: 'total_nse', name: 'All NSE (uploaded CSV)' },
] as const;

export const SCREENER_PRESETS = [
  'quality',
  'strong_buy',
  'buy_picks',
  'fair_mos',
  'value',
  'growth',
  'cfa_top',
  'ta_pullback',
  'ta_momentum',
  'ta_oversold',
] as const;

export type ScreenerPreset = (typeof SCREENER_PRESETS)[number];
