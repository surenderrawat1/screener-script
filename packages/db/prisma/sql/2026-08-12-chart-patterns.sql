-- Chart pattern persistence (snapshots + normalized detections + scan runs)
-- Apply with: psql "$DATABASE_URL" -f packages/db/prisma/sql/2026-08-12-chart-patterns.sql
-- Or: pnpm --filter @sv/db run push

CREATE TABLE IF NOT EXISTS chart_pattern_scan_runs (
  id TEXT PRIMARY KEY,
  run_date TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'daily_sync',
  symbols_total INTEGER NOT NULL DEFAULT 0,
  symbols_ok INTEGER NOT NULL DEFAULT 0,
  symbols_failed INTEGER NOT NULL DEFAULT 0,
  patterns_found INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_date, trigger)
);

CREATE INDEX IF NOT EXISTS chart_pattern_scan_runs_run_date_idx ON chart_pattern_scan_runs (run_date);

CREATE TABLE IF NOT EXISTS chart_pattern_snapshots (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  scan_date TEXT NOT NULL,
  last_bar_date TEXT NOT NULL,
  bar_count INTEGER NOT NULL,
  pattern_count INTEGER NOT NULL,
  swing_highs INTEGER NOT NULL DEFAULT 0,
  swing_lows INTEGER NOT NULL DEFAULT 0,
  mtf JSONB,
  backtest JSONB,
  trigger TEXT NOT NULL DEFAULT 'on_demand',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, scan_date)
);

CREATE INDEX IF NOT EXISTS chart_pattern_snapshots_scan_date_idx ON chart_pattern_snapshots (scan_date);
CREATE INDEX IF NOT EXISTS chart_pattern_snapshots_symbol_scan_date_idx ON chart_pattern_snapshots (symbol, scan_date);

CREATE TABLE IF NOT EXISTS chart_pattern_detections (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES chart_pattern_snapshots(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  scan_date TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern TEXT NOT NULL,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  last_bar_date TEXT NOT NULL,
  support DOUBLE PRECISION,
  resistance DOUBLE PRECISION,
  breakout DOUBLE PRECISION,
  target DOUBLE PRECISION,
  stop_loss DOUBLE PRECISION,
  volume_confirmed BOOLEAN NOT NULL DEFAULT false,
  rsi_confirmed BOOLEAN NOT NULL DEFAULT false,
  macd_confirmed BOOLEAN NOT NULL DEFAULT false,
  points JSONB NOT NULL DEFAULT '{}',
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, scan_date, pattern_key)
);

CREATE INDEX IF NOT EXISTS chart_pattern_detections_snapshot_id_idx ON chart_pattern_detections (snapshot_id);
CREATE INDEX IF NOT EXISTS chart_pattern_detections_symbol_scan_date_idx ON chart_pattern_detections (symbol, scan_date);
CREATE INDEX IF NOT EXISTS chart_pattern_detections_kind_status_idx ON chart_pattern_detections (kind, status);
CREATE INDEX IF NOT EXISTS chart_pattern_detections_scan_date_status_idx ON chart_pattern_detections (scan_date, status);
CREATE INDEX IF NOT EXISTS chart_pattern_detections_symbol_kind_idx ON chart_pattern_detections (symbol, kind);
