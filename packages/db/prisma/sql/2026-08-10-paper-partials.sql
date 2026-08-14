-- Paper T1/T2/T3 partial-book tracking (paper_positions)
-- Apply with: psql "$DATABASE_URL" -f packages/db/prisma/sql/2026-08-10-paper-partials.sql
-- Or: pnpm --filter @sv/db exec prisma db push

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS remaining_pct INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS t1_booked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS t2_booked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS breakeven_armed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_qty DOUBLE PRECISION;

-- Backfill open books so remaining size matches quantity
UPDATE paper_positions
SET original_qty = quantity
WHERE original_qty IS NULL;
