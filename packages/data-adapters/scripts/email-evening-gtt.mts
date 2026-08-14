/**
 * Build evening GTT digest and email it.
 * Usage: pnpm --filter @sv/data-adapters email:evening-gtt
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { initAppConfig } from '@sv/shared';
import { connectRedis } from '@sv/cache';
import { buildAndPersistEveningGttDigest } from '../src/evening-gtt-signals.js';
import { isSignalEmailConfigured } from '../src/signal-alerts.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

await initAppConfig();
await connectRedis().catch(() => undefined);

if (!isSignalEmailConfigured()) {
  console.error('SMTP not configured — set SMTP_HOST + SMTP_FROM/SMTP_USER in .env');
  process.exit(1);
}

if (process.env.EVENING_GTT_EMAIL === '0') {
  console.error('EVENING_GTT_EMAIL=0 — unset or set to 1 to send');
  process.exit(1);
}

const digest = await buildAndPersistEveningGttDigest({ force: true, sendEmail: true });
console.error(
  JSON.stringify(
    {
      date_key: digest.date_key,
      order_count: digest.order_count,
      email_sent: digest.email_sent ?? false,
      email_error: (digest as { email_error?: string }).email_error ?? null,
      symbols: digest.orders.map((o) => o.symbol),
      snapshot_saved_at: digest.snapshot_saved_at,
    },
    null,
    2,
  ),
);

if (!digest.email_sent) {
  console.error('Email was not sent — check SMTP / SIGNAL_ALERT_EMAIL_TO / snapshot.');
  process.exit(1);
}

console.error(`Sent Evening GTT email · ${digest.order_count} order(s) · ${digest.date_key}`);
process.exit(0);
